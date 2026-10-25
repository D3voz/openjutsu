import assert from "node:assert/strict";
import { createServer, type Server } from "node:net";
import test from "node:test";
import { apiAccess, authorize, HttpError, loopbackOnly, PASSWORD_REQUIRED, PASSWORD_TOO_SHORT, readFormData, validateJobId } from "../lib/http.ts";
import { getJob } from "../lib/comfy.ts";
import { register } from "../instrumentation.ts";

test("URL-shaped job IDs are rejected before the SDK can fetch", async (t) => {
  let requests = 0;
  t.mock.method(globalThis, "fetch", async () => { requests++; throw new Error("Unexpected network request"); });
  for (const id of ["http://127.0.0.1:8188/queue", "https://example.com", "/api/v2/assets", "..", "a/b", "a\\b", "a%2fb", "http-other", ""]) {
    await assert.rejects(async () => getJob(id), (error: unknown) => error instanceof HttpError && error.status === 400);
  }
  assert.equal(requests, 0);
  for (const id of ["d544f17b-2c81-40c4-9cd1-9624954038e6", "job_abc-123"]) assert.doesNotThrow(() => validateJobId(id));
});

test("local API access stays password-free; foreign hosts and browser origins are rejected", (t) => {
  const previous = process.env.OPENJUTSU_PASSWORD;
  delete process.env.OPENJUTSU_PASSWORD;
  t.after(() => { if (previous === undefined) delete process.env.OPENJUTSU_PASSWORD; else process.env.OPENJUTSU_PASSWORD = previous; });
  for (const host of ["127.0.0.1:3000", "localhost:3000", "[::1]:3000"]) {
    const url = `http://${host}`;
    assert.equal(apiAccess(new Request(`${url}/api/jobs`, { headers: { Host: host, Origin: url, "Sec-Fetch-Site": "same-origin" } })), null);
  }
  assert.equal(apiAccess(new Request("http://localhost:3000/api/jobs", { headers: { Host: "127.0.0.1:3000", Origin: "http://127.0.0.1:3000" } })), null, "Next may use its internal hostname in request.url");
  assert.equal(apiAccess(new Request("http://localhost:3000/api/jobs", { headers: { Host: "localhost:3000", Origin: "https://localhost:3000", "X-Forwarded-Proto": "https" } })), null, "reverse proxies preserve the public scheme");
  const foreignHeaders: HeadersInit[] = [
    { Origin: "https://example.com" }, { Origin: "null" }, { "Sec-Fetch-Site": "cross-site" },
    { "Sec-Fetch-Site": "same-site" }, { Host: "example.com" }, { "X-Forwarded-Host": "example.com" },
  ];
  for (const headers of foreignHeaders) assert.equal(apiAccess(new Request("http://127.0.0.1:3000/api/jobs", { headers }))?.status, 403);
  assert.equal(authorize(new Request("https://example.com"))?.status, 403);
  assert.equal(authorize(new Request("http://localhost:3000", { headers: { "Sec-Fetch-Site": "cross-site" } })), null, "ordinary page navigation is allowed");
});

test("password-free serving starts only on loopback; a network bind needs a password", async (t) => {
  const previous = { password: process.env.OPENJUTSU_PASSWORD, runtime: process.env.NEXT_RUNTIME };
  delete process.env.OPENJUTSU_PASSWORD;
  process.env.NEXT_RUNTIME = "nodejs";
  const servers: Server[] = [];
  t.after(() => {
    for (const [key, value] of [["OPENJUTSU_PASSWORD", previous.password], ["NEXT_RUNTIME", previous.runtime]] as const) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    for (const server of servers) server.close();
  });
  const listen = (host: string) => new Promise<void>((resolve) => { const server = createServer(); servers.push(server); server.listen(0, host, resolve); });
  const errors: unknown[] = [];
  t.mock.method(console, "error", (message: unknown) => { errors.push(message); });
  t.mock.method(process, "exit", (code?: number) => { throw new Error(`exit ${code}`); });

  for (const address of ["127.0.0.1", "127.8.0.1", "::1", "::ffff:127.0.0.1"]) assert.equal(loopbackOnly([{ address, family: "", port: 3000 }]), true, address);
  assert.equal(loopbackOnly(["/tmp/openjutsu.sock"]), true, "pipes are local");
  for (const address of ["0.0.0.0", "::", "192.168.1.20", "::ffff:10.0.0.2"]) assert.equal(loopbackOnly([{ address, family: "", port: 3000 }]), false, address);
  assert.equal(loopbackOnly([]), false, "no listening socket proves nothing");
  assert.equal(loopbackOnly([null]), false);

  await assert.rejects(register(), /exit 1/, "nothing listening yet is not proof of loopback");
  await listen("127.0.0.1");
  await register();
  await listen("0.0.0.0");
  await assert.rejects(register(), /exit 1/);
  assert.deepEqual(errors, [PASSWORD_REQUIRED, PASSWORD_REQUIRED]);
  process.env.OPENJUTSU_PASSWORD = "review-test-password";
  await register();
  assert.equal(errors.length, 2);
  process.env.OPENJUTSU_PASSWORD = "elevenchars";
  await assert.rejects(register(), /exit 1/, "a short password is refused even on loopback");
  assert.equal(errors.at(-1), PASSWORD_TOO_SHORT);
  process.env.OPENJUTSU_PASSWORD = "twelve-chars";
  await register();
  assert.equal(errors.length, 3);
});

test("a configured password protects local and hosted access, including media and event requests", (t) => {
  const previous = process.env.OPENJUTSU_PASSWORD;
  process.env.OPENJUTSU_PASSWORD = "review-test-password";
  t.after(() => { if (previous === undefined) delete process.env.OPENJUTSU_PASSWORD; else process.env.OPENJUTSU_PASSWORD = previous; });
  const authorization = `Basic ${Buffer.from("openjutsu:review-test-password").toString("base64")}`;
  for (const host of ["http://127.0.0.1:3000", "https://openjutsu.example"]) {
    for (const path of ["/", "/api/models", "/api/jobs/job_123/events", "/api/jobs/job_123/outputs/asset_1"]) {
      const url = `${host}${path}`;
      assert.equal(authorize(new Request(url))?.status, 401);
      assert.equal(apiAccess(new Request(url, { headers: { Authorization: authorization, "Sec-Fetch-Site": "same-origin" } })), null);
      assert.equal(authorize(new Request(url, { headers: { Authorization: "Basic !!!" } }))?.status, 401);
    }
  }
  assert.equal(apiAccess(new Request("http://localhost:3000/api/jobs", { headers: { Authorization: authorization, Host: "openjutsu.example", Origin: "https://openjutsu.example", "X-Forwarded-Proto": "https" } })), null, "public origin must not inherit the internal port");
  assert.equal(apiAccess(new Request("http://localhost:3000/api/jobs", { headers: { Authorization: authorization, Host: "openjutsu.example", Origin: "https://openjutsu.example:3000", "X-Forwarded-Proto": "https" } }))?.status, 403);
  assert.match(authorize(new Request("http://localhost:3000"))!.headers.get("WWW-Authenticate")!, /^Basic /);
  assert.equal(apiAccess(new Request("https://openjutsu.example/api/jobs", { headers: { Authorization: authorization, Origin: "https://attacker.example" } }))?.status, 403);
});

test("failed sign-ins back off per client and across forged clients; the right password from a fresh client is never slowed", (t) => {
  const previous = process.env.OPENJUTSU_PASSWORD;
  process.env.OPENJUTSU_PASSWORD = "review-test-password";
  t.after(() => { if (previous === undefined) delete process.env.OPENJUTSU_PASSWORD; else process.env.OPENJUTSU_PASSWORD = previous; });
  // Start hours after the failures in earlier tests so they are forgotten.
  let now = performance.now() + 2 * 60 * 60_000;
  t.mock.method(performance, "now", () => now);
  const signIn = (password: string | null, client = "203.0.113.7") => {
    const headers: Record<string, string> = { "X-Forwarded-For": `198.51.100.1, ${client}` };
    if (password !== null) headers.Authorization = `Basic ${Buffer.from(`openjutsu:${password}`).toString("base64")}`;
    return authorize(new Request("https://openjutsu.example/api/models", { headers }));
  };
  const status = (password: string | null, client?: string) => signIn(password, client)?.status ?? 200;

  for (let i = 0; i < 6; i++) assert.equal(status("wrong"), 401, `failure ${i + 1} is answered`);
  const refused = signIn("wrong")!;
  assert.equal(refused.status, 429);
  assert.equal(refused.headers.get("Retry-After"), "1");
  assert.equal(status("review-test-password"), 429, "a client in backoff cannot test even the right password");
  assert.equal(status(null), 401, "asking for the sign-in prompt is never refused");
  assert.equal(status("review-test-password", "203.0.113.8"), 200, "other clients sign in at once, keyed by the entry nearest the proxy");
  now += 1000;
  assert.equal(status("wrong"), 401);
  now += 1000;
  assert.equal(status("wrong"), 429, "the delay doubles");
  now += 1000;
  assert.equal(status("review-test-password"), 200);
  assert.equal(status("wrong"), 401, "success clears the client's failures");
  for (let i = 0; i < 6; i++) status("wrong");
  now += 60 * 60_000 + 1;
  assert.equal(status("wrong"), 401, "failures are forgotten after an hour");

  now += 60 * 60_000 + 1;
  for (let i = 0; i < 21; i++) assert.equal(status("wrong", `forged-${i}`), 401);
  assert.equal(status("wrong", "forged-new"), 429, "forged client addresses share one allowance");
  assert.equal(status("review-test-password", "203.0.113.9"), 429);
  now += 1000;
  assert.equal(status("review-test-password", "203.0.113.9"), 200);
});

test("bounded multipart parsing preserves video bytes, duplicate pictures and roles", async () => {
  const form = new FormData();
  form.set("video", new File([new Uint8Array([0, 1, 255])], "clip.mp4", { type: "video/mp4" }));
  for (const name of ["one", "two"]) {
    form.append("picture", new File([name], `${name}.png`, { type: "image/png" }));
    form.append("role", name);
  }
  const parsed = await readFormData(new Request("http://localhost/api/jobs", { method: "POST", body: form }), 4096);
  assert.deepEqual(parsed.getAll("role"), ["one", "two"]);
  assert.deepEqual(parsed.getAll("picture").map((file) => (file as File).name), ["one.png", "two.png"]);
  assert.deepEqual(new Uint8Array(await (parsed.get("video") as File).arrayBuffer()), new Uint8Array([0, 1, 255]));
});

test("declared oversize bodies are rejected without reading them", async () => {
  let read = false;
  const body = new ReadableStream({ pull() { read = true; } }, { highWaterMark: 0 });
  const init = { method: "POST", body, duplex: "half", headers: { "Content-Length": "2048" } };
  await assert.rejects(readFormData(new Request("http://localhost/api/jobs", init), 1024), (e: unknown) => e instanceof HttpError && e.status === 413);
  assert.equal(read, false);
});

test("chunked uploads cannot bypass the limit with a missing or false Content-Length", async () => {
  for (const length of [null, "1"]) {
    let pulls = 0;
    let canceled = false;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) { pulls++; controller.enqueue(new Uint8Array(512)); },
      cancel() { canceled = true; },
    }, { highWaterMark: 0 });
    const headers = new Headers({ "Content-Type": "multipart/form-data; boundary=test" });
    if (length !== null) headers.set("Content-Length", length);
    const init = { method: "POST", body, duplex: "half", headers };
    await assert.rejects(readFormData(new Request("http://localhost/api/jobs", init), 1024), (e: unknown) => e instanceof HttpError && e.status === 413);
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(canceled, true);
    assert.equal(pulls, 3);
  }
});
