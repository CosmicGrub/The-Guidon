/**
 * Minimal Chrome DevTools Protocol client, page-target only.
 *
 * Android WebView does not implement the browser-level endpoints Playwright's
 * connectOverCDP requires, so we speak to the page target directly. Node 24 has
 * a global WebSocket, so this needs no dependency.
 */
export async function attachToPage(base = "http://127.0.0.1:9222", match = () => true) {
  const list = await (await fetch(base + "/json/list")).json();
  const target = list.find((t) => t.type === "page" && match(t));
  if (!target) throw new Error("no page target found; targets: " + JSON.stringify(list.map((t) => t.type + " " + t.url)));

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.addEventListener("open", res, { once: true });
    ws.addEventListener("error", rej, { once: true });
  });

  let id = 0;
  const pending = new Map();
  const events = [];
  const listeners = [];

  ws.addEventListener("message", (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
    } else if (msg.method) {
      events.push(msg);
      listeners.forEach((fn) => fn(msg));
    }
  });

  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const myId = ++id;
      pending.set(myId, { resolve, reject });
      ws.send(JSON.stringify({ id: myId, method, params }));
      setTimeout(() => {
        if (pending.has(myId)) { pending.delete(myId); reject(new Error("CDP timeout: " + method)); }
      }, 60000);
    });

  /** Evaluates an expression in the page and returns its value, awaiting promises. */
  async function evaluate(fnOrExpr, ...args) {
    const expr =
      typeof fnOrExpr === "function"
        ? `(${fnOrExpr.toString()})(${args.map((a) => JSON.stringify(a)).join(",")})`
        : fnOrExpr;
    const r = await send("Runtime.evaluate", {
      expression: `(async () => { return (${expr}); })()`,
      awaitPromise: true,
      returnByValue: true,
      allowUnsafeEvalBlockedByCSP: false,
    });
    if (r.exceptionDetails) {
      throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    }
    return r.result.value;
  }

  await send("Runtime.enable");
  await send("Log.enable").catch(() => {});
  await send("Console.enable").catch(() => {});

  return {
    target,
    send,
    evaluate,
    events,
    onEvent: (fn) => listeners.push(fn),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    close: () => ws.close(),
  };
}
