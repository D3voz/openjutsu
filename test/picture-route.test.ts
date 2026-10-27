import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { GET, POST } from "../app/api/picture/route.ts";
import type { ApiGraph } from "../lib/simple.ts";
import { DEFAULT_PICTURE_VIDEO } from "../lib/picture.ts";

let calls = 0, uploads = 0;
const prompts: ApiGraph[] = [];
let history: Record<string, unknown> = {};
let queued = false, rejectPrompt = false, solarInstalled = true;
let range: string | undefined;
let viewed = "";
const server = createServer(async (request, response) => {
  calls++;
  if (request.url?.startsWith("/view?")) {
    range = request.headers.range; viewed = request.url;
    response.writeHead(range ? 206 : 200, { "Content-Type": "image/png", ...(range ? { "Content-Range": "bytes 0-3/4" } : {}) });
    response.end("test"); return;
  }
  let data: unknown;
  if (request.url?.startsWith("/object_info/")) {
    const node = request.url.split("/").pop()!;
    const inputs = {
      UNETLoader: { unet_name: [[DEFAULT_PICTURE_VIDEO.model, "another_h3.safetensors"]] },
      LoraLoaderModelOnly: { lora_name: [[DEFAULT_PICTURE_VIDEO.loras[0].name, "style.safetensors", "solarrenderer_4step_lora.safetensors", "solarrenderer_control_lora.safetensors", "solar\\solarrenderer_4step_lora_rank64.safetensors", "solar\\solarrenderer_control_lora_rank64.safetensors"]] },
      CLIPLoader: { clip_name: [[DEFAULT_PICTURE_VIDEO.textEncoder, "another_encoder.safetensors"]] },
      VAELoader: { vae_name: [[DEFAULT_PICTURE_VIDEO.videoVae, DEFAULT_PICTURE_VIDEO.audioVae, "another_vae.safetensors"]] },
    };
    if (node === "SolarRendererLoraLoader" && !solarInstalled) data = {};
    else data = { [node]: { input: { required: inputs[node as keyof typeof inputs] } } };
  } else if (request.url === "/upload/image") {
    for await (const _ of request) {}
    data = { name: `uploaded-${++uploads}.png`, subfolder: "picture" };
  } else if (request.url === "/prompt") {
    const chunks = []; for await (const chunk of request) chunks.push(chunk);
    prompts.push(JSON.parse(Buffer.concat(chunks).toString()).prompt);
    if (rejectPrompt) {
      response.writeHead(400, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ node_errors: { "10": { errors: [{ message: "Value not in list", details: "Missing FLUX model" }] } } })); return;
    }
    data = { prompt_id: `picture-${prompts.length}` };
  } else if (request.url === "/queue") data = { queue_running: [], queue_pending: queued ? [[1, "picture-1"]] : [] };
  else data = history;
  response.writeHead(200, { "Content-Type": "application/json" }); response.end(JSON.stringify(data));
});
server.listen(0, "127.0.0.1"); await once(server, "listening");
process.env.COMFYUI_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
delete process.env.OPENJUTSU_PASSWORD;
test.after(() => { server.closeAllConnections(); server.close(); });
const url = "http://127.0.0.1:3000/api/picture";
function inputs() {
  const form = new FormData();
  form.set("video", new File([new Uint8Array([0, 0, 0, 0x18]), "ftypisom"], "clip.mp4", { type: "video/mp4" }));
  form.set("picture", new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])], "character.png", { type: "image/png" }));
  form.set("width", "1280"); form.set("height", "720"); form.set("start", "2.5"); form.set("seed", "42");
  return form;
}
function render(prepared: string, settings?: unknown) {
  return POST(new Request(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prepared, settings: settings ?? { ...DEFAULT_PICTURE_VIDEO, renderer: "h3", steps: 6, seed: 42 }, filename: "untrusted.png", prompt: { untrusted: true } }) }));
}
function completed() {
  return { prompt: [0, "picture-1", prompts[0]], status: { status_str: "success", completed: true }, outputs: {
    "21": { images: [{ filename: "prepared.png", subfolder: "openjutsu_picture/flux3", type: "output" }] },
    "22": { images: [{ filename: "frame.png", type: "temp" }] },
  } };
}

test("picture routes reject foreign origins, invalid IDs and invalid uploads before contacting ComfyUI", async () => {
  assert.equal((await POST(new Request(url, { method: "POST", headers: { Origin: "https://other.test" } }))).status, 403);
  assert.equal((await GET(new Request(`${url}?id=https://other.test`))).status, 400);
  assert.equal((await render("../not-a-job")).status, 400);
  const form = inputs(); form.set("picture", new File(["bad"], "fake.png"));
  assert.equal((await POST(new Request(url, { method: "POST", body: form }))).status, 400);
  assert.equal(calls, 0);
});

test("preparation submits only FLUX, preserves image order and selected frame, and uses the source aspect ratio", async () => {
  const form = inputs(); form.set("prompt", "Keep the character and background of image 1; use image 2's pose.");
  const response = await POST(new Request(url, { method: "POST", body: form }));
  assert.equal(response.status, 202); assert.equal((await response.json()).id, "picture-1");
  const graph = prompts[0];
  assert.equal(graph["1"].inputs.video, "picture/uploaded-1.png");
  assert.equal(graph["4"].inputs.image, "picture/uploaded-2.png");
  assert.equal(graph["1"].inputs.frame_load_cap, 1); assert.equal(graph["1"].inputs.skip_first_frames, 60);
  assert.equal(graph["19"].inputs.seed, 42);
  assert.equal(graph["3"].inputs.width, 1376); assert.equal(graph["3"].inputs.height, 768);
  assert.deepEqual(graph["15"].inputs["images.image0"], ["5", 0]);
  assert.deepEqual(graph["15"].inputs["images.image1"], ["3", 0]);
  assert.equal(graph["6"].inputs.value, form.get("prompt"));
  assert.ok(!Object.values(graph).some((node) => /MiniMax|Metric3D|VideoCombine/.test(node.class_type)));
  assert.equal(prompts.length, 1);
});

test("preview polling returns the image and source frame without automatically submitting a video", async () => {
  queued = true;
  assert.equal((await (await GET(new Request(`${url}?id=picture-1`))).json()).status, "processing");
  queued = false;
  assert.equal((await GET(new Request(`${url}?id=picture-1`))).status, 404);
  history = { "picture-1": completed() };
  const ready = await (await GET(new Request(`${url}?id=picture-1`))).json();
  assert.equal(ready.status, "ready"); assert.ok(ready.frame.endsWith("media=frame"));
  const response = await GET(new Request(`${url}?id=picture-1&media=result`));
  assert.equal(await response.text(), "test"); assert.ok(viewed.includes("filename=prepared.png"));
  await GET(new Request(`${url}?id=picture-1&media=frame`));
  assert.ok(viewed.includes("filename=frame.png")); assert.equal(prompts.length, 1);
});

test("explicit render uses the exact saved preview, retains the source offset and runs H3 without rerunning FLUX", async () => {
  const response = await render("picture-1");
  assert.equal(response.status, 202); assert.equal((await response.json()).id, "picture-2");
  const graph = prompts[1];
  assert.equal(graph["20"].class_type, "LoadImage"); assert.equal(graph["20"].inputs.image, "picture/uploaded-3.png");
  assert.deepEqual(graph["56"].inputs["ref_images.ref_image_0"], ["20", 0]);
  assert.equal(graph["1"].inputs.video, prompts[0]["1"].inputs.video);
  assert.equal(graph["1"].inputs.skip_first_frames, 60); assert.equal(graph["1"].inputs.frame_load_cap, 141);
  assert.equal(graph["33"].inputs.width, 864); assert.equal(graph["56"].inputs.width, 864);
  assert.equal(graph["33"].inputs.height, 480); assert.equal(graph["56"].inputs.height, 480);
  assert.equal(graph["58"].inputs.noise_seed, 42);
  assert.ok(!Object.values(graph).some((node) => /ReferenceMultiLatent|TextGenerate|SaveImage/.test(node.class_type)));
  assert.deepEqual(graph["63"].inputs.audio, ["36", 0]);
});

test("render rejects unfinished, unrelated and failed histories instead of accepting a client filename", async () => {
  const count = prompts.length;
  history = {}; assert.equal((await render("picture-1")).status, 409);
  history = { "picture-1": { prompt: [0, "picture-1", { "21": { class_type: "SaveImage" } }] } };
  assert.equal((await render("picture-1")).status, 404);
  history = { "picture-1": { ...completed(), status: { status_str: "error" } } };
  assert.equal((await render("picture-1")).status, 422); assert.equal(prompts.length, count);
});

test("render applies selected length, independent guide resolution, model components, LoRAs and steps", async () => {
  history = { "picture-1": completed() };
  const response = await render("picture-1", { ...DEFAULT_PICTURE_VIDEO, renderer: "h3", seconds: 15, resolution: { width: 640, height: 960 }, motion: 512,
    model: "another_h3.safetensors", steps: 12, seed: 99, textEncoder: "another_encoder.safetensors", videoVae: "another_vae.safetensors",
    loras: [{ name: "style.safetensors", strength: 0.6, enabled: true }, { name: "unused.safetensors", strength: 1, enabled: false }] });
  assert.equal(response.status, 202);
  const graph = prompts.at(-1)!;
  assert.equal(graph["1"].inputs.frame_load_cap, 345); assert.equal(graph["56"].inputs.length, 345);
  assert.equal(graph["56"].inputs.width, 640); assert.equal(graph["56"].inputs.height, 960);
  assert.equal(graph["33"].inputs.width, 352); assert.equal(graph["33"].inputs.height, 512);
  assert.equal(graph["50"].inputs.unet_name, "another_h3.safetensors"); assert.equal(graph["60"].inputs.steps, 12);
  assert.equal(graph["53"].inputs.clip_name, "another_encoder.safetensors"); assert.equal(graph["54"].inputs.vae_name, "another_vae.safetensors");
  assert.equal(graph["picture_lora_0"].inputs.strength_model, 0.6); assert.ok(!graph["picture_lora_1"]);
  assert.equal(graph["58"].inputs.noise_seed, 99);
  assert.ok(!Object.values(graph).some((node) => /Chain|Loop/.test(node.class_type)));
});

test("invalid render settings are rejected before submitting or copying the prepared image", async () => {
  const count = prompts.length, copied = uploads;
  for (const settings of [{ seconds: 16 }, { seconds: 0 }, { steps: 0 }, { model: "missing.safetensors" }, { textEncoder: "missing.safetensors" }, { motion: 999 }]) {
    assert.equal((await render("picture-1", { ...DEFAULT_PICTURE_VIDEO, ...settings })).status, 400);
  }
  assert.equal(prompts.length, count); assert.equal(uploads, copied);
});

test("SolarRenderer submits the saved preview with the chosen pair from root or nested folders", async () => {
  history = { "picture-1": completed() };
  for (const solarRank of [384, 64]) {
    const suffix = solarRank === 64 ? "_rank64" : "";
    const seconds = solarRank === 384 ? 9 : 15;
    const response = await render("picture-1", { ...DEFAULT_PICTURE_VIDEO, solarRank, seconds,
      solarFourStep: `solarrenderer_4step_lora${suffix}.safetensors`, solarControl: `solarrenderer_control_lora${suffix}.safetensors` });
    assert.equal(response.status, 202);
    const graph = prompts.at(-1)!;
    assert.equal(graph["56"].class_type, "SolarRendererConditioning");
    assert.deepEqual(graph["56"].inputs.first_frame, ["20", 0]);
    assert.deepEqual(graph["64"].inputs.model, ["51", 0]);
    assert.equal(graph["51"].inputs.lora_name, `${solarRank === 64 ? "solar\\" : ""}solarrenderer_4step_lora${suffix}.safetensors`);
    assert.equal(graph["64"].inputs.lora_name, `${solarRank === 64 ? "solar\\" : ""}solarrenderer_control_lora${suffix}.safetensors`);
    assert.equal(graph["59"].inputs.sampler_name, "lcm");
    assert.equal(graph["60"].inputs.steps, 4);
    assert.equal(graph["56"].inputs.length, solarRank === 384 ? 209 : 345);
    assert.equal(graph["1"].inputs.frame_load_cap, graph["56"].inputs.length);
    assert.equal(graph["1"].inputs.skip_first_frames, 60);
    assert.ok(!graph["55"]);
    assert.ok(!Object.values(graph).some((node) => /TextGenerate|ReferenceMultiLatent/.test(node.class_type)));
    assert.ok(!Object.values(graph).some((node) => /Chain|Loop/.test(node.class_type)));
  }
});

test("missing SolarRenderer nodes and unlisted paths fail before copying the image or submitting", async () => {
  const count = prompts.length, copied = uploads;
  solarInstalled = false;
  const missing = await render("picture-1", DEFAULT_PICTURE_VIDEO);
  assert.equal(missing.status, 400); assert.match((await missing.json()).error, /Install the SolarRenderer/);
  solarInstalled = true;
  assert.equal((await render("picture-1", { ...DEFAULT_PICTURE_VIDEO, solarControl: "../outside.safetensors" })).status, 400);
  assert.equal(uploads, copied); assert.equal(prompts.length, count);
});

test("video media supports seeking and submission errors identify missing models", async () => {
  history = { "picture-2": { prompt: [0, "picture-2", prompts[1]], outputs: { "63": { gifs: [{ filename: "motion.mp4", type: "output" }] } } } };
  const response = await GET(new Request(`${url}?id=picture-2&media=result`, { headers: { Range: "bytes=0-3" } }));
  assert.equal(response.status, 206); assert.equal(range, "bytes=0-3");
  assert.equal(response.headers.get("Content-Type"), "video/mp4"); assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
  assert.equal(response.headers.get("Content-Range"), "bytes 0-3/4"); await response.text();
  rejectPrompt = true;
  const rejected = await POST(new Request(url, { method: "POST", body: inputs() }));
  assert.equal(rejected.status, 502); assert.match((await rejected.json()).error, /Missing FLUX model/);
});
