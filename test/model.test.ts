import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { nodeByTitle } from "../lib/advanced.ts";
import { DEFAULT_MODEL, applyModel } from "../lib/model.ts";
import { isLink, type ApiGraph } from "../lib/simple.ts";

const load = (name: string): ApiGraph => JSON.parse(readFileSync(new URL(`../workflows/${name}.api.json`, import.meta.url), "utf8"));
const exports = ["simple", "advanced", "advanced_maxq"];
const plan = (g: ApiGraph) => Object.values(g).find((node) => /^H3(OneClick|Advanced)SwapPlan$/.test(node.class_type))!;
const loras = (g: ApiGraph) => Object.entries(g).filter(([, node]) => node.class_type === "LoraLoaderModelOnly");
const dangling = (g: ApiGraph) => Object.entries(g).flatMap(([id, node]) =>
  Object.entries(node.inputs).filter(([, v]) => isLink(v) && !g[v[0]]).map(([name]) => `${id}.${name}`));
// Whatever read the export's LoRA node (the model input of the sampling chain).
const consumers = (g: ApiGraph, id: string) => Object.entries(g).flatMap(([cid, node]) =>
  Object.entries(node.inputs).filter(([, v]) => isLink(v) && v[0] === id).map(([name]) => [cid, name] as const));

test("the default settings match the exports", () => {
  for (const name of exports) {
    const g = load(name);
    const lora = g[nodeByTitle(g, "DMAD LoRA")].inputs;
    assert.equal(g[nodeByTitle(g, "H3 Diffusion Model")].inputs.unet_name, DEFAULT_MODEL.model, name);
    assert.deepEqual([lora.lora_name, lora.strength_model], [DEFAULT_MODEL.loras[0].name, DEFAULT_MODEL.loras[0].strength], name);
    assert.equal(plan(g).inputs.steps, DEFAULT_MODEL.steps, name);
  }
});

test("two LoRAs chain from the base model into the sampler", () => {
  for (const name of exports) {
    const g = load(name);
    const unet = nodeByTitle(g, "H3 Diffusion Model");
    const old = nodeByTitle(g, "DMAD LoRA");
    const readers = consumers(g, old);
    applyModel(g, { model: "other.safetensors", loras: [{ name: "a.safetensors", strength: 0.5 }, { name: "b.safetensors", strength: -1 }], steps: 20 });
    assert.deepEqual(dangling(g), [], name);
    assert.equal(g[unet].inputs.unet_name, "other.safetensors");
    assert.equal(plan(g).inputs.steps, 20);
    const chain = loras(g);
    assert.deepEqual(chain.map(([id, n]) => [id, n._meta?.title, n.inputs.lora_name, n.inputs.strength_model]),
      [[old, "LoRA 1", "a.safetensors", 0.5], [`${old}_lora2`, "LoRA 2", "b.safetensors", -1]]);
    assert.deepEqual(g[old].inputs.model, [unet, 0]);
    assert.deepEqual(g[`${old}_lora2`].inputs.model, [old, 0]);
    for (const [id, input] of readers) assert.deepEqual(g[id].inputs[input], [`${old}_lora2`, 0], name);
  }
});

test("no LoRAs feed the base model straight to the sampler", () => {
  for (const name of exports) {
    const g = load(name);
    const unet = nodeByTitle(g, "H3 Diffusion Model");
    const readers = consumers(g, nodeByTitle(g, "DMAD LoRA"));
    applyModel(g, { ...DEFAULT_MODEL, loras: [], steps: 24 });
    assert.deepEqual(dangling(g), [], name);
    assert.deepEqual(loras(g), []);
    assert.equal(plan(g).inputs.steps, 24);
    for (const [id, input] of readers) assert.deepEqual(g[id].inputs[input], [unet, 0], name);
  }
});
