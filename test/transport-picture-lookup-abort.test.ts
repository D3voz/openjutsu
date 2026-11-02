import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import { GET } from "../app/api/picture/route.ts";

for (const stage of ["history-headers", "history-body", "queue-headers", "queue-body"] as const) test(`canceling picture polling closes its upstream ${stage}`, async (t) => {
  let arrived!: () => void;
  const ready = new Promise<void>((resolve) => { arrived = resolve; });
  let held: ServerResponse | undefined, closed = false;
  const server = createServer((request, response) => {
    if (request.url === "/history/job_1" && stage.startsWith("queue")) {
      response.writeHead(200, { "Content-Type": "application/json" }).end("{}"); return;
    }
    held = response; response.on("close", () => { closed = true; });
    if (stage.endsWith("body")) { response.writeHead(200, { "Content-Type": "application/json" }); response.flushHeaders(); response.write("{"); }
    arrived();
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const previous = process.env.COMFYUI_URL;
  process.env.COMFYUI_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const controller = new AbortController();
  const pending = GET(new Request("http://localhost/api/picture?id=job_1", { signal: controller.signal }));
  t.after(async () => {
    held?.destroy(); server.closeAllConnections(); server.close(); await pending;
    if (previous === undefined) delete process.env.COMFYUI_URL; else process.env.COMFYUI_URL = previous;
  });
  await Promise.race([ready, sleep(2000).then(() => { throw new Error("lookup did not arrive"); })]);
  controller.abort();
  assert.equal(await Promise.race([pending.then(() => true), sleep(750).then(() => false)]), true, "polling stops waiting after its caller leaves");
  for (let i = 0; i < 50 && !closed; i++) await sleep(5);
  assert.equal(closed, true, "the abandoned upstream socket closes");
});
