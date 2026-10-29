import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { register } from "node:module";
import test from "node:test";
register("data:text/javascript,export const resolve = (specifier, context, next) => next(specifier === 'next/server' ? 'next/server.js' : specifier, context);");
const { GET, DELETE } = await import("../app/api/jobs/[id]/route.ts");
for (const method of ["GET", "DELETE"] as const) for (const failure of ["not_found", "job_not_found", "outage"] as const) {
  test(`${method} job errors distinguish ${failure}`, async (t) => {
    const server = createServer((_request, response) => response.writeHead(failure === "outage" ? 503 : 404, { "Content-Type": "application/json" }).end(JSON.stringify({ error: { code: failure === "outage" ? "upstream_unreachable" : failure, message: "fixture backend response" } })));
    server.listen(0, "127.0.0.1"); await once(server, "listening");
    process.env.COMFY_BASE_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    delete process.env.COMFY_API_KEY; delete process.env.OPENJUTSU_PASSWORD;
    t.after(() => { server.closeAllConnections(); server.close(); });
    const response = await (method === "GET" ? GET : DELETE)(new Request("http://localhost/api/jobs/job_1", { method }), { params: Promise.resolve({ id: "job_1" }) });
    assert.equal(response.status, failure === "outage" ? 502 : 404);
  });
}
test("a job removed between lookup and cancel is still a missing job", async (t) => {
  const server = createServer((request, response) => {
    if (request.method === "GET") response.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ id: "job_1", status: "running", outputs: [], urls: {} }));
    else response.writeHead(404, { "Content-Type": "application/json" }).end(JSON.stringify({ error: { code: "not_found", message: "job expired during cancel" } }));
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  process.env.COMFY_BASE_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  t.after(() => { server.closeAllConnections(); server.close(); });
  assert.equal((await DELETE(new Request("http://localhost/api/jobs/job_1", { method: "DELETE" }), { params: Promise.resolve({ id: "job_1" }) })).status, 404);
});
test("invalid job IDs retain their input-error status without contacting a backend", async () => {
  assert.equal((await GET(new Request("http://localhost/api/jobs/invalid"), { params: Promise.resolve({ id: "../invalid" }) })).status, 400);
});
