import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { VIDEO, nodeByTitle, pictureCount, pruneAdvanced, type AdvancedSettings } from "../lib/advanced.ts";
import { nodeDescriber } from "../lib/progress.ts";
import { isLink, type ApiGraph } from "../lib/simple.ts";

const load = (name: string): ApiGraph => JSON.parse(readFileSync(new URL(`../workflows/${name}.api.json`, import.meta.url), "utf8"));
const graph = load("advanced");
const maxq = load("advanced_maxq");
const settings = (hatFix: boolean, roles: string[] = []): AdvancedSettings => ({ roles, resolution: "480p", hatFix, margin: "tight", seed: 3, clipSeconds: 6 });
const titles = (g: ApiGraph) => Object.values(g).map((node) => node._meta?.title ?? "");
const dangling = (g: ApiGraph) => Object.entries(g).flatMap(([id, node]) =>
  Object.entries(node.inputs).filter(([, v]) => isLink(v) && !g[v[0]]).map(([name]) => `${id}.${name}`));

test("the exports have every picture and the hat fix", () => {
  assert.equal(pictureCount(graph), 4);
  assert.equal(pictureCount(maxq), 2);
  for (const g of [graph, maxq]) {
    assert.equal(g[nodeByTitle(g, VIDEO)].class_type, "VHS_LoadVideo");
    assert.ok(titles(g).includes("SAM 3.1 track hats"));
  }
});

test("two characters drop pictures 3-4 everywhere", () => {
  const pruned = pruneAdvanced(graph, 2, settings(true));
  assert.deepEqual(dangling(pruned), []);
  assert.equal(pictureCount(pruned), 2);
  for (const t of ["Describe picture 3", "Describe picture 4"]) assert.ok(!titles(pruned).includes(t));
  const plan = pruned[nodeByTitle(pruned, "Swap Plan (roles, seed, size)")].inputs;
  assert.ok(isLink(plan.picture_2) && !("picture_3" in plan) && !("picture_4_text" in plan));
  const ref = Object.values(pruned).find((n) => n.class_type === "MiniMaxH3ReferenceToVideo")!.inputs;
  assert.deepEqual(Object.keys(ref).filter((k) => k.startsWith("ref_images.")), ["ref_images.ref_image_0", "ref_images.ref_image_1"]);
  assert.equal(Object.keys(pruned).length, Object.keys(graph).length - 6);
  assert.ok(graph[nodeByTitle(graph, "Picture 4")], "the source graph is not modified");
});

test("without hat fix the grow masks read the role masks", () => {
  for (const [g, n] of [[graph, 4], [maxq, 2]] as const) {
    const pruned = pruneAdvanced(g, n, settings(false));
    assert.deepEqual(dangling(pruned), []);
    assert.ok(!titles(pruned).some((t) => /\bhats?\b/i.test(t)));
    const grows = Object.values(pruned).filter((node) => / grow mask /.test(node._meta?.title ?? ""));
    assert.equal(grows.length, n === 4 ? 1 : 2);
    for (const grow of grows) {
      assert.equal(grow.inputs.expand, 20);
      assert.equal(pruned[(grow.inputs.mask as [string, number])[0]].class_type, "H3RoleMask");
    }
  }
});

test("roles fill in for blank ones only when some are given", () => {
  const plan = (roles: string[]) => {
    const pruned = pruneAdvanced(graph, 3, settings(false, roles));
    return pruned[nodeByTitle(pruned, "Swap Plan (roles, seed, size)")].inputs;
  };
  assert.equal(plan(["", "", ""]).roles, "");
  assert.equal(plan(["the  singer ", "", "the drummer - man in a cap"]).roles,
    "the singer\nthe person with the second most screen time\nthe drummer - man in a cap");
  const inputs = plan([]);
  assert.deepEqual([inputs.resolution, inputs.seed, inputs.clip_seconds], ["480p", 3, 6]);
});

test("picture counts outside the export are refused", () => {
  assert.throws(() => pruneAdvanced(graph, 0, settings(true)));
  assert.throws(() => pruneAdvanced(maxq, 3, settings(true)));
});

test("progress finds the clip loop in the advanced graph", () => {
  const describe = nodeDescriber(graph);
  const sampler = Object.keys(graph).find((id) => graph[id].class_type === "SamplerCustomAdvanced")!;
  assert.equal(describe(sampler)?.clip, 1);
  assert.equal(describe(`99.0.0.${sampler}`)?.clip, 2);
  assert.equal(describe(nodeByTitle(graph, "Describe picture 1"))?.clip, null);
});
