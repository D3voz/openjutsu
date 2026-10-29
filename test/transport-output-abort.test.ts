import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { register } from "node:module";
import test from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
register("data:text/javascript,export const resolve = (specifier, context, next) => next(specifier === 'next/server' ? 'next/server.js' : specifier, context);");
const { GET } = await import("../app/api/jobs/[id]/outputs/[outputId]/route.ts");

for (const stage of ["job", "preview-asset", "preview-url", "listed-url", "headers", "body", "upstream-error"] as const) test(stage === "upstream-error" ? "rejecting an upstream error releases its media body" : `canceling an output request closes its upstream ${stage} work`, async (t) => {
  let arrived!: () => void;
  const ready = new Promise<void>((resolve) => { arrived = resolve; });
  let held: ServerResponse | undefined, closed = false, contentRequests = 0;
  const server = createServer((request, response) => {
    const hold = () => { held = response; response.on("close", () => { closed = true; }); arrived(); };
    const json = (body: unknown) => { response.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(body)); };
    if (request.url === "/api/v2/jobs/job_1") {
      if (stage === "job") return hold();
      return json({ id: "job_1", status: "succeeded", urls: {}, outputs: stage === "listed-url" ? [{ id: "asset_1", name: "result.mp4", content_type: "video/mp4" }] : [] });
    }
    if (request.url === "/api/v2/assets/asset_1") {
      if (stage === "preview-asset") return hold();
      return json({ id: "asset_1", job_id: "job_1", file_path: "result.mp4" });
    }
    if (request.url === "/api/v2/assets/asset_1/content") {
      contentRequests++;
      if (stage === "preview-url" || stage === "listed-url" || contentRequests === 2) {
        hold();
        if (stage === "body" || stage === "upstream-error") {
          response.writeHead(stage === "body" ? 200 : 500, { "Content-Type": "video/mp4" }); response.flushHeaders(); response.write("prefix");
        }
        return;
      }
      response.writeHead(200, { "Content-Type": "video/mp4" }).end(); return;
    }
    response.writeHead(404).end();
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const old = process.env.COMFY_BASE_URL;
  process.env.COMFY_BASE_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const controller = new AbortController();
  const pending = GET(new Request("http://localhost/api/jobs/job_1/outputs/asset_1", { signal: controller.signal }), { params: Promise.resolve({ id: "job_1", outputId: "asset_1" }) });
  t.after(async () => {
    held?.destroy(); server.closeAllConnections(); server.close(); await pending;
    if (old === undefined) delete process.env.COMFY_BASE_URL; else process.env.COMFY_BASE_URL = old;
  });
  await Promise.race([ready, sleep(2000).then(() => { throw new Error("upstream stage did not arrive"); })]);
  if (stage === "upstream-error") {
    assert.equal((await pending).status, 502, "upstream errors keep the gateway failure response");
  } else if (stage === "body") {
    const response = await pending;
    const reader = response.body!.getReader();
    assert.equal(new TextDecoder().decode((await reader.read()).value), "prefix");
    controller.abort();
    assert.equal(await Promise.race([reader.read().then(() => false, () => true), sleep(750).then(() => false)]), true, "the canceled downstream body stops reading upstream");
  } else {
    controller.abort();
    assert.equal(await Promise.race([pending.then(() => true), sleep(750).then(() => false)]), true, "the route stops waiting for canceled work");
  }
  for (let i = 0; i < 50 && !closed; i++) await sleep(5);
  assert.equal(closed, true, "the upstream socket is closed");
});
