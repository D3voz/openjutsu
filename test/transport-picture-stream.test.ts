import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import { GET } from "../app/api/picture/route.ts";

for (const stage of ["healthy-body", "headers", "metadata-body", "media-error-body", "client-body"] as const) test(`picture media preserves the ${stage} lifetime contract`, async (t) => {
  const deadlines: AbortController[] = [];
  t.mock.method(AbortSignal, "timeout", (milliseconds: number) => {
    assert.equal(milliseconds, 30_000);
    const controller = new AbortController(); deadlines.push(controller); return controller.signal;
  });
  let arrived!: () => void;
  const ready = new Promise<void>((resolve) => { arrived = resolve; });
  let held: ServerResponse | undefined, closed = false;
  const server = createServer((request, response) => {
    const hold = () => { held = response; response.on("close", () => { closed = true; }); arrived(); };
    if (request.url === "/history/job_1") {
      if (stage === "metadata-body") {
        response.writeHead(200, { "Content-Type": "application/json" }); response.flushHeaders(); response.write('{"job_1":'); hold(); return;
      }
      response.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ job_1: {
        prompt: [0, "job_1", { "63": { class_type: "VHS_VideoCombine", _meta: { title: "OpenJutsu · picture motion" } } }],
        outputs: { "63": { gifs: [{ filename: "result.mp4" }] } },
      } })); return;
    }
    if (request.url?.startsWith("/view?")) {
      if (stage === "media-error-body") {
        response.writeHead(500, { "Content-Type": "application/json" }); response.flushHeaders(); response.write('{"error":'); hold(); return;
      }
      if (stage !== "headers") { response.writeHead(200, { "Content-Type": "video/mp4" }); response.flushHeaders(); response.write("first"); }
      hold(); return;
    }
    response.writeHead(404).end();
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const previous = process.env.COMFYUI_URL;
  process.env.COMFYUI_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const client = new AbortController();
  const pending = GET(new Request("http://localhost/api/picture?id=job_1&media=result", { signal: client.signal }));
  t.after(async () => {
    held?.destroy(); server.closeAllConnections(); server.close(); await pending;
    if (previous === undefined) delete process.env.COMFYUI_URL; else process.env.COMFYUI_URL = previous;
  });
  await Promise.race([ready, sleep(2000).then(() => { throw new Error("upstream did not reach the selected phase"); })]);
  const expire = () => { for (const deadline of deadlines) deadline.abort(new DOMException("simulated 30-second deadline", "TimeoutError")); };
  if (stage === "headers" || stage === "metadata-body" || stage === "media-error-body") {
    expire();
    assert.equal((await pending).status, 502, "headers and metadata retain their deadline");
  } else {
    const response = await pending;
    assert.equal(response.status, 200);
    const reader = response.body!.getReader();
    assert.equal(new TextDecoder().decode((await reader.read()).value), "first");
    if (stage === "healthy-body") {
      expire(); held!.end("last");
      let rest = "";
      for (;;) { const { value, done } = await reader.read(); if (done) break; rest += new TextDecoder().decode(value); }
      assert.equal(rest, "last", "a healthy body survives expiration of the header deadline");
    } else {
      client.abort();
      assert.equal(await Promise.race([reader.read().then(() => false, () => true), sleep(750).then(() => false)]), true, "client cancellation still stops the body");
    }
  }
  for (let i = 0; i < 50 && !closed; i++) await sleep(5);
  assert.equal(closed, true);
});
