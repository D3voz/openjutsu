import assert from "node:assert/strict";
import { mkdtemp, readdir } from "node:fs/promises";
import { register } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import { fakeProxy } from "./proxy.ts";

// next/server has no exports map, so Node's ESM resolver needs the file name.
register("data:text/javascript,export const resolve = (specifier, context, next) => next(specifier === 'next/server' ? 'next/server.js' : specifier, context);");

const proxy = await fakeProxy();
const temp = await mkdtemp(join(tmpdir(), "openjutsu-test-"));
process.env.COMFY_BASE_URL = proxy.url;
process.env.COMFYUI_URL = `${proxy.url}/`;
process.env.TMPDIR = temp;
delete process.env.OPENJUTSU_PASSWORD;
delete process.env.COMFY_API_KEY;
const { POST } = await import("../app/api/jobs/route.ts");
const { GET: getModels } = await import("../app/api/models/route.ts");
const { GET: getOutput } = await import("../app/api/jobs/[id]/outputs/[outputId]/route.ts");
const { client } = await import("../lib/comfy.ts");
// Each submitted job is watched until it ends; end them all so the watchers return.
test.after(async () => {
  for (const job of proxy.jobs.values()) if (job.status === "queued") proxy.finish(job.id, "canceled");
  const inputs = (globalThis as { [key: symbol]: Map<string, unknown> })[Symbol.for("openjutsu.inputs")];
  await until(() => inputs.size === 0);
  await proxy.close();
});

let unique = 0;
const mp4 = () => new File([new Uint8Array([0, 0, 0, 0x18]), "ftypisom", `clip ${++unique}`], "clip.mp4", { type: "video/mp4" });
const png = () => new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), `photo ${++unique}`], "photo.png", { type: "image/png" });
const SIMPLE = { mode: "simple", role: "", resolution: "480p", motion: "512", seed: "1", clip_seconds: "6", steps: "8", model: "base.safetensors" };

function post(fields: Record<string, string | File>) {
  const form = new FormData();
  for (const [name, value] of Object.entries(fields)) form.append(name, value);
  return POST(new Request("http://127.0.0.1:3000/api/jobs", { method: "POST", body: form }));
}

async function until(condition: () => boolean) {
  for (let waited = 0; !condition(); waited += 50) {
    if (waited > 8000) throw new Error("Timed out");
    await sleep(50);
  }
}

const leftovers = async () => (await readdir(temp)).filter((name) => name.startsWith("openjutsu-"));

test("uploads stream from temp files, which are gone once the job is submitted", async () => {
  const video = mp4();
  const response = await post({ ...SIMPLE, video, picture: png() });
  assert.equal(response.status, 202, JSON.stringify(await response.clone().json()));
  const job = await response.json();
  const inputs = proxy.jobs.get(job.id)!.inputs.map((id) => proxy.assets.get(id)!);
  assert.deepEqual(inputs.map((asset) => [asset.filePath, asset.size]).sort(), [["clip.mp4", video.size], ["photo.png", 8 + `photo ${unique}`.length]]);
  assert.deepEqual(await leftovers(), []);
});

test("files are checked by their first bytes, not their declared type", async () => {
  const uploads = proxy.uploads.length;
  const fake = new File(["<html>not a video</html>"], "clip.mp4", { type: "video/mp4" });
  let response = await post({ mode: "mask", video: fake });
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /MP4, MOV, MKV, WebM or AVI/);
  response = await post({ ...SIMPLE, video: mp4(), picture: new File(["GIF89a......"], "photo.png", { type: "image/png" }) });
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /PNG, JPEG or WebP/);
  response = await post({ mode: "mask", video: new File([], "clip.mp4", { type: "video/mp4" }) });
  assert.equal((await response.json()).error, "Drop a source video.");
  assert.equal(proxy.uploads.length, uploads);
  assert.deepEqual(await leftovers(), []);
});

test("a job's uploads are deleted once it ends, and never its outputs", async () => {
  const job = await (await post({ mode: "mask", video: mp4() })).json();
  const [input] = proxy.jobs.get(job.id)!.inputs;
  const result = proxy.output(job.id, "video/mp4");
  await sleep(700);
  assert.deepEqual(proxy.deleted, [], "a running job keeps its inputs");
  proxy.finish(job.id, "failed", [result]);
  await until(() => proxy.deleted.includes(input));
  assert.ok(proxy.assets.has(result.id));
});

test("a shared upload is deleted after the last job using it, and one this app did not upload is kept", async () => {
  const video = mp4();
  const first = await (await post({ mode: "mask", video })).json();
  const second = await (await post({ mode: "people", role: "the dancer", resolution: "480p", video })).json();
  const [input] = proxy.jobs.get(first.id)!.inputs;
  assert.deepEqual(proxy.jobs.get(second.id)!.inputs, [input], "the proxy hands identical bytes the same asset");
  proxy.finish(first.id);
  await sleep(1500);
  assert.ok(!proxy.deleted.includes(input));
  proxy.finish(second.id, "canceled");
  await until(() => proxy.deleted.includes(input));
  assert.equal(proxy.deleted.filter((id) => id === input).length, 1);

  const bytes = new Uint8Array(await mp4().arrayBuffer());
  const theirs = await client().assets.fromBytes(bytes, { filename: "clip.mp4" }).commit();
  const reused = await (await post({ mode: "mask", video: new File([bytes], "clip.mp4", { type: "video/mp4" }) })).json();
  assert.deepEqual(proxy.jobs.get(reused.id)!.inputs, [theirs]);
  proxy.finish(reused.id);
  await sleep(1500);
  assert.ok(proxy.assets.has(theirs));
});

test("uploads for a submission the proxy rejects are deleted at once", async () => {
  proxy.state.rejectJobs = true;
  const response = await post({ mode: "mask", video: mp4() });
  proxy.state.rejectJobs = false;
  assert.equal(response.status, 502);
  const upload = proxy.uploads.at(-1)!;
  assert.ok(proxy.deleted.includes(upload.id));
  assert.deepEqual(await leftovers(), []);
});

test("outputs are served only for their own job, as video, image or JSON, with nosniff", async () => {
  const job = await (await post({ mode: "mask", video: mp4() })).json();
  const other = await (await post({ mode: "mask", video: mp4() })).json();
  const [input] = proxy.jobs.get(job.id)!.inputs;
  const preview = proxy.output(job.id, "image/png", "png");
  const foreign = proxy.output(other.id, "image/png", "theirs");
  const page = proxy.output(job.id, "text/html", "<script>alert(1)</script>");
  const loose = proxy.output(undefined, "image/png", "no job");
  const fetchOutput = (outputId: string) => getOutput(new Request(`http://127.0.0.1:3000/api/jobs/${job.id}/outputs/${outputId}`), { params: Promise.resolve({ id: job.id, outputId }) });

  let response = await fetchOutput(preview.id);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Content-Type"), "image/png");
  assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
  assert.equal(await response.text(), "png");
  for (const id of [input, foreign.id, loose.id, "missing"]) assert.equal((await fetchOutput(id)).status, 404, id);
  assert.equal((await fetchOutput(page.id)).status, 502);

  const data = proxy.output(job.id, "application/json; charset=utf-8", "{}");
  proxy.finish(job.id, "succeeded", [data]);
  response = await fetchOutput(data.id);
  assert.equal(response.headers.get("Content-Type"), "application/json");
  assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
});

test("COMFYUI_URL may end in a slash, and a failed model list is reported instead of skipping the check", async () => {
  assert.deepEqual(await (await getModels(new Request("http://127.0.0.1:3000/api/models"))).json(), { models: ["base.safetensors"], loras: ["style.safetensors", "minimax_h3_DMAD.safetensors"], textEncoders: ["encoder.safetensors"], vaes: ["video.safetensors", "audio.safetensors"] });
  let response = await post({ ...SIMPLE, model: "other.safetensors", video: mp4(), picture: png() });
  assert.equal((await response.json()).error, "Choose a base model ComfyUI has.");

  const unet = proxy.models.UNETLoader;
  Reflect.deleteProperty(proxy.models, "UNETLoader");
  try {
    response = await getModels(new Request("http://127.0.0.1:3000/api/models"));
    assert.equal(response.status, 502);
    assert.deepEqual({ ...(await response.json()), error: undefined }, { models: [], loras: [], textEncoders: [], vaes: [], error: undefined });
    response = await post({ ...SIMPLE, video: mp4(), picture: png() });
    assert.equal(response.status, 502);
    assert.match((await response.json()).error, /COMFYUI_URL/);
  } finally {
    proxy.models.UNETLoader = unet;
  }
});

test("three uploads can arrive at once, and a fourth is asked to wait", async () => {
  const stalled = Array.from({ length: 3 }, () => {
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const body = new ReadableStream<Uint8Array>({ start(c) { controller = c; } });
    const headers = { "Content-Type": "multipart/form-data; boundary=x" };
    return { controller, response: POST(new Request("http://127.0.0.1:3000/api/jobs", { method: "POST", body, duplex: "half", headers } as RequestInit)) };
  });
  const busy = await post({ mode: "mask", video: mp4() });
  assert.equal(busy.status, 429);
  for (const { controller } of stalled) controller.close();
  for (const { response } of stalled) assert.equal((await response).status, 400);
  assert.equal((await post({ mode: "mask", video: mp4() })).status, 202);
  assert.deepEqual(await leftovers(), []);
});

test("encoder and VAE selections are validated against ComfyUI before uploads", async () => {
  const uploads = proxy.uploads.length;
  for (const field of ["text_encoder", "video_vae", "audio_vae"]) {
    const response = await post({ ...SIMPLE, [field]: "missing.safetensors", video: mp4(), picture: png() });
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /ComfyUI has/);
  }
  assert.equal(proxy.uploads.length, uploads);
  const response = await post({ ...SIMPLE, text_encoder: "encoder.safetensors", video_vae: "video.safetensors", audio_vae: "audio.safetensors", acceleration: "spectrum", video: mp4(), picture: png() });
  assert.equal(response.status, 202, JSON.stringify(await response.clone().json()));
});

test("the submission API rejects Spectrum with known or manually marked speed LoRAs", async () => {
  const uploads = proxy.uploads.length;
  for (const fields of [
    { lora: "minimax_h3_DMAD.safetensors", lora_speed: "false" },
    { lora: "style.safetensors", lora_speed: "true" },
  ]) {
    const response = await post({ ...SIMPLE, ...fields, lora_strength: "1", acceleration: "spectrum", video: mp4(), picture: png() });
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /speed LoRA/);
  }
  const invalid = await post({ ...SIMPLE, acceleration: "unknown", video: mp4(), picture: png() });
  assert.equal(invalid.status, 400);
  assert.equal(proxy.uploads.length, uploads);
  const response = await post({ ...SIMPLE, lora: "style.safetensors", lora_strength: "1", acceleration: "spectrum", video: mp4(), picture: png() });
  assert.equal(response.status, 202);
});


test("visual describers are validated before upload and reach swaps and Find people", async () => {
  for (const mode of ["simple", "people"]) {
    const uploads = proxy.uploads.length;
    const invalid = await post({ ...SIMPLE, mode, role: "the dancer - white polo, jeans", describer: "../missing.safetensors", video: mp4(), picture: png() });
    assert.equal(invalid.status, 400);
    assert.match((await invalid.json()).error, /visual describer/);
    assert.equal(proxy.uploads.length, uploads);
    const response = await post({ ...SIMPLE, mode, role: "the dancer - white polo, jeans", describer: "encoder.safetensors", video: mp4(), picture: png() });
    assert.equal(response.status, 202, JSON.stringify(await response.clone().json()));
    const job = await response.json();
    const workflow = JSON.stringify(proxy.jobs.get(job.id)!.workflow);
    assert.match(workflow, /encoder\.safetensors/);
    assert.doesNotMatch(workflow, /qwen3vl_8b_int8_convrot/);
  }
});
