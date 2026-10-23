import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { nodeByTitle } from "../lib/advanced.ts";
import { applyModel, DEFAULT_MODEL } from "../lib/model.ts";
import { OBJECT_PICTURE, OBJECT_VIDEO, pruneObject, type ObjectSettings } from "../lib/object.ts";
import { isLink, type ApiGraph } from "../lib/simple.ts";

const graph: ApiGraph = JSON.parse(readFileSync(new URL("../workflows/object.api.json", import.meta.url), "utf8"));
const settings = (mode: ObjectSettings["mode"]): ObjectSettings => ({
  mode, target: "hair", changeTo: "pink hair", biggestOnly: true, keepOutline: false, resolution: "480p", motion: 512, margin: "loose", seed: 5, clipSeconds: 4,
});
const dangling = (g: ApiGraph) => Object.entries(g).flatMap(([id, node]) =>
  Object.entries(node.inputs).filter(([, v]) => isLink(v) && !g[v[0]]).map(([name]) => `${id}.${name}`));
const node = (g: ApiGraph, title: string) => g[nodeByTitle(g, title)];
const titles = (g: ApiGraph) => Object.values(g).map((n) => n._meta?.title ?? "");

test("the export has the picture, the grey motion reference and the video", () => {
  const ref = node(graph, "Reference Conditioning").inputs;
  assert.ok(ref["ref_images.ref_image_0"] && ref["ref_videos.ref_video_0"]);
  assert.equal(node(graph, OBJECT_VIDEO).class_type, "VHS_LoadVideo");
  assert.equal(node(graph, OBJECT_PICTURE).class_type, "LoadImage");
});

test("change with a picture keeps the graph and sets the plan", () => {
  const pruned = pruneObject(graph, true, settings("change"));
  assert.equal(Object.keys(pruned).length, Object.keys(graph).length);
  const plan = node(pruned, "Object Swap Plan (what to change)").inputs;
  assert.deepEqual([plan.mode, plan.target, plan.change_to, plan.resolution, plan.seed, plan.clip_seconds], ["change", "hair", "pink hair", "480p", 5, 4]);
  assert.equal(node(pruned, "SAM: what to change").inputs.text, "hair");
  assert.equal(node(pruned, "Grow mask").inputs.expand, 40);
  assert.equal(node(pruned, "Tracked area").inputs.max_people, 1);
  assert.ok(node(graph, OBJECT_PICTURE), "the source graph is not modified");
  const custom = pruneObject(graph, true, { ...settings("change"), resolution: { width: 640, height: 960 } });
  assert.deepEqual([node(custom, "Object Swap Plan (what to change)").inputs.short_edge, custom.custom_size.inputs.image], [640, [nodeByTitle(custom, OBJECT_VIDEO), 0]]);
});

test("several things are tracked together, one of each when only the biggest is kept", () => {
  const pruned = pruneObject(graph, true, { ...settings("change"), target: "hair, top" });
  assert.equal(node(pruned, "SAM: what to change").inputs.text, "hair, top");
  assert.equal(node(pruned, "Tracked area").inputs.max_people, 2);
  assert.ok(String(node(pruned, "Describe picture 1").inputs.prompt).startsWith("Describe the hair and the top in this picture in about 70 words, one sentence for each:"));
});

test("without a picture the picture branch goes", () => {
  const pruned = pruneObject(graph, false, settings("change"));
  assert.deepEqual(dangling(pruned), []);
  assert.ok(!titles(pruned).includes(OBJECT_PICTURE));
});

test("change drops the grey motion reference unless the outline is kept", () => {
  const ref = node(pruneObject(graph, true, settings("change")), "Reference Conditioning").inputs;
  assert.deepEqual(Object.keys(ref).filter((name) => name.startsWith("ref_")), ["ref_image_size", "ref_images.ref_image_0"]);
  const kept = pruneObject(graph, true, { ...settings("change"), keepOutline: true });
  assert.ok(node(kept, "Reference Conditioning").inputs["ref_videos.ref_video_0"]);
  assert.equal(node(kept, "Object Swap Plan (what to change)").inputs.keep_outline, true);
});

test("remove drops the picture and the grey motion reference", () => {
  const pruned = pruneObject(graph, true, settings("remove"));
  assert.deepEqual(dangling(pruned), []);
  const ref = node(pruned, "Reference Conditioning").inputs;
  assert.deepEqual(Object.keys(ref).filter((name) => name.startsWith("ref_")), ["ref_image_size"]);
});

test("background flips the mask and greys all of it", () => {
  const pruned = pruneObject(graph, false, settings("background"));
  const grow = nodeByTitle(pruned, "Grow mask");
  assert.equal(pruned[grow].inputs.flip_input, true);
  const grey = node(pruned, "Turn it grey (shape and movement only)").inputs;
  assert.deepEqual([grey.mask, grey.size], [[grow, 0], [grow, 0]]);
  assert.ok(node(pruned, "Reference Conditioning").inputs["ref_videos.ref_video_0"]);
});

test("the model settings reach the Object Swap Plan", () => {
  const pruned = pruneObject(graph, false, settings("change"));
  applyModel(pruned, { ...DEFAULT_MODEL, steps: 9 });
  assert.equal(node(pruned, "Object Swap Plan (what to change)").inputs.steps, 9);
  assert.deepEqual(dangling(pruned), []);
});
