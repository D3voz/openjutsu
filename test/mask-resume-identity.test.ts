import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { pruneSimple, isLink, type ApiGraph, type SimpleSettings } from "../lib/simple.ts";
import { pruneAdvanced, type AdvancedSettings } from "../lib/advanced.ts";
import { pruneObject, type ObjectSettings } from "../lib/object.ts";

const load = (mode: string): ApiGraph => JSON.parse(readFileSync(new URL(`../workflows/${mode}.api.json`, import.meta.url), "utf8"));
// Upstream Swap Plan hashes source/pictures/prompt/size/steps/seed, not these mask inputs.
// Resolve actual StringConcatenate graph edges over the same native base run name.
function runName(graph: ApiGraph): string {
  const resolve = (value: unknown): string => {
    if (!isLink(value)) return String(value);
    const node = graph[value[0]];
    if (node.class_type !== "StringConcatenate") return "same-native-run";
    return resolve(node.inputs.string_a) + String(node.inputs.delimiter) + resolve(node.inputs.string_b);
  };
  return resolve(Object.values(graph).find((node) => node.class_type === "MiniMaxH3ChainPlanModern")!.inputs.run_name);
}
const base: SimpleSettings = { role: "the drummer", resolution: "480p", motion: 512, hatFix: false, noLipSync: false, margin: "normal", target: "person", seed: 0, clipSeconds: 6 };

test("simple mask changes cannot resume clips made with another mask", () => {
  const variants = [base, { ...base, hatFix: true }, { ...base, margin: "loose" as const }, { ...base, target: "cat" }];
  const names = variants.map((settings) => runName(pruneSimple(load("simple"), settings)));
  assert.equal(new Set(names).size, variants.length);
  assert.equal(names[0], runName(pruneSimple(load("simple"), base)), "same settings remain resumable");
});

test("advanced mask settings separate saved runs in both generation strategies", () => {
  for (const mode of ["advanced", "advanced_maxq", "montage"]) {
    const settings: AdvancedSettings = { ...base, roles: ["drummer", "singer"] };
    const variants = [settings, { ...settings, hatFix: true }, { ...settings, margin: "tight" as const }];
    const names = variants.map((value) => runName(pruneAdvanced(load(mode), 2, value)));
    assert.equal(new Set(names).size, variants.length, mode);
  }
});

test("object mask grow and biggest-only changes separate saved runs", () => {
  const settings: ObjectSettings = { ...base, mode: "change", changeTo: "a coat", biggestOnly: false, keepOutline: true };
  for (const mode of ["change", "remove", "background"] as const) {
    const variants = [{ ...settings, mode }, { ...settings, mode, margin: "loose" as const }, { ...settings, mode, biggestOnly: true }];
    const names = variants.map((value) => runName(pruneObject(load("object"), false, value)));
    assert.equal(new Set(names).size, variants.length, mode);
  }
});
