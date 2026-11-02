import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";
register("data:text/javascript,export const resolve = (specifier, context, next) => next(specifier === 'next/server' ? 'next/server.js' : specifier, context);");
process.env.COMFY_BASE_URL = "http://127.0.0.1:8189";
const { GET: output } = await import("../app/api/jobs/[id]/outputs/[outputId]/route.ts");
const { GET: picture } = await import("../app/api/picture/route.ts");
for (const kind of ["output", "picture"] as const) test(`${kind} preserves an unsatisfiable range without serving the upstream error body`, async (t) => {
  let rangeSeen = "";
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/jobs/job_1")) return Response.json({ id: "job_1", status: "succeeded", outputs: [], urls: {} });
    if (url.endsWith("/assets/asset_1")) return Response.json({ id: "asset_1", job_id: "job_1", file_path: "result.mp4" });
    if (url.endsWith("/history/picture_1")) return Response.json({ picture_1: {
      prompt: [0, "picture_1", { "21": { class_type: "SaveImage", _meta: { title: "OpenJutsu · prepared picture" } } }],
      outputs: { "21": { images: [{ filename: "result.png" }] } },
    } });
    rangeSeen = new Headers(init?.headers).get("Range") ?? "";
    if (rangeSeen) return new Response("<html>outside file</html>", { status: 416, headers: { "Content-Type": "text/html", "Content-Range": "bytes */5" } });
    return new Response("video", { headers: { "Content-Type": "video/mp4" } });
  });
  const response = kind === "output"
    ? await output(new Request("http://localhost/api/jobs/job_1/outputs/asset_1", { headers: { Range: "bytes=99-" } }), { params: Promise.resolve({ id: "job_1", outputId: "asset_1" }) })
    : await picture(new Request("http://localhost/api/picture?id=picture_1&media=result", { headers: { Range: "bytes=99-" } }));
  assert.equal(rangeSeen, "bytes=99-");
  assert.equal(response.status, 416);
  assert.equal(response.headers.get("Content-Range"), "bytes */5");
  assert.equal(await response.text(), "");
  assert.notEqual(response.headers.get("Content-Type"), "text/html");
});
