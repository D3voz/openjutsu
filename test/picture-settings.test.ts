import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { applyPictureVideoSettings, DEFAULT_PICTURE_VIDEO, parsePictureVideoSettings, pictureFrames } from "../lib/picture.ts";
import type { ApiGraph } from "../lib/simple.ts";

const graph = (): ApiGraph => JSON.parse(readFileSync(new URL("../workflows/picture/from_picture_motion_flux3.api.json", import.meta.url), "utf8"));

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
  assert.deepEqual(value["52"].inputs.model, ["picture_lora_1", 0]);
  assert.ok(!value["51"]); assert.equal(value["60"].inputs.steps, 25);
  const plain = graph();
  applyPictureVideoSettings(plain, { ...settings, useLoras: false }, 768, 1376);
  assert.deepEqual(plain["52"].inputs.model, ["50", 0]);
  assert.ok(!Object.values(plain).some((node) => node.class_type === "LoraLoaderModelOnly"));
});

test("default settings keep the tested canvas, length and DMAD configuration", () => {
  const value = graph();
  applyPictureVideoSettings(value, parsePictureVideoSettings(undefined), 768, 1376);
  assert.equal(value["56"].inputs.length, 141); assert.equal(value["1"].inputs.frame_load_cap, 141);
  assert.equal(value["56"].inputs.width, 480); assert.equal(value["56"].inputs.height, 864);
  assert.equal(value["33"].inputs.width, 480); assert.equal(value["33"].inputs.height, 864);
  assert.equal(value["picture_lora_0"].inputs.lora_name, DEFAULT_PICTURE_VIDEO.loras[0].name);
  assert.equal(value["60"].inputs.steps, 6);
  assert.ok(!Object.values(value).some((node) => /Chain|Loop/.test(node.class_type)));
});
