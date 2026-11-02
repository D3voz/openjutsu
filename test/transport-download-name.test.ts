import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";
register("data:text/javascript,export const resolve = (specifier, context, next) => next(specifier === 'next/server' ? 'next/server.js' : specifier, context);");
process.env.COMFY_BASE_URL = "http://127.0.0.1:8189";
const { GET } = await import("../app/api/jobs/[id]/outputs/[outputId]/route.ts");

test("downloads use a safe fallback and retain the UTF-8 output filename", async (t) => {
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    const url = String(input);
    if (url.endsWith("/jobs/job_1")) return Response.json({ id: "job_1", status: "succeeded", outputs: [], urls: {} });
    if (url.endsWith("/assets/asset_1")) return Response.json({ id: "asset_1", job_id: "job_1", file_path: 'folder/結果 "one".mp4' });
    return new Response("video", { headers: { "Content-Type": "video/mp4" } });
  });
  const response = await GET(new Request("http://localhost/api/jobs/job_1/outputs/asset_1?download"), { params: Promise.resolve({ id: "job_1", outputId: "asset_1" }) });
  assert.equal(response.status, 200, await response.clone().text());
  const disposition = response.headers.get("Content-Disposition")!;
  assert.match(disposition, /^attachment; filename="[\x20-\x21\x23-\x5b\x5d-\x7e]+"; filename\*=UTF-8''/);
  assert.equal(decodeURIComponent(disposition.split("filename*=UTF-8''")[1]), '結果 "one".mp4');
  assert.equal(await response.text(), "video");
});
