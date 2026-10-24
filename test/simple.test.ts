import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { clipCount, clipStarts } from "../lib/clips.ts";
import { nodeDescriber } from "../lib/progress.ts";
import { MASK_NODES, NODES, canvasSize, isLink, pruneMask, pruneSimple, setSection, type ApiGraph, type SimpleSettings } from "../lib/simple.ts";

const isLinkTo = (g: ApiGraph, value: unknown, type: string) => Array.isArray(value) && g[value[0] as string]?.class_type === type;
const load = (name: string): ApiGraph => JSON.parse(readFileSync(new URL(`../workflows/${name}.api.json`, import.meta.url), "utf8"));
const graph = load("simple");
const mask = load("mask");
const HAT_TYPES = ["CLIPTextEncode", "SAM3_VideoTrack", "SAM3_TrackToMask", "GrowMaskWithBlur", "MaskComposite", "MaskComposite"];
const settings = (hatFix: boolean, noLipSync = true): SimpleSettings => ({ role: " the  singer ", resolution: "480p", motion: 512, hatFix, noLipSync, margin: "loose", target: "cat", seed: 7, clipSeconds: 6 });
const byClass = (g: ApiGraph, type: string) => Object.values(g).filter((node) => node.class_type === type);

test("the node ids match the export", () => {
  const types = { picture: "LoadImage", video: "VHS_LoadVideo", plan: "H3OneClickSwapPlan", loopStart: "MiniMaxH3ChainLoopStart", peopleMask: "H3PeopleMask",
    growMask: "GrowMaskWithBlur", loopEnd: "MiniMaxH3ChainLoopEnd", final: "MiniMaxH3ChainAssemble" } as const;
  for (const [key, type] of Object.entries(types)) assert.equal(graph[NODES[key as keyof typeof types]].class_type, type, key);
  assert.deepEqual(NODES.hat.map((id) => graph[id].class_type), HAT_TYPES);
  assert.deepEqual(MASK_NODES.hat.map((id) => mask[id].class_type).sort(), [...HAT_TYPES].sort());
  assert.equal(mask[MASK_NODES.video].class_type, "VHS_LoadVideo");
  for (const [g, id] of [[graph, NODES.target], [mask, MASK_NODES.target]] as const) assert.deepEqual([g[id].class_type, g[id].inputs.text], ["CLIPTextEncode", "person"]);
});

test("without hat fix the hat nodes go and the grow mask reads the people mask", () => {
  const pruned = pruneSimple(graph, settings(false));
  for (const id of NODES.hat) assert.equal(pruned[id], undefined);
  assert.deepEqual(pruned[NODES.growMask].inputs.mask, [NODES.peopleMask, 0]);
  const plan = pruned[NODES.plan].inputs;
  assert.deepEqual([plan.resolution, plan.seed, plan.clip_seconds, plan.roles], ["480p", 7, 6, "the singer"]);
  assert.equal(pruned[NODES.growMask].inputs.expand, 60);
  assert.equal(pruned[NODES.target].inputs.text, "cat");
  assert.ok(graph[NODES.hat[0]], "the source graph is not modified");
});

test("a custom size crops the source frames to that canvas before anything reads them", () => {
  const frameReaders = (g: ApiGraph, id: string) => Object.values(g).flatMap((node) => Object.values(node.inputs)).filter((v) => isLink(v) && v[0] === id && v[1] === 0).length;
  const pruned = pruneSimple(graph, { ...settings(true), resolution: { width: 1248, height: 736 } });
  assert.deepEqual(pruned.custom_size.inputs, { image: [NODES.video, 0], upscale_method: "bilinear", width: 1248, height: 736, crop: "center" });
  assert.equal(frameReaders(pruned, NODES.video), 1);
  assert.equal(frameReaders(pruned, "custom_size"), frameReaders(graph, NODES.video));
  assert.deepEqual([pruned[NODES.plan].inputs.short_edge, pruned[NODES.video].inputs.audio], [736, graph[NODES.video].inputs.audio]);
  assert.equal(pruneSimple(graph, settings(true)).custom_size, undefined);
  assert.deepEqual(canvasSize(640, 360, "736p"), [1312, 736]);
  assert.deepEqual(canvasSize(1080, 1920, "480p"), [480, 864]);
});

test("a part of the video becomes VHS's skip and frame cap; the whole video keeps 0", () => {
  const pruned = pruneSimple(graph, settings(false));
  setSection(pruned, NODES.video, { start: 3.5, length: 4 });
  assert.deepEqual([pruned[NODES.video].inputs.skip_first_frames, pruned[NODES.video].inputs.frame_load_cap], [84, 96]);
  setSection(pruned, NODES.video, { start: 0, length: 0 });
  assert.deepEqual([pruned[NODES.video].inputs.skip_first_frames, pruned[NODES.video].inputs.frame_load_cap], [0, 0]);
});

test("a bigger motion reference gets its own run name, 512 keeps the plan's", () => {
  const pruned = pruneSimple(graph, { ...settings(false), motion: 768 });
  assert.deepEqual(byClass(pruned, "ImageScaleToMaxDimension").filter((n) => /motion reference/i.test(n._meta?.title ?? "")).map((n) => n.inputs.largest_size), [768]);
  const production = byClass(pruned, "MiniMaxH3ChainPlanModern")[0].inputs.run_name as [string, number];
  assert.deepEqual(pruned[production[0]].inputs, { string_a: [NODES.plan, 3], string_b: "_motion768", delimiter: "" });
  const plain = pruneSimple(graph, settings(false));
  assert.deepEqual(byClass(plain, "MiniMaxH3ChainPlanModern")[0].inputs.run_name, [NODES.plan, 3]);
});

test("with hat fix the full graph is kept", () => {
  const pruned = pruneSimple(graph, settings(true));
  assert.equal(Object.keys(pruned).length, Object.keys(graph).length);
  assert.deepEqual(pruned[NODES.growMask].inputs.mask, [NODES.hat[5], 0]);
});

test("without No lip-sync H3 hears the soundtrack and the mannequin gets no faces", () => {
  const pruned = pruneSimple(graph, settings(true, false));
  assert.equal(Object.keys(pruned).length, Object.keys(graph).length - 6);
  assert.deepEqual(byClass(pruned, "AudioAdjustVolume"), []);
  assert.ok(!Object.values(pruned).some((node) => /faces/.test(node._meta?.title ?? "")));
  const [ref] = byClass(pruned, "MiniMaxH3ReferenceToVideo");
  const [src] = byClass(pruned, "MiniMaxH3ContexLoopSourceSlice");
  const [mannequin] = byClass(pruned, "H3GreyMannequins");
  assert.equal(pruned[(ref.inputs["ref_video_audios.ref_video_audio_0"] as [string, number])[0]].class_type, "MiniMaxH3ChainCurrent");
  assert.equal(pruned[(src.inputs.source_audio as [string, number])[0]].class_type, "TrimAudioDuration");
  assert.ok(!("faces" in mannequin.inputs) && !("face_size" in mannequin.inputs));
  assert.ok(!("no_lip_sync" in pruned[NODES.plan].inputs));
});

test("with No lip-sync H3 hears silence and the plan drops the lip-sync line", () => {
  const pruned = pruneSimple(graph, settings(false, true));
  const [ref] = byClass(pruned, "MiniMaxH3ReferenceToVideo");
  const [src] = byClass(pruned, "MiniMaxH3ContexLoopSourceSlice");
  for (const link of [ref.inputs["ref_video_audios.ref_video_audio_0"], src.inputs.source_audio]) {
    assert.deepEqual(pruned[(link as [string, number])[0]].inputs.volume, -100);
  }
  const flag = pruned[(pruned[NODES.plan].inputs.no_lip_sync as [string, number])[0]];
  assert.deepEqual([flag.class_type, flag.inputs.value], ["PrimitiveBoolean", true]);
  assert.ok(isLinkTo(pruned, byClass(pruned, "H3GreyMannequins")[0].inputs.faces, "H3PeopleMask"));
});

test("node ids map to titles and clip numbers", () => {
  const describe = nodeDescriber(graph);
  assert.deepEqual(describe("4"), { title: "Describe picture 1", classType: "TextGenerate", clip: null });
  assert.equal(describe("60")?.clip, 1);
  assert.equal(describe("66.0.0.60")?.clip, 2);
  assert.equal(describe("66.0.0.Recurse.0.0.60")?.clip, 3);
  assert.equal(describe("66.0.0.Recurse")?.title, "Loop End");
  assert.equal(describe(NODES.final)?.clip, null);
});

test("unknown duration and invalid clip lengths do not enter the planning loop", () => {
  for (const duration of [Infinity, NaN, -1, 0]) {
    assert.equal(clipCount(duration, 6), 0);
    assert.deepEqual(clipStarts(duration, 6), [0]);
  }
  for (const length of [Infinity, NaN, 0, 39 / 24]) assert.equal(clipCount(12, length), 0);
});

test("clip count follows the Swap Plan grid", () => {
  assert.equal(clipCount(6, 6), 1);
  assert.equal(clipCount(16, 6), 4);
  assert.equal(clipCount(30, 6), 7);
  assert.equal(clipCount(10, 15), 1);
});

test("the mask check drops the hat nodes without hat fix", () => {
  const pruned = pruneMask(mask, false, "tight", "dog");
  assert.equal(pruned[MASK_NODES.growMask].inputs.expand, 20);
  assert.equal(pruned[MASK_NODES.target].inputs.text, "dog");
  for (const id of MASK_NODES.hat) assert.equal(pruned[id], undefined);
  assert.deepEqual(pruned[MASK_NODES.growMask].inputs.mask, [MASK_NODES.peopleMask, 0]);
  assert.equal(Object.keys(pruneMask(mask, true, "normal", "person")).length, Object.keys(mask).length);
});

test("clip starts follow the Swap Plan's 39-frame overlap", () => {
  assert.deepEqual(clipStarts(339 / 24, 6), [0, 102, 204]);
});
