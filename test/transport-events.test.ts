import assert from "node:assert/strict";
import test from "node:test";
process.env.COMFY_BASE_URL = "http://127.0.0.1:8189";
const { GET } = await import("../app/api/jobs/[id]/events/route.ts");
for (const stage of ["snapshot", "events", "outage"] as const) test(`job stream handles ${stage} failures with the correct terminal meaning`, async (t) => {
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    if (!String(input).endsWith("/events") && stage !== "snapshot") return Response.json({ id: "job_1", status: "running", outputs: [], urls: { events: "http://127.0.0.1:8189/api/v2/jobs/job_1/events" } });
    return Response.json({ error: { code: stage === "outage" ? "error" : "job_not_found", message: "backend failure" } }, { status: stage === "outage" ? 503 : 404 });
  });
  const response = await GET(new Request("http://localhost/api/jobs/job_1/events"), { params: Promise.resolve({ id: "job_1" }) });
  const text = await response.text();
  if (stage === "outage") { assert.match(text, /"type":"error"/); assert.doesNotMatch(text, /"status":"expired"/); }
  else { assert.match(text, /"status":"expired"/); assert.doesNotMatch(text, /"type":"error"/); }
});
