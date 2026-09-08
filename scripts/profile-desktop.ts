// 只采集耗时、体积和数量；不输出记录内容、截图、模型凭证或上游响应。
export {};
const port = Number(process.argv[2] ?? 9337);
if (!Number.isInteger(port) || port < 1024 || port > 65535)
  throw new Error("invalid_local_debug_port");
const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((r) =>
  r.json(),
);
const target = targets.find((item: any) =>
  item.url.endsWith("/proactive-agent/dist/renderer/index.html"),
);
if (!target) throw new Error("proactive_window_not_found");
const ws = new WebSocket(target.webSocketDebuggerUrl);
const timer = setTimeout(() => {
  console.error("desktop_profile_timeout");
  ws.close();
  process.exit(1);
}, 20000);
ws.onopen = () =>
  ws.send(
    JSON.stringify({
      id: 1,
      method: "Runtime.evaluate",
      params: {
        awaitPromise: true,
        returnByValue: true,
        expression: `(async () => {
      const report = {};
      for (const method of ["snapshot", "records.list"]) {
        const samples = [];
        let bytes = 0, rows = 0;
        for (let index = 0; index < 5; index++) {
          const start = performance.now();
          const result = await window.proactive.invoke(method);
          samples.push(Math.round((performance.now() - start) * 100) / 100);
          bytes = new TextEncoder().encode(JSON.stringify(result)).length;
          rows = (result.records ?? result.queue).length;
        }
        report[method] = { samplesMs: samples, payloadBytes: bytes, rows };
      }
      return { ...report, domNodes: document.querySelectorAll("*").length };
    })()`,
      },
    }),
  );
ws.onmessage = (event) => {
  const result = JSON.parse(String(event.data));
  if (result.id !== 1) return;
  clearTimeout(timer);
  if (result.result?.exceptionDetails || result.error) {
    console.error("desktop_profile_failed");
    process.exitCode = 1;
  } else console.log(JSON.stringify(result.result?.result?.value, null, 2));
  ws.close();
};
