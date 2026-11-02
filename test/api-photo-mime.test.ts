import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import { fakeProxy } from "./proxy.ts";
register("data:text/javascript,export const resolve = (specifier, context, next) => next(specifier === 'next/server' ? 'next/server.js' : specifier, context);");
const { POST } = await import("../app/api/jobs/route.ts");
const proxy = await fakeProxy();
process.env.COMFY_BASE_URL = process.env.COMFYUI_URL = proxy.url;
delete process.env.COMFY_API_KEY; delete process.env.OPENJUTSU_PASSWORD;
test.after(async () => {
  for (const job of proxy.jobs.values()) proxy.finish(job.id, "canceled");
  const inputs = (globalThis as { [key: symbol]: Map<string, unknown> })[Symbol.for("openjutsu.inputs")];
  for (let i = 0; i < 100 && inputs?.size; i++) await sleep(20);
  await proxy.close();
});
const video = () => new File([new Uint8Array([0, 0, 0, 24]), "ftypisom"], "source.mp4", { type: "video/mp4" });
async function post(picture: File) {
  const form = new FormData();
  for (const [key, value] of Object.entries({ mode: "simple", resolution: "480p", motion: "512", seed: "1", clip_seconds: "6", steps: "8", model: "base.safetensors" })) form.set(key, value);
  form.set("video", video()); form.set("picture", picture);
  return POST(new Request("http://localhost/api/jobs", { method: "POST", body: form }));
}
for (const [extension, bytes] of [
  ["png", Buffer.from([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10])],
  ["jpg", Buffer.from([0xff, 0xd8, 0xff, 0xe0])],
  ["webp", Buffer.from("RIFF1234WEBP", "latin1")],
] as const) test(`signature-verified ${extension} photos accept missing or generic MIME metadata`, async () => {
  for (const type of ["", "application/octet-stream"]) {
    const response = await post(new File([bytes], `character.${extension}`, { type }));
    assert.equal(response.status, 202, JSON.stringify(await response.clone().json()));
  }
});
test("a supported suffix cannot bypass the actual image signature", async () => {
  const before = proxy.uploads.length;
  assert.equal((await post(new File(["not an image"], "pretend.png"))).status, 400);
  assert.equal(proxy.uploads.length, before);
});
test("an unknown suffix and missing MIME still cannot identify a picture", async () => {
  assert.equal((await post(new File([Buffer.from([0xff, 0xd8, 0xff])], "unknown.bin"))).status, 400);
});
