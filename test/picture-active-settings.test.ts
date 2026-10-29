import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { applyPictureVideoSettings, DEFAULT_PICTURE_VIDEO, parsePictureVideoSettings } from "../lib/picture.ts";
import { isLink, type ApiGraph } from "../lib/simple.ts";

function render(input: unknown, renderer: "solar" | "motion") {
  const settings = parsePictureVideoSettings(input);
  const graph: ApiGraph = JSON.parse(readFileSync(new URL(`../workflows/picture/from_picture_${renderer}_flux3.api.json`, import.meta.url), "utf8"));
  // Like the render route, use the saved approved image instead of rerunning FLUX.
  graph["20"] = { class_type: "LoadImage", inputs: { image: "approved-image.png" } };
  applyPictureVideoSettings(graph, settings, 768, 1376);
  const reached = new Set<string>();
  function visit(id: string) {
    if (reached.has(id)) return;
    reached.add(id);
    assert.ok(graph[id], `Missing submitted dependency ${id}`);
    for (const value of Object.values(graph[id].inputs)) if (isLink(value)) visit(value[0]);
  }
  visit("63");
  return { settings, graph, submitted: [...reached].map((id) => graph[id]) };
}

test("switching to Solar does not require the hidden H3 audio VAE or inactive H3 strengths", () => {
  const { settings, submitted } = render({ ...DEFAULT_PICTURE_VIDEO, audioVae: "", loras: [{ name: "old-h3.safetensors", strength: 5, enabled: true }] }, "solar");
  assert.equal(settings.audioVae, "", "preserve the dormant preference instead of replacing it");
  assert.ok(!submitted.some((node) => node.class_type === "LoraLoaderModelOnly"));
  assert.deepEqual(submitted.filter((node) => node.class_type === "VAELoader").map((node) => node.inputs.vae_name), [settings.videoVae]);
});

test("switching to H3 does not require its hidden Solar LoRA filenames", () => {
  const { submitted } = render({ ...DEFAULT_PICTURE_VIDEO, renderer: "h3", solarFourStep: "", solarControl: "" }, "motion");
  assert.ok(!submitted.some((node) => node.class_type.startsWith("SolarRenderer")));
  assert.ok(submitted.some((node) => node.class_type === "LoraLoaderModelOnly"));
});

test("turning off LoRAs or an individual entry skips its inactive strength constraint", () => {
  const loras = [{ name: "old-style.safetensors", strength: 5, enabled: true }];
  const off = render({ ...DEFAULT_PICTURE_VIDEO, renderer: "h3", useLoras: false, loras }, "motion");
  assert.ok(!off.submitted.some((node) => node.class_type === "LoraLoaderModelOnly"));
  const skipped = render({ ...DEFAULT_PICTURE_VIDEO, renderer: "h3", loras: [{ ...loras[0], enabled: false }, { name: "active.safetensors", strength: 0.5, enabled: true }] }, "motion");
  assert.deepEqual(skipped.submitted.filter((node) => node.class_type === "LoraLoaderModelOnly").map((node) => node.inputs.lora_name), ["active.safetensors"]);
});

test("selected renderer components and enabled LoRA strengths remain required", () => {
  assert.throws(() => parsePictureVideoSettings({ ...DEFAULT_PICTURE_VIDEO, renderer: "h3", audioVae: "" }));
  for (const key of ["solarFourStep", "solarControl"] as const) assert.throws(() => parsePictureVideoSettings({ ...DEFAULT_PICTURE_VIDEO, [key]: "" }));
  assert.throws(() => parsePictureVideoSettings({ ...DEFAULT_PICTURE_VIDEO, renderer: "h3", loras: [{ name: "active.safetensors", strength: 5, enabled: true }] }));
});
