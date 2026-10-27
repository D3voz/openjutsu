import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { nodeByTitle } from "../lib/advanced.ts";
import { DEFAULT_DESCRIBER, DEFAULT_MODEL, applyModel, hasSpeedLora, migrateFleetSettings } from "../lib/model.ts";
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

test("KAFEIN fleet defaults use the weights in S3, including the 8-step turbo LoRA", () => {
  assert.equal(DEFAULT_MODEL.model, "minimax_h3_ref2va_pruned_int8_convrot.safetensors");
  assert.equal(DEFAULT_MODEL.loras[0].name, "minimax_h3_ref2v_turbo_8step_v1.0_768p_comfyui_bf16.safetensors");
  assert.equal(DEFAULT_MODEL.steps, 8);
  assert.equal(DEFAULT_MODEL.textEncoder, "qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors");
  assert.equal(DEFAULT_DESCRIBER, "qwen3vl_8b_fp8_scaled.safetensors");
});

test("saved upstream settings migrate to the fleet profile without losing custom strengths", () => {
  const old = {
    ...DEFAULT_MODEL,
    loras: [{ name: "minimax_h3_DMAD_4step_full_lora_avg_rank_39_bf16.safetensors", strength: 0.7 }],
    steps: 6,
    describer: "qwen3vl_8b_int8_convrot.safetensors",
    textEncoder: "qwen3vl_32b_minimax_h3_int4_convrot.safetensors",
  };
  const migrated = migrateFleetSettings(old);
  assert.equal(migrated.loras[0].name, DEFAULT_MODEL.loras[0].name);
  assert.equal(migrated.loras[0].strength, 0.7);
  assert.equal(migrated.steps, 8);
  assert.equal(migrated.describer, DEFAULT_DESCRIBER);
  assert.equal(migrated.textEncoder, DEFAULT_MODEL.textEncoder);
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

const generationWorkflows = ["simple", "advanced", "advanced_maxq", "object", "face", "montage"];

test("H3 encoder and both VAE choices reach all generation workflows without changing the describer", () => {
  for (const name of generationWorkflows) {
    const graph = load(name);
    const describer = structuredClone(graph[nodeByTitle(graph, "Describer: Qwen3-VL 8B")]);
    applyModel(graph, { ...DEFAULT_MODEL, textEncoder: "qwen32b_int8.safetensors", videoVae: "video_bf16.safetensors", audioVae: "audio_bf16.safetensors" });
    assert.equal(graph[nodeByTitle(graph, "H3 Text Encoder")].inputs.clip_name, "qwen32b_int8.safetensors", name);
    assert.equal(graph[nodeByTitle(graph, "H3 Text Encoder")].inputs.type, "minimax", name);
    assert.equal(graph[nodeByTitle(graph, "Video VAE")].inputs.vae_name, "video_bf16.safetensors", name);
    assert.equal(graph[nodeByTitle(graph, "Audio VAE")].inputs.vae_name, "audio_bf16.safetensors", name);
    assert.deepEqual(graph[nodeByTitle(graph, "Describer: Qwen3-VL 8B")], describer, name);
    assert.deepEqual(dangling(graph), [], name);
  }
});

test("Spectrum is placed after the model patches and feeds every guider, including both Advanced passes", () => {
  for (const name of generationWorkflows) {
    const graph = load(name);
    const guiders = Object.values(graph).filter((node) => node.class_type === "BasicGuider");
    const upstream = guiders.map((node) => node.inputs.model);
    applyModel(graph, { ...DEFAULT_MODEL, loras: [], steps: 20, acceleration: "spectrum" });
    const spectrum = Object.entries(graph).filter(([, node]) => node.class_type === "SpectrumApplyMiniMaxH3");
    assert.equal(spectrum.length, 1, name);
    assert.deepEqual(spectrum[0][1].inputs.model, upstream[0], name);
    for (const guider of guiders) assert.deepEqual(guider.inputs.model, [spectrum[0][0], 0], name);
    assert.deepEqual(dangling(graph), [], name);
    assert.equal(loras(graph).length, 0, name);
  }
});

test("Spectrum stays absent by default and rejects speed LoRAs before changing the graph", () => {
  const graph = load("simple");
  applyModel(graph, DEFAULT_MODEL);
  assert.ok(Object.values(graph).every((node) => node.class_type !== "SpectrumApplyMiniMaxH3"));
  for (const lora of [DEFAULT_MODEL.loras[0], { name: "renamed.safetensors", strength: 1, speed: true }]) {
    const graph = load("simple");
    const before = structuredClone(graph);
    assert.throws(() => applyModel(graph, { ...DEFAULT_MODEL, loras: [lora], acceleration: "spectrum" }), /speed LoRA/);
    assert.deepEqual(graph, before);
  }
  assert.equal(hasSpeedLora([{ ...DEFAULT_MODEL.loras[0], strength: 0 }]), false);
  assert.equal(hasSpeedLora([{ name: "style.safetensors", strength: 1 }]), false);
  for (const name of ["h3_LightX2V.safetensors", "h3_turbo.safetensors", "h3_4step.safetensors", "packs\\4step.safetensors"]) {
    assert.equal(hasSpeedLora([{ name, strength: 1 }]), true, name);
  }
});

test("component changes get distinct saved runs, while defaults and speed labels preserve the same run", () => {
  const run = (settings: Parameters<typeof applyModel>[1]) => {
    const graph = load("simple");
    applyModel(graph, settings);
    return graph.model_run_name?.inputs.string_b;
  };
  assert.equal(run(DEFAULT_MODEL), undefined);
  assert.equal(run({ ...DEFAULT_MODEL, loras: DEFAULT_MODEL.loras.map((lora) => ({ ...lora, speed: true })) }), undefined);
  const variants = [
    { ...DEFAULT_MODEL, loras: [] },
    { ...DEFAULT_MODEL, textEncoder: "other.safetensors" },
    { ...DEFAULT_MODEL, videoVae: "other.safetensors" },
    { ...DEFAULT_MODEL, audioVae: "other.safetensors" },
    { ...DEFAULT_MODEL, loras: [], acceleration: "spectrum" as const },
  ];
  const names = variants.map(run);
  assert.ok(names.every((name) => typeof name === "string" && /^_model[0-9a-f]+$/.test(name)));
  assert.equal(new Set(names).size, variants.length);
  assert.equal(run(variants[1]), run(variants[1]));
});

test("a disabled speed LoRA is bypassed while style LoRAs and Spectrum remain active", () => {
  const selected = [
    { ...DEFAULT_MODEL.loras[0], enabled: false },
    { name: "style.safetensors", strength: 0.8 },
  ];
  assert.equal(hasSpeedLora(selected), false);
  for (const name of generationWorkflows) {
    const graph = load(name);
    applyModel(graph, { ...DEFAULT_MODEL, loras: selected, steps: 20, acceleration: "spectrum" });
    assert.deepEqual(loras(graph).map(([, node]) => node.inputs.lora_name), ["style.safetensors"], name);
    assert.equal(Object.values(graph).filter((node) => node.class_type === "SpectrumApplyMiniMaxH3").length, 1, name);
    assert.deepEqual(dangling(graph), [], name);
  }
  const disabled = load("simple");
  const removed = load("simple");
  applyModel(disabled, { ...DEFAULT_MODEL, loras: [{ ...DEFAULT_MODEL.loras[0], enabled: false }], acceleration: "spectrum" });
  applyModel(removed, { ...DEFAULT_MODEL, loras: [], acceleration: "spectrum" });
  assert.deepEqual(disabled, removed, "disabling and removing the speed LoRA use the same workflow and saved-run identity");
});


test("changing the visual describer preserves H3 encoding and separates saved clips", () => {
  for (const name of ["simple", "advanced", "advanced_maxq", "object", "face", "montage"]) {
    const original = load(name);
    const graph = load(name);
    applyModel(original, DEFAULT_MODEL);
    applyModel(graph, { ...DEFAULT_MODEL, describer: "gemma4_e2b_it_int8_convrot.safetensors" });
    assert.equal(graph[nodeByTitle(graph, "Describer: Qwen3-VL 8B")].inputs.clip_name, "gemma4_e2b_it_int8_convrot.safetensors", name);
    assert.equal(graph[nodeByTitle(graph, "H3 Text Encoder")].inputs.clip_name, DEFAULT_MODEL.textEncoder, name);
    assert.deepEqual(dangling(graph), [], name);
    if (Object.values(graph).some((node) => node.class_type === "MiniMaxH3ChainPlanModern")) {
      assert.equal(original.model_run_name, undefined, name);
      assert.match(String(graph.model_run_name.inputs.string_b), /^_model[0-9a-f]+$/, name);
    }
  }
});
