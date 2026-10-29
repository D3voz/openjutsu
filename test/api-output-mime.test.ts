import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { register } from "node:module";
import test from "node:test";
register("data:text/javascript,export const resolve = (specifier, context, next) => next(specifier === 'next/server' ? 'next/server.js' : specifier, context);");
const { GET } = await import("../app/api/jobs/[id]/route.ts");
for (const [videoType, jsonType] of [
  ["video/mp4", "application/json"],
  ["VIDEO/MP4", "Application/JSON"],
  ['video/mp4; codecs="avc1"', "application/json; charset=utf-8"],
  [' Video/MP4 ; codecs="avc1"', " Application/JSON ; charset=utf-8"],
] as const) test(`completed output discovery recognizes ${videoType} and ${jsonType}`, async (t) => {
  const server = createServer((_request, response) => response.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({
    id: "job_1", status: "succeeded", urls: {}, outputs: [
      { id: "video_1", name: "result.mp4", content_type: videoType, node_id: "67" },
      { id: "data_1", name: "tracks.json", content_type: jsonType, node_id: "6" },
    ],
  })));
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  process.env.COMFY_BASE_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  delete process.env.OPENJUTSU_PASSWORD; delete process.env.COMFY_API_KEY;
  t.after(() => { server.closeAllConnections(); server.close(); });
  const response = await GET(new Request("http://localhost/api/jobs/job_1"), { params: Promise.resolve({ id: "job_1" }) });
  assert.equal(response.status, 200);
  const job = await response.json();
  assert.deepEqual(job.video, { id: "video_1", name: "result.mp4", url: "/api/jobs/job_1/outputs/video_1" });
  assert.equal(job.data, "/api/jobs/job_1/outputs/data_1");
});
test("unrelated images and structured error documents do not become video or track results", async (t) => {
  t.mock.method(globalThis, "fetch", async () => Response.json({ id: "job_1", status: "succeeded", urls: {}, outputs: [
    { id: "image_1", name: "preview.png", content_type: "image/png" },
    { id: "problem_1", name: "problem.json", content_type: "application/problem+json" },
  ] }));
  process.env.COMFY_BASE_URL = "http://127.0.0.1:8189";
  const response = await GET(new Request("http://localhost/api/jobs/job_1"), { params: Promise.resolve({ id: "job_1" }) });
  const job = await response.json(); assert.equal(job.video, null); assert.equal(job.data, null);
});
