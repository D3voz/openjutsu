import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { clipCount } from "../lib/clips.ts";
import { nodeDescriber } from "../lib/progress.ts";
import { NODES, pruneSimple, rolesText, type ApiGraph, type SimpleSettings } from "../lib/simple.ts";

const graph: ApiGraph = JSON.parse(readFileSync(new URL("../workflows/simple.api.json", import.meta.url), "utf8"));
const settings = (roles: string[], hatFix = false): SimpleSettings => ({ roles, resolution: "480p", hatFix, seed: 7, clipSeconds: 6 });

test("one picture without hat fix drops pictures 2-4 and the hat nodes", () => {
  const pruned = pruneSimple(graph, settings(["the singer"]));
  for (const id of ["5", "6", "7", "8", "9", "10", "11", "12", "13", ...NODES.hat]) assert.equal(pruned[id], undefined);
  const plan = pruned[NODES.plan].inputs;
  assert.deepEqual(Object.keys(plan).filter((k) => k.startsWith("picture_")), ["picture_1", "picture_1_text"]);
  assert.deepEqual(Object.keys(pruned[NODES.reference].inputs).filter((k) => k.startsWith("ref_images.")), ["ref_images.ref_image_0"]);
  assert.deepEqual(pruned[NODES.growMask].inputs.mask, [NODES.peopleMask, 0]);
  assert.equal(plan.resolution, "480p");
  assert.equal(plan.seed, 7);
  assert.equal(plan.roles, "the singer");
  assert.ok(graph["13"], "the source graph is not modified");
});

test("four pictures with hat fix keep the full graph", () => {
  const pruned = pruneSimple(graph, settings(["", "", "", ""], true));
  assert.equal(Object.keys(pruned).length, Object.keys(graph).length);
  assert.deepEqual(pruned[NODES.growMask].inputs.mask, ["56", 0]);
  assert.equal(pruned[NODES.plan].inputs.roles, "");
});

test("blank roles keep their line with the plan's own fallback", () => {
  assert.equal(rolesText(["", " the  drummer "]), "the person with the most screen time\nthe drummer");
  assert.equal(rolesText(["", ""]), "");
});

test("node ids map to titles and clip numbers", () => {
  const describe = nodeDescriber(graph);
  assert.deepEqual(describe("4"), { title: "Describe picture 1", classType: "TextGenerate", clip: null });
  assert.equal(describe("64")?.clip, 1);
  assert.equal(describe("70.0.0.64")?.clip, 2);
  assert.equal(describe("70.0.0.Recurse.0.0.64")?.clip, 3);
  assert.equal(describe("70.0.0.Recurse")?.title, "Loop End");
  assert.equal(describe("71")?.clip, null);
});

test("clip count follows the Swap Plan grid", () => {
  assert.equal(clipCount(6, 6), 1);
  assert.equal(clipCount(16, 6), 4);
});

test("clip count matches the Python plan on longer videos", () => {
  assert.equal(clipCount(30, 6), 7);
  assert.equal(clipCount(10, 15), 1);
});
