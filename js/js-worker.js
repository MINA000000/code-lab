// Runs student JavaScript code inside a Web Worker (no access to the page).
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

class AssertionError extends Error {
  constructor(message) {
    super(message);
    this.name = "AssertionError";
  }
}

function format(value) {
  if (typeof value === "string") return value;
  if (value === undefined) return "undefined";
  if (typeof value === "function") return `[Function ${value.name || "anonymous"}]`;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function sameValue(a, b) {
  return a === b || JSON.stringify(a) === JSON.stringify(b);
}

self.postMessage({ type: "ready" });

self.onmessage = async ({ data }) => {
  const { id, code, testCode, stdin, echo } = data;
  const out = [];
  const lines = (stdin || "").split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  let phase = "code";

  const print = (...args) => out.push(args.map(format).join(" ") + "\n");
  const fakeConsole = { log: print, info: print, warn: print, error: print, table: print };
  const input = (promptText = "") => {
    if (echo && promptText) out.push(String(promptText));
    if (!lines.length) throw new Error("input() was called but there is no more input");
    return lines.shift();
  };
  const assert = (condition, message) => {
    if (!condition) throw new AssertionError(message || "assertion failed");
  };
  const assertEqual = (actual, expected) => {
    if (!sameValue(actual, expected)) {
      throw new AssertionError(`expected: ${format(expected)}\n  got:      ${format(actual)}`);
    }
  };
  const startTests = () => { phase = "test"; };

  let error = null;
  try {
    const fn = new AsyncFunction(
      "console", "input", "prompt", "assert", "assertEqual", "__startTests",
      `${code}\n;\n__startTests();\n${testCode || ""}`
    );
    await fn(fakeConsole, input, input, assert, assertEqual, startTests);
  } catch (err) {
    error = err instanceof AssertionError
      ? `Failed: ${err.message}`
      : `${err && err.name ? err.name : "Error"}: ${err && err.message !== undefined ? err.message : err}`;
  }
  self.postMessage({ type: "result", id, stdout: out.join(""), error, phase });
};
