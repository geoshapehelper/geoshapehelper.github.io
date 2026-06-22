// Inside a Web Worker, mapshaper isn't detected as a browser (there's no
// `window.document`), so it runs Node code paths that read `process` fields the
// browser polyfill leaves out (execArgv, hrtime, pid, stdout/stderr, execPath,
// platform). Provide harmless stand-ins so those paths behave like normal Node.
// Imported for its side effect before mapshaper in the worker entry.
const proc = (globalThis as unknown as { process?: Record<string, unknown> }).process;

if (proc) {
  if (!Array.isArray(proc.execArgv)) proc.execArgv = [];
  if (proc.pid == null) proc.pid = 1;
  if (proc.execPath == null) proc.execPath = '';
  if (proc.platform == null) proc.platform = 'linux';

  if (typeof proc.hrtime !== 'function') {
    const now = () => (globalThis.performance?.now?.() ?? 0) * 1e6; // ns
    const hrtime = (prev?: [number, number]): [number, number] => {
      const ns = Math.floor(now());
      let s = Math.floor(ns / 1e9);
      let n = ns % 1e9;
      if (prev) {
        s -= prev[0];
        n -= prev[1];
        if (n < 0) {
          s -= 1;
          n += 1e9;
        }
      }
      return [s, n];
    };
    (hrtime as { bigint?: () => bigint }).bigint = () => BigInt(Math.floor(now()));
    proc.hrtime = hrtime;
  }

  const noopStream = { write: () => true, isTTY: false };
  if (!proc.stdout) proc.stdout = noopStream;
  if (!proc.stderr) proc.stderr = noopStream;
}
