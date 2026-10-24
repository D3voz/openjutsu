import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { nodeByTitle } from "../lib/advanced.ts";
import { applyModel, DEFAULT_MODEL } from "../lib/model.ts";
import { OBJECT_PICTURE, OBJECT_VIDEO, parsePlacement, placementAt, pruneObject, type ObjectSettings } from "../lib/object.ts";
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

test("adding an object uses placement keyframes, without SAM, grey shapes or the original video as a reference", () => {
  const placement = [{ frame: 0, x: 0.3, y: 0.4, width: 0.2, height: 0.25 }];
  for (const picture of [false, true]) {
    const pruned = pruneObject(graph, picture, { ...settings("add"), target: "on the table", changeTo: "a cake", placement, action: "Steam rises from it." });
    assert.deepEqual(dangling(pruned), []);
    assert.ok(!Object.values(pruned).some((n) => ["SAM3_VideoTrack", "H3PeopleMask", "H3GreyMannequins", "CheckpointLoaderSimple"].includes(n.class_type)));
    const ref = node(pruned, "Reference Conditioning").inputs;
    assert.equal(ref["ref_videos.ref_video_0"], undefined);
    assert.equal(ref["ref_video_audios.ref_video_audio_0"], undefined);
    assert.equal(!!ref["ref_images.ref_image_0"], picture);
    const plan = node(pruned, "Object Swap Plan (what to change)").inputs;
    assert.equal(plan.mode, "add");
    assert.equal(plan.keep_outline, false);
    assert.equal(plan.action, "Steam rises from it.");
    assert.equal(plan.placement, JSON.stringify(placement));
    assert.equal(pruned.object_placement.class_type, "H3ObjectPlacementMask");
    assert.equal(pruned.object_placement.inputs.placement, plan.placement);
    assert.deepEqual(pruned.object_placement.inputs.images, [nodeByTitle(pruned, "Source clip (frames + audio)"), 0]);
    assert.deepEqual(pruned.object_placement.inputs.start_frame, [nodeByTitle(pruned, "Clip start frame"), 1]);
    assert.deepEqual(node(pruned, "Grow mask").inputs.mask, ["object_placement", 0]);
  }
});

test("adding drops a leading verb, so the plan and the picture describer name the object", () => {
  const placement = [{ frame: 0, x: 0.3456, y: 0.7576, width: 0.2395, height: 0.0863 }];
  for (const [changeTo, object] of [["add a toy car", "a toy car"], ["Insert a vase", "a vase"], ["a chocolate cake on a plate", "a chocolate cake on a plate"]]) {
    const pruned = pruneObject(graph, true, { ...settings("add"), target: "on the table", changeTo, placement });
    assert.equal(node(pruned, "Object Swap Plan (what to change)").inputs.change_to, object);
    assert.ok(String(node(pruned, "Describe picture 1").inputs.prompt).startsWith(`Describe the ${object.replace(/^a /, "")} in this picture`));
  }
  assert.equal(node(pruneObject(graph, false, { ...settings("change"), changeTo: "add a toy car" }), "Object Swap Plan (what to change)").inputs.change_to, "add a toy car");
});

test("add placements use the selected canvas and the model settings still reach generation", () => {
  const pruned = pruneObject(graph, false, { ...settings("add"), placement: [{ frame: -24, x: 0.2, y: 0.4, width: 0.3, height: 0.2 }], resolution: { width: 640, height: 960 } });
  applyModel(pruned, { ...DEFAULT_MODEL, steps: 8 });
  assert.deepEqual(dangling(pruned), []);
  assert.equal(node(pruned, "Object Swap Plan (what to change)").inputs.steps, 8);
  assert.deepEqual(node(pruned, "Source clip (frames + audio)").inputs.source_frames, ["custom_size", 0]);
  assert.deepEqual(node(pruned, "Motion reference video (~512 px)").inputs.image, ["custom_size", 0]);
});

test("placement validation rejects missing or invalid geometry and sorts valid keyframes", () => {
  for (const placement of [null, [], "{", [{ frame: 0, x: -0.1, y: 0.2, width: 0.2, height: 0.2 }],
    [{ frame: 0, x: 0.9, y: 0.2, width: 0.2, height: 0.2 }], [{ frame: 0, x: 0.2, y: 0.2, width: 0, height: 0.2 }]]) {
    assert.throws(() => parsePlacement(placement));
  }
  const points = [{ frame: 48, x: 0.6, y: 0.2, width: 0.2, height: 0.2 }, { frame: 0, x: 0.2, y: 0.4, width: 0.2, height: 0.2 }];
  const sorted = parsePlacement(JSON.stringify(points));
  assert.deepEqual(sorted.map((p) => p.frame), [0, 48]);
  assert.deepEqual(placementAt(sorted, -24), { x: 0.2, y: 0.4, width: 0.2, height: 0.2 });
  const middle = placementAt(sorted, 24)!;
  assert.ok(Math.abs(middle.x - 0.4) < 1e-6 && Math.abs(middle.y - 0.3) < 1e-6);
  assert.deepEqual(placementAt(sorted, 96), { x: 0.6, y: 0.2, width: 0.2, height: 0.2 });
});
