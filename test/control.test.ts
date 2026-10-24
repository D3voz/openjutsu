import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { nodeByTitle } from "../lib/advanced.ts";
import { CONTROL_MAX_SECONDS, CONTROL_PICTURE, CONTROL_VIDEO, pruneControl, setControlSection, type ControlSettings } from "../lib/control.ts";
import { applyModel } from "../lib/model.ts";
import { isLink, type ApiGraph } from "../lib/simple.ts";

const graph: ApiGraph = JSON.parse(readFileSync(new URL("../workflows/control.api.json", import.meta.url), "utf8"));
const settings = (noLipSync: boolean): ControlSettings => ({ target: "dancer", resolution: "480p", noLipSync, seed: 3 });
const byClass = (g: ApiGraph, type: string) => Object.keys(g).filter((id) => g[id].class_type === type);
const dangling = (g: ApiGraph) => Object.values(g).flatMap((node) => Object.values(node.inputs)).filter((v) => isLink(v) && !g[v[0]]);

test("the export regenerates the whole frame from the picture, held by the person depth", () => {
  assert.equal(graph[nodeByTitle(graph, CONTROL_VIDEO)].class_type, "VHS_LoadVideo");
  assert.equal(graph[nodeByTitle(graph, CONTROL_PICTURE)].class_type, "LoadImage");
  const [fun] = byClass(graph, "MiniMaxH3FunControlNetApply");
  assert.deepEqual(graph[fun].inputs.control_video, [nodeByTitle(graph, "Depth of the main person only (control video)"), 0]);
  for (const id of byClass(graph, "BasicGuider").concat(byClass(graph, "BasicScheduler"))) assert.deepEqual(graph[id].inputs.model, [fun, 0]);
  const whole = nodeByTitle(graph, "Whole frame (regenerate everything)");
  for (const type of ["MiniMaxH3FantasticVideoEditLatent", "MiniMaxH3ContexMaskedTarget"]) assert.deepEqual(graph[byClass(graph, type)[0]].inputs.mask, [whole, 0]);
  const ref = graph[byClass(graph, "MiniMaxH3ReferenceToVideo")[0]].inputs;
  assert.ok(ref["ref_images.ref_image_0"] && !ref["ref_videos.ref_video_0"], "the picture only, no source video reference");
});

test("settings reach the plan and SAM; No lip-sync off rewires the audio and drops the prompt switch", () => {
  const pruned = pruneControl(graph, settings(false));
  const plan = pruned[nodeByTitle(pruned, "Swap Plan (roles, seed, size)")].inputs;
  assert.deepEqual([plan.resolution, plan.seed, plan.clip_seconds, plan.roles, plan.no_lip_sync], ["480p", 3, CONTROL_MAX_SECONDS, "", undefined]);
  assert.equal(pruned[nodeByTitle(pruned, "SAM: what to replace")].inputs.text, "dancer");
  assert.equal(byClass(pruned, "AudioAdjustVolume").length, 0);
  assert.deepEqual(dangling(pruned), []);
  assert.equal(byClass(pruneControl(graph, settings(true)), "AudioAdjustVolume").length, 2);
  assert.ok(byClass(graph, "AudioAdjustVolume").length === 2, "the source graph is not modified");
});

test("the video is cut to one clip of at most 15 s", () => {
  const frames = (section: { start: number; length: number }) => {
    const pruned = pruneControl(graph, settings(true));
    setControlSection(pruned, section);
    const loader = pruned[nodeByTitle(pruned, CONTROL_VIDEO)].inputs;
    return [loader.skip_first_frames, loader.frame_load_cap];
  };
  assert.deepEqual(frames({ start: 0, length: 0 }), [0, 360]);
  assert.deepEqual(frames({ start: 2, length: 20 }), [48, 360]);
  assert.deepEqual(frames({ start: 1, length: 8 }), [24, 192]);
});

test("the model settings apply to the picture plan", () => {
  const pruned = pruneControl(graph, settings(true));
  applyModel(pruned, { model: "other.safetensors", loras: [], steps: 9 });
  assert.equal(pruned[byClass(pruned, "H3PictureSwapPlan")[0]].inputs.steps, 9);
  assert.deepEqual(dangling(pruned), []);
});
