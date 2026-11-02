import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "node:module";
import test from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import { act } from "react";
import { setupGraph, type SetupRequest } from "../lib/setup.ts";
import type { ApiGraph } from "../lib/simple.ts";
import { mountEditor } from "./editor-dom.ts";
import { fakeProxy } from "./proxy.ts";

register("data:text/javascript,export const resolve = (specifier, context, next) => next(specifier === 'next/server' ? 'next/server.js' : specifier, context);");
const source = (): ApiGraph => JSON.parse(readFileSync(new URL("../workflows/mask.api.json", import.meta.url), "utf8"));
const mask = { kind: "mask", hatFix: false, margin: "normal", target: "person" } as const;

test("mask setup crops both SAM and the preview to the generation's custom canvas", () => {
  const selection: SetupRequest = { ...mask, resolution: { width: 512, height: 768 } };
  const graph = setupGraph(source(), selection);
  assert.equal(graph.custom_size?.class_type, "ImageScale");
  assert.deepEqual(graph.custom_size.inputs, { image: ["1", 0], upscale_method: "bilinear", width: 512, height: 768, crop: "center" });
  assert.deepEqual(graph["5"].inputs.image, ["custom_size", 0], "SAM sees the cropped source");
  assert.deepEqual(graph["4"].inputs.image, ["custom_size", 0], "the preview sees that same source");
});

for (const resolution of [undefined, "480p"] as const) test(`mask setup preserves the source shape for ${resolution ?? "legacy omitted resolution"}`, () => {
  const graph = setupGraph(source(), { ...mask, resolution });
  assert.equal(graph.custom_size, undefined);
  assert.deepEqual(graph["5"].inputs.image, ["1", 0]);
});

const proxy = await fakeProxy();
process.env.COMFY_BASE_URL = proxy.url;
delete process.env.OPENJUTSU_PASSWORD;
delete process.env.COMFY_API_KEY;
const { POST } = await import("../app/api/jobs/route.ts");
test.after(async () => {
  for (const job of proxy.jobs.values()) proxy.finish(job.id, "canceled");
  for (let n = 0; n < 160; n++) {
    const inputs = (globalThis as { [key: symbol]: Map<string, unknown> })[Symbol.for("openjutsu.inputs")];
    if (!inputs?.size) break;
    await sleep(50);
  }
  await proxy.close();
});

async function post(resolution: string) {
  const form = new FormData();
  form.set("mode", "mask"); form.set("resolution", resolution);
  form.set("video", new File([new Uint8Array([0, 0, 0, 24]), "ftypisom", "clip"], "clip.mp4", { type: "video/mp4" }));
  return POST(new Request("http://127.0.0.1:3000/api/jobs", { method: "POST", body: form }));
}

test("the actual submitted mask workflow retains the requested crop", async () => {
  const response = await post("512x768");
  assert.equal(response.status, 202);
  const job = await response.json();
  const graph = proxy.jobs.get(job.id)!.workflow as ApiGraph;
  assert.equal(graph.custom_size?.inputs.width, 512);
  assert.equal(graph.custom_size?.inputs.height, 768);
  assert.deepEqual(graph["5"].inputs.image, ["custom_size", 0]);
});

test("an invalid mask canvas is rejected before uploading", async () => {
  const uploads = proxy.uploads.length;
  assert.equal((await post("9000x768")).status, 400);
  assert.equal(proxy.uploads.length, uploads);
});

test("Check mask sends the custom canvas to both setup and job submission", async () => {
  const requests: { url: string; body: unknown }[] = [];
  const editor = await mountEditor({
    storage: { "openjutsu.settings": { resolution: { width: 512, height: 768 } } },
    fetch: async (url, init) => {
      if (String(url) === "/api/setup") {
        requests.push({ url: String(url), body: JSON.parse(init!.body as string) });
        return Response.json({ ok: true, packs: [], models: [] });
      }
      if (String(url) === "/api/jobs") {
        requests.push({ url: String(url), body: (init!.body as FormData).get("resolution") });
        return Response.json({ id: "mask", status: "queued" }, { status: 202 });
      }
      return Response.json(String(url).includes("presets") ? { tone: [] } : { models: [], loras: [], textEncoders: [], vaes: [] });
    },
  });
  try {
    await editor.metadata(await editor.chooseVideo("landscape.mp4"), 10, 1920, 1080);
    const check = [...editor.container.querySelectorAll("button")].find((button) => button.textContent === "Check mask")!;
    await act(async () => check.click());
    assert.deepEqual((requests[0].body as { resolution: unknown }).resolution, { width: 512, height: 768 });
    assert.equal(requests[1].body, "512x768");
  } finally { await editor.close(); }
});
