import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { pruneAdvanced, type AdvancedSettings } from "../lib/advanced.ts";
import { isLink, type ApiGraph } from "../lib/simple.ts";

const load = (name: string): ApiGraph => JSON.parse(readFileSync(new URL(`../workflows/${name}.api.json`, import.meta.url), "utf8"));
const settings: AdvancedSettings = { roles: ["drummer", "singer"], resolution: "480p", motion: 512, hatFix: true, noLipSync: true, margin: "normal", seed: 0, clipSeconds: 6 };

function identity(graph: ApiGraph): string {
  const resolve = (value: unknown): string => {
    if (!isLink(value)) return String(value);
    const node = graph[value[0]];
    if (node.class_type !== "StringConcatenate") return "same-two-character-swap-plan";
    return resolve(node.inputs.string_a) + String(node.inputs.delimiter) + resolve(node.inputs.string_b);
  };
  return resolve(Object.values(graph).find((node) => node.class_type === "MiniMaxH3ChainPlanModern")!.inputs.run_name);
}

test("one-pass and per-person Advanced cannot resume each other's completed clips", () => {
  for (const motion of [512, 768] as const) {
    const plain = pruneAdvanced(load("advanced"), 2, { ...settings, motion });
    const separate = pruneAdvanced(load("advanced_maxq"), 2, { ...settings, motion });
    const plan = (graph: ApiGraph) => Object.fromEntries(Object.entries(Object.values(graph).find((node) => node.class_type === "H3AdvancedSwapPlan")!.inputs)
      .map(([key, value]) => [key, isLink(value) ? [graph[value[0]].class_type, graph[value[0]]._meta?.title, value[1]] : value]));
    assert.deepEqual(plan(plain), plan(separate), "native base identity receives identical plan inputs");
    assert.equal(Object.values(plain).filter((node) => node.class_type === "SamplerCustomAdvanced").length, 1);
    assert.equal(Object.values(separate).filter((node) => node.class_type === "SamplerCustomAdvanced").length, 2);
    assert.notEqual(identity(plain), identity(separate), "different generation strategies require distinct histories");
    assert.equal(identity(separate), identity(pruneAdvanced(load("advanced_maxq"), 2, { ...settings, motion })));
    for (const node of Object.values(separate)) for (const value of Object.values(node.inputs)) if (isLink(value)) assert.ok(separate[value[0]]);
  }
});
