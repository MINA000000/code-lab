// Runs student Python code with Pyodide (Python compiled to WebAssembly).
importScripts("https://cdn.jsdelivr.net/pyodide/v0.26.4/full/pyodide.js");

const HARNESS = `
import sys, io, ast, json, builtins, traceback, linecache

def __remember_source(name, text):
    # lets tracebacks show the student's line of code
    linecache.cache[name] = (len(text), None, [l + "\\n" for l in text.splitlines()], name)

def __format_error(e):
    te = traceback.TracebackException(type(e), e, e.__traceback__)
    te.stack = traceback.StackSummary.from_list(
        [f for f in te.stack if f.filename in ("main.py", "test.py")])
    return "".join(te.format()).strip()

def __make_input(echo):
    def input(prompt=""):
        if echo:
            sys.stdout.write(str(prompt))
        line = sys.stdin.readline()
        if not line:
            raise EOFError("input() was called but there is no more input")
        return line.rstrip("\\n")
    return input

def __explain_assert(test_code, lineno, g):
    line = test_code.splitlines()[lineno - 1].strip()
    msg = "Failed: " + line
    try:
        node = ast.parse(line).body[0]
        if isinstance(node, ast.Assert) and isinstance(node.test, ast.Compare) \\
                and len(node.test.ops) == 1 and isinstance(node.test.ops[0], ast.Eq):
            got = eval(compile(ast.Expression(node.test.left), "test", "eval"), g)
            want = eval(compile(ast.Expression(node.test.comparators[0]), "test", "eval"), g)
            msg += "\\n  expected: " + repr(want) + "\\n  got:      " + repr(got)
    except Exception:
        pass
    return msg

def __run(code, test_code, stdin_text, echo):
    out = io.StringIO()
    old_out, old_in, old_input = sys.stdout, sys.stdin, builtins.input
    sys.stdout, sys.stdin = out, io.StringIO(stdin_text)
    builtins.input = __make_input(echo)
    __remember_source("main.py", code)
    __remember_source("test.py", test_code)
    g = {"__name__": "__main__"}
    error, phase = None, "code"
    try:
        exec(compile(code, "main.py", "exec"), g)
        if test_code:
            phase = "test"
            exec(compile(test_code, "test.py", "exec"), g)
    except SystemExit:
        pass
    except BaseException as e:
        tb = e.__traceback__
        frames = traceback.extract_tb(tb)
        test_frame = next((f for f in reversed(frames) if f.filename == "test.py"), None)
        if phase == "test" and isinstance(e, AssertionError) and test_frame and frames[-1].filename == "test.py":
            error = __explain_assert(test_code, test_frame.lineno, g)
        else:
            error = __format_error(e)
    finally:
        sys.stdout, sys.stdin, builtins.input = old_out, old_in, old_input
    return json.dumps({"stdout": out.getvalue(), "error": error, "phase": phase})
`;

let pyodide;

async function init() {
  pyodide = await loadPyodide();
  pyodide.runPython(HARNESS);
  self.postMessage({ type: "ready" });
}

const ready = init().catch((err) => {
  self.postMessage({ type: "load-error", error: String(err) });
});

self.onmessage = async ({ data }) => {
  await ready;
  const { id, code, testCode, stdin, echo } = data;
  try {
    await pyodide.loadPackagesFromImports(code + "\n" + (testCode || ""));
    const result = JSON.parse(
      pyodide.globals.get("__run")(code, testCode || "", stdin || "", !!echo)
    );
    self.postMessage({ type: "result", id, ...result });
  } catch (err) {
    self.postMessage({ type: "result", id, stdout: "", error: String(err), phase: "code" });
  }
};
