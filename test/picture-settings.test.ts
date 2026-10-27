import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { applyPictureVideoSettings, DEFAULT_PICTURE_VIDEO, parsePictureVideoSettings, pictureFrames, solarLoraFiles, pictureLoras } from "../lib/picture.ts";
import type { ApiGraph } from "../lib/simple.ts";

const graph = (renderer = "motion"): ApiGraph => JSON.parse(readFileSync(new URL(`../workflows/picture/from_picture_${renderer}_flux3.api.json`, import.meta.url), "utf8"));

test("single-clip length is aligned down without exceeding the selected duration or 15 seconds", () => {
  assert.equal(pictureFrames(6), 141);
  assert.equal(pictureFrames(15), 345);
  assert.equal(pictureFrames(1), 22);
  for (const seconds of [5 / 24, 1, 2.5, 6, 9.3, 15]) {
    const frames = pictureFrames(seconds);
    assert.equal(frames % 17, 5); assert.ok(frames / 24 <= seconds + 1e-6);
  }
  assert.throws(() => parsePictureVideoSettings({ seconds: 15.1 }), /15 seconds/);
});

test("video and normal-map reference dimensions can be set independently", () => {
  const value = graph();
  applyPictureVideoSettings(value, parsePictureVideoSettings({ resolution: "768p", motion: 512 }), 768, 1376);
  assert.equal(value["56"].inputs.width, 768); assert.equal(value["56"].inputs.height, 1376);
  assert.equal(value["33"].inputs.width, 288); assert.equal(value["33"].inputs.height, 512);
  applyPictureVideoSettings(value, parsePictureVideoSettings({ resolution: { width: 650, height: 970 }, motion: 0 }), 768, 1376);
  assert.equal(value["56"].inputs.width, 640); assert.equal(value["33"].inputs.width, 640);
  assert.equal(value["56"].inputs.height, 960); assert.equal(value["33"].inputs.height, 960);
});

test("LoRAs are applied in order, disabled entries are skipped, and turning them off uses the base directly", () => {
  const value = graph();
  const settings = parsePictureVideoSettings({ model: "base.safetensors", steps: 25, loras: [
    { name: "first.safetensors", strength: 0.7, enabled: true },
    { name: "disabled.safetensors", strength: 1, enabled: false },
    { name: "last.safetensors", strength: -0.2, enabled: true },
  ] });
  applyPictureVideoSettings(value, settings, 768, 1376);
  assert.deepEqual(value["picture_lora_0"].inputs.model, ["50", 0]);
  assert.deepEqual(value["picture_lora_1"].inputs.model, ["picture_lora_0", 0]);
  assert.equal(value["picture_lora_1"].inputs.lora_name, "last.safetensors");
  assert.deepEqual(value["49"].inputs.model, ["picture_lora_1", 0]);
  assert.deepEqual(value["52"].inputs.model, ["49", 0]);
  assert.ok(!value["51"]); assert.equal(value["60"].inputs.steps, 25);
  const plain = graph();
  applyPictureVideoSettings(plain, { ...settings, useLoras: false }, 768, 1376);
  assert.deepEqual(plain["49"].inputs.model, ["50", 0]);
  assert.deepEqual(plain["52"].inputs.model, ["49", 0]);
  assert.ok(!Object.values(plain).some((node) => node.class_type === "LoraLoaderModelOnly"));
});

test("default settings keep the tested canvas, length and fleet H3 configuration", () => {
  const value = graph();
  applyPictureVideoSettings(value, parsePictureVideoSettings({ renderer: "h3", steps: 8 }), 768, 1376);
  assert.equal(value["56"].inputs.length, 141); assert.equal(value["1"].inputs.frame_load_cap, 141);
  assert.equal(value["56"].inputs.width, 480); assert.equal(value["56"].inputs.height, 864);
  assert.equal(value["33"].inputs.width, 480); assert.equal(value["33"].inputs.height, 864);
  assert.equal(value["picture_lora_0"].inputs.lora_name, DEFAULT_PICTURE_VIDEO.loras[0].name);
  assert.equal(value["60"].inputs.steps, 8);
  assert.ok(!Object.values(value).some((node) => /Chain|Loop/.test(node.class_type)));
});


test("picture rendering uses the same Comfy Kitchen attention backend as the other tabs", () => {
  for (const useLoras of [true, false]) {
    const value = graph();
    applyPictureVideoSettings(value, parsePictureVideoSettings({ useLoras }), 768, 1376);
    assert.equal(value["49"].class_type, "ModelAttentionBackend");
    assert.equal(value["49"].inputs.attention, "comfy kitchen attention");
    assert.deepEqual(value["52"].inputs.model, ["49", 0]);
    assert.deepEqual(value["57"].inputs.model, ["52", 0]);
    assert.deepEqual(value["60"].inputs.model, ["52", 0]);
  }
});

test("SolarRenderer selects both ranks in root or nested LoRA folders without changing custom paths", () => {
  const root = solarLoraFiles(384);
  assert.deepEqual(solarLoraFiles(384, Object.values(root)), root);
  const nested = Object.values(solarLoraFiles(64)).map((name) => `solar\\${name}`);
  assert.deepEqual(Object.values(solarLoraFiles(64, nested)), nested);
  assert.equal(solarLoraFiles(384, [`other/${root.solarFourStep}`, root.solarFourStep]).solarFourStep, root.solarFourStep);
  const custom = parsePictureVideoSettings({ ...DEFAULT_PICTURE_VIDEO, solarFourStep: "my/four.safetensors", solarControl: "renamed/control.safetensors" });
  assert.deepEqual(pictureLoras(custom), ["my/four.safetensors", "renamed/control.safetensors"]);
});

test("SolarRenderer preserves the tested loader order, silent sampling, LCM and frame-aligned conditioning", () => {
  for (const solarRank of [384, 64] as const) {
    const value = graph("solar");
    const settings = parsePictureVideoSettings({ ...DEFAULT_PICTURE_VIDEO, solarRank, ...solarLoraFiles(solarRank), resolution: "768p", seed: 123 });
    applyPictureVideoSettings(value, settings, 1080, 1920);
    assert.equal(value["51"].class_type, "SolarRendererLoraLoader");
    assert.equal(value["64"].inputs.lora_name, settings.solarControl);
    assert.equal(value["51"].inputs.lora_name, settings.solarFourStep);
    assert.deepEqual(value["64"].inputs.model, ["51", 0]);
    assert.deepEqual(value["49"].inputs.model, ["64", 0]);
    assert.equal(value["52"].inputs.shift_audio, 3);
    assert.equal(value["65"].inputs.seed, 123);
    assert.equal(value["56"].class_type, "SolarRendererConditioning");
    assert.deepEqual(value["56"].inputs.first_frame, ["20", 0]);
    assert.deepEqual(value["56"].inputs.structure, ["33", 0]);
    assert.equal(value["56"].inputs.width, 768); assert.equal(value["56"].inputs.height, 1376);
    assert.equal(value["56"].inputs.length, 141);
    assert.equal(value["59"].inputs.sampler_name, "lcm");
    assert.equal(value["60"].class_type, "SolarRendererSigmas"); assert.equal(value["60"].inputs.steps, 4);
    assert.deepEqual(value["62"].inputs.samples, ["66", 0]);
    assert.deepEqual(value["63"].inputs.audio, ["36", 0]);
    assert.ok(!value["55"]);
  }
  assert.equal(parsePictureVideoSettings(undefined).renderer, "solar");
  assert.equal(parsePictureVideoSettings({ seconds: 15 }).renderer, "h3");
  assert.equal(parsePictureVideoSettings({ ...DEFAULT_PICTURE_VIDEO, seconds: 15 }).seconds, 15);
  assert.throws(() => parsePictureVideoSettings({ ...DEFAULT_PICTURE_VIDEO, seconds: 0.5 }), /at least 22 frames/);
  assert.throws(() => parsePictureVideoSettings({ ...DEFAULT_PICTURE_VIDEO, solarRank: 12 }), /rank/);
});
