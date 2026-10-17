import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { clipCount, clipStarts } from "../lib/clips.ts";
import { nodeDescriber } from "../lib/progress.ts";
import { MASK_NODES, NODES, pruneMask, pruneSimple, type ApiGraph, type SimpleSettings } from "../lib/simple.ts";

const load = (name: string): ApiGraph => JSON.parse(readFileSync(new URL(`../workflows/${name}.api.json`, import.meta.url), "utf8"));
const graph = load("simple");
const mask = load("mask");
const HAT_TYPES = ["CLIPTextEncode", "SAM3_VideoTrack", "SAM3_TrackToMask", "GrowMaskWithBlur", "MaskComposite", "MaskComposite"];
const settings = (hatFix: boolean): SimpleSettings => ({ role: " the  singer ", resolution: "480p", hatFix, margin: "loose", seed: 7, clipSeconds: 6 });

test("the node ids match the export", () => {
  const types = { picture: "LoadImage", video: "VHS_LoadVideo", plan: "H3OneClickSwapPlan", loopStart: "MiniMaxH3ChainLoopStart", peopleMask: "H3PeopleMask",
    growMask: "GrowMaskWithBlur", loopEnd: "MiniMaxH3ChainLoopEnd", final: "MiniMaxH3ChainAssemble" } as const;
  for (const [key, type] of Object.entries(types)) assert.equal(graph[NODES[key as keyof typeof types]].class_type, type, key);
  assert.deepEqual(NODES.hat.map((id) => graph[id].class_type), HAT_TYPES);
  assert.deepEqual(MASK_NODES.hat.map((id) => mask[id].class_type).sort(), [...HAT_TYPES].sort());
  assert.equal(mask[MASK_NODES.video].class_type, "VHS_LoadVideo");
});

test("without hat fix the hat nodes go and the grow mask reads the people mask", () => {
  const pruned = pruneSimple(graph, settings(false));
  for (const id of NODES.hat) assert.equal(pruned[id], undefined);
  assert.deepEqual(pruned[NODES.growMask].inputs.mask, [NODES.peopleMask, 0]);
  const plan = pruned[NODES.plan].inputs;
  assert.deepEqual([plan.resolution, plan.seed, plan.clip_seconds, plan.roles], ["480p", 7, 6, "the singer"]);
  assert.equal(pruned[NODES.growMask].inputs.expand, 60);
  assert.ok(graph[NODES.hat[0]], "the source graph is not modified");
});

test("with hat fix the full graph is kept", () => {
  const pruned = pruneSimple(graph, settings(true));
  assert.equal(Object.keys(pruned).length, Object.keys(graph).length);
  assert.deepEqual(pruned[NODES.growMask].inputs.mask, [NODES.hat[5], 0]);
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

test("clip count follows the Swap Plan grid", () => {
  assert.equal(clipCount(6, 6), 1);
  assert.equal(clipCount(16, 6), 4);
  assert.equal(clipCount(30, 6), 7);
  assert.equal(clipCount(10, 15), 1);
});

test("the mask check drops the hat nodes without hat fix", () => {
  const pruned = pruneMask(mask, false, "tight");
  assert.equal(pruned[MASK_NODES.growMask].inputs.expand, 20);
  for (const id of MASK_NODES.hat) assert.equal(pruned[id], undefined);
  assert.deepEqual(pruned[MASK_NODES.growMask].inputs.mask, [MASK_NODES.peopleMask, 0]);
  assert.equal(Object.keys(pruneMask(mask, true, "normal")).length, Object.keys(mask).length);
});

test("clip starts follow the Swap Plan's 39-frame overlap", () => {
  assert.deepEqual(clipStarts(339 / 24, 6), [0, 102, 204]);
});
