import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { applyModel, DEFAULT_MODEL } from "../lib/model.ts";
import { setupGraph } from "../lib/setup.ts";
import { NODES, isLink, pruneSimple, type ApiGraph, type SimpleSettings } from "../lib/simple.ts";

const graph: ApiGraph = JSON.parse(readFileSync(new URL("../workflows/simple.api.json", import.meta.url), "utf8"));
const settings: SimpleSettings = { sceneFromPicture: true, role: "the dancer", resolution: "768p", motion: 512, hatFix: true, noLipSync: true, margin: "normal", target: "person", seed: 0, clipSeconds: 6 };

test("From picture edits the whole frame using the picture and a neutral motion guide, without ControlNet", () => {
  const result = pruneSimple(graph, settings);
  applyModel(result, DEFAULT_MODEL);
  assert.equal(result[NODES.plan].class_type, "H3SceneSwapPlan");
  assert.deepEqual(result[NODES.growMask].inputs, { value: 1, width: 64, height: 64 });
  const ref = Object.values(result).find((n) => n.class_type === "MiniMaxH3ReferenceToVideo")!;
  assert.deepEqual(ref.inputs["ref_images.ref_image_0"], [NODES.picture, 0]);
  const motion = ref.inputs["ref_videos.ref_video_0"] as [string, number];
  assert.equal(result[motion[0]].inputs.neutral_background, true);
  assert.ok(!Object.values(result).some((n) => /ControlNet|DepthAnything/.test(n.class_type)));
  for (const node of Object.values(result)) for (const value of Object.values(node.inputs)) {
    if (isLink(value)) assert.ok(result[value[0]], `missing ${value[0]}`);
  }
  assert.deepEqual(setupGraph(graph, { kind: "simple", settings, model: DEFAULT_MODEL }), result);
});

test("Simple motion transfer retains its original mask and surroundings", () => {
  const result = pruneSimple(graph, { ...settings, sceneFromPicture: false });
  assert.equal(result[NODES.plan].class_type, "H3OneClickSwapPlan");
  assert.equal(result[NODES.growMask].class_type, "GrowMaskWithBlur");
  assert.ok(!Object.values(result).some((n) => n.inputs.neutral_background));
});
