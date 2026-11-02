import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";
register("data:text/javascript,export const resolve = (specifier, context, next) => next(specifier === 'next/server' ? 'next/server.js' : specifier, context);");
process.env.COMFY_BASE_URL = "http://127.0.0.1:8189";
const { POST } = await import("../app/api/picture/route.ts");
const { GET } = await import("../app/api/jobs/[id]/outputs/[outputId]/route.ts");

test("malformed and non-object picture JSON is a client error before backend access", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => { calls++; throw new Error("unexpected backend access"); });
  for (const body of ["{", "null", "[]", '"text"']) {
    const response = await POST(new Request("http://localhost/api/picture", { method: "POST", headers: { "Content-Type": "application/json" }, body }));
    assert.equal(response.status, 400, `${body}: ${await response.text()}`);
  }
  assert.equal(calls, 0);
});

for (const status of [404, 503]) test(`preview asset ${status} keeps its missing-versus-outage meaning`, async (t) => {
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    if (String(input).endsWith("/jobs/job_1")) return Response.json({ id: "job_1", status: "running", outputs: [], urls: {} });
    return Response.json({ error: { code: status === 404 ? "asset_not_found" : "error", message: "asset service failure" } }, { status });
  });
  const response = await GET(new Request("http://localhost/api/jobs/job_1/outputs/asset_1"), { params: Promise.resolve({ id: "job_1", outputId: "asset_1" }) });
  assert.equal(response.status, status === 404 ? 404 : 502);
});
