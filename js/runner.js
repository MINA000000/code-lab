// Runs code in a Web Worker per language and grades it against a task's tests.
const WORKER_URLS = {
  python: "js/py-worker.js",
  javascript: "js/js-worker.js",
};
const TIME_LIMIT_MS = 5000;

class LangRunner {
  constructor(language) {
    this.language = language;
    this.worker = null;
    this.ready = null;
    this.seq = 0;
    this.pending = new Map();
  }

  start() {
    if (this.ready) return this.ready;
    const worker = new Worker(WORKER_URLS[this.language]);
    this.worker = worker;
    this.ready = new Promise((resolve, reject) => {
      worker.onmessage = ({ data }) => {
        if (data.type === "ready") resolve();
        else if (data.type === "load-error") reject(new Error(data.error));
        else if (data.type === "result") {
          const job = this.pending.get(data.id);
          if (!job) return;
          clearTimeout(job.timer);
          this.pending.delete(data.id);
          job.resolve({ stdout: data.stdout, error: data.error, phase: data.phase });
        }
      };
      worker.onerror = (e) => reject(new Error(e.message || "Could not start the code runner"));
    });
    this.ready.catch(() => this.kill());
    return this.ready;
  }

  kill() {
    if (this.worker) this.worker.terminate();
    this.worker = null;
    this.ready = null;
  }

  async run({ code, testCode = "", stdin = "", echo = false }) {
    await this.start();
    const id = ++this.seq;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        this.kill(); // the only way to stop an infinite loop
        resolve({
          stdout: "",
          error: `Time limit exceeded (${TIME_LIMIT_MS / 1000}s). Is there an infinite loop?`,
          phase: "code",
          timeout: true,
        });
      }, TIME_LIMIT_MS);
      this.pending.set(id, { resolve, timer });
      this.worker.postMessage({ id, code, testCode, stdin, echo });
    });
  }
}

const runners = {};

function getRunner(language) {
  if (!runners[language]) runners[language] = new LangRunner(language);
  return runners[language];
}

function normalizeOutput(text) {
  return (text || "")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .trim();
}

// Free-run the code (the "Run" button). Prompts from input() are shown.
function runCode(language, code, stdin) {
  return getRunner(language).run({ code, stdin, echo: true });
}

// Run every test; each test runs in a fresh environment.
// test = { name, type: "assert", code } | { name, type: "output", input, expected }
async function runTests(language, code, tests, onProgress) {
  const runner = getRunner(language);
  const results = [];
  for (const [i, test] of tests.entries()) {
    const name = test.name || `Test ${i + 1}`;
    let result;
    if (test.type === "output") {
      const r = await runner.run({ code, stdin: test.input || "" });
      const got = normalizeOutput(r.stdout);
      const want = normalizeOutput(test.expected);
      result = r.error
        ? { name, passed: false, message: r.error, stdout: r.stdout }
        : got === want
          ? { name, passed: true, stdout: r.stdout }
          : {
              name,
              passed: false,
              message: "Output does not match.",
              expected: want,
              got,
              input: test.input || "",
            };
    } else {
      const r = await runner.run({ code, testCode: test.code || "" });
      result = r.error
        ? {
            name,
            passed: false,
            message: (r.phase === "code" ? "Your code crashed before the test ran:\n" : "") + r.error,
            stdout: r.stdout,
          }
        : { name, passed: true, stdout: r.stdout };
    }
    results.push(result);
    if (onProgress) onProgress(results);
  }
  return results;
}

// Warm up the Python runner early, since Pyodide takes a few seconds to download.
function preloadRunner(language) {
  return getRunner(language).start();
}

window.CodeRunner = { runCode, runTests, preloadRunner, TIME_LIMIT_MS };
