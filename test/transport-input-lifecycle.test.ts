import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import { fakeProxy } from "./proxy.ts";
register("data:text/javascript,export const resolve = (specifier, context, next) => next(specifier === 'next/server' ? 'next/server.js' : specifier, context);");
const { POST } = await import("../app/api/jobs/route.ts");

test("a completing job cannot delete an input while another job acquires its deduplicated identity", async (t) => {
  const proxy = await fakeProxy();
  const previous = process.env.COMFY_BASE_URL;
  process.env.COMFY_BASE_URL = proxy.url;
  const realFetch = globalThis.fetch;
  let release!: () => void;
  const barrier = new Promise<void>((resolve) => { release = resolve; });
  t.after(async () => {
    release(); globalThis.fetch = realFetch;
    for (const job of proxy.jobs.values()) proxy.finish(job.id, "canceled");
    await sleep(1000); await proxy.close();
    if (previous === undefined) delete process.env.COMFY_BASE_URL; else process.env.COMFY_BASE_URL = previous;
  });
  const post = () => {
    const form = new FormData(); form.set("mode", "mask");
    form.set("video", new File([new Uint8Array([0, 0, 0, 24]), "ftypisom", "shared"], "clip.mp4", { type: "video/mp4" }));
    return POST(new Request("http://localhost/api/jobs", { method: "POST", body: form }));
  };
  const first = await (await post()).json();
  let arrived!: () => void;
  const ready = new Promise<void>((resolve) => { arrived = resolve; });
  let held = false;
  globalThis.fetch = async (input, init) => {
    const response = await realFetch(input, init);
    if (String(input).endsWith("/assets/from-hash") && !held) { held = true; arrived(); await barrier; }
    return response;
  };
  const pending = post();
  await Promise.race([ready, sleep(4000).then(() => { throw new Error("dedup request did not arrive"); })]);
  proxy.finish(first.id);
  // Give the first job's independent watcher time to observe completion.
  await sleep(1200);
  release();
  const response = await pending;
  assert.equal(response.status, 202, JSON.stringify(await response.clone().json()));
  const second = await response.json();
  const [input] = proxy.jobs.get(second.id)!.inputs;
  assert.ok(proxy.assets.has(input));
  assert.ok(!proxy.deleted.includes(input));
  proxy.finish(second.id);
  for (let i = 0; i < 100 && !proxy.deleted.includes(input); i++) await sleep(20);
  assert.ok(proxy.deleted.includes(input), "final lease releases the owned input");

  let failCommit = true;
  globalThis.fetch = async (input, init) => {
    if (String(input).endsWith("/api/v2/assets") && init?.method === "POST" && failCommit) {
      failCommit = false; throw new Error("simulated upload disconnect");
    }
    return realFetch(input, init);
  };
  assert.equal((await post()).status, 502, "an acquisition failure releases the input lock");
  globalThis.fetch = realFetch;
  proxy.state.rejectJobs = true;
  assert.equal((await post()).status, 502);
  proxy.state.rejectJobs = false;
  const recovered = await post();
  assert.equal(recovered.status, 202, "a rejected submission does not leave the queue locked");
  const recoveredJob = await recovered.json(); proxy.finish(recoveredJob.id);
  for (let i = 0; i < 100 && proxy.assets.size; i++) await sleep(20);
  assert.equal(proxy.assets.size, 0, "failed and completed submissions leave no orphaned input");
});
