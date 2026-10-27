// Base model, LoRAs and steps, shared by every swap and edit workflow. Each export has one "H3 Diffusion Model" UNETLoader
// feeding one "DMAD LoRA" LoraLoaderModelOnly; the LoRA list replaces that node with a chain (or removes it).
// KAFEIN fleet defaults use the weights actually present in S3. The LoRA node title stays "DMAD LoRA" because the
// workflow exports and applyModel() find it by title; its file is the fleet 8-step turbo LoRA.
import { nodeByTitle } from "./advanced.ts";
import { isLink, suffixRunName, type ApiGraph } from "./simple.ts";

export type Lora = { name: string; strength: number; speed?: boolean; enabled?: boolean };
export const ACCELERATIONS = ["none", "spectrum"] as const;
export type Acceleration = (typeof ACCELERATIONS)[number];
export type ModelSettings = {
  model: string; loras: Lora[]; steps: number;
  describer?: string; textEncoder?: string; videoVae?: string; audioVae?: string; acceleration?: Acceleration;
};
export type ModelFiles = { models: string[]; loras: string[]; textEncoders: string[]; vaes: string[] };

export const DEFAULT_DESCRIBER = "qwen3vl_8b_fp8_scaled.safetensors";

export const DEFAULT_MODEL = {
  model: "minimax_h3_ref2va_pruned_int8_convrot.safetensors",
  loras: [{ name: "minimax_h3_ref2v_turbo_8step_v1.0_768p_comfyui_bf16.safetensors", strength: 1 }],
  steps: 8,
  textEncoder: "qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors",
  videoVae: "minimax_h3_video_vae_int8_convrot.safetensors",
  audioVae: "minimax_h3_audio_vae_fp32.safetensors",
  acceleration: "none",
} satisfies ModelSettings;

// Old Openjutsu browser settings that refer to weights the fleet does not have.
const FLEET_RENAMES: Record<string, string> = {
  "qwen3vl_8b_int8_convrot.safetensors": DEFAULT_DESCRIBER,
  "qwen3vl_32b_minimax_h3_int4_convrot.safetensors": DEFAULT_MODEL.textEncoder,
  "minimax_h3_DMAD_4step_full_lora_avg_rank_39_bf16.safetensors": DEFAULT_MODEL.loras[0].name,
};

// Reads saved browser settings without breaking on the upstream model names.
export function migrateFleetSettings<T extends ModelSettings>(settings: T): T {
  const rename = (name?: string) => (name && FLEET_RENAMES[name]) || name;
  const hadDmad = settings.loras.some((lora) => lora.name.includes("DMAD"));
  return {
    ...settings,
    model: rename(settings.model) ?? settings.model,
    loras: settings.loras.map((lora) => ({ ...lora, name: rename(lora.name) ?? lora.name })),
    describer: rename(settings.describer) ?? settings.describer,
    textEncoder: rename(settings.textEncoder) ?? settings.textEncoder,
    steps: hadDmad && settings.steps === 6 ? DEFAULT_MODEL.steps : settings.steps,
  } as T;
}
export const MAX_LORAS = 4;
export const STEPS = { min: 1, max: 100 };
export const STRENGTH = { min: -4, max: 4 };

export function isSpeedLora(lora: Lora) {
  return lora.speed === true || /dmad|light[ _-]?x2v|turbo|(?:^|[\/ _-])(?:[12468][ _-]?steps?|lightning)(?:[_. -]|$)/i.test(lora.name.replaceAll("\\", "/"));
}

export function hasSpeedLora(loras: Lora[]) {
  return loras.some((lora) => lora.enabled !== false && lora.strength !== 0 && isSpeedLora(lora));
}

export function checkAcceleration(settings: ModelSettings) {
  if (!ACCELERATIONS.includes(settings.acceleration ?? "none")) throw new Error("Choose a supported acceleration option.");
  if (settings.acceleration === "spectrum" && hasSpeedLora(settings.loras)) throw new Error("Turn off Spectrum or remove the speed LoRA.");
}

export function applyDescriber(graph: ApiGraph, name = DEFAULT_DESCRIBER) {
  graph[nodeByTitle(graph, "Describer: Qwen3-VL 8B")].inputs.clip_name = name;
}

// Mutates graph: the steps, model components and LoRA chain.
export function applyModel(graph: ApiGraph, settings: ModelSettings) {
  checkAcceleration(settings);
  applyDescriber(graph, settings.describer);
  for (const [title, input, value] of [
    ["H3 Text Encoder", "clip_name", settings.textEncoder ?? DEFAULT_MODEL.textEncoder],
    ["Video VAE", "vae_name", settings.videoVae ?? DEFAULT_MODEL.videoVae],
    ["Audio VAE", "vae_name", settings.audioVae ?? DEFAULT_MODEL.audioVae],
  ]) graph[nodeByTitle(graph, title)].inputs[input] = value;
  const plans = Object.values(graph).filter((node) => ["H3OneClickSwapPlan", "H3AdvancedSwapPlan", "H3MontagePlan", "H3ObjectSwapPlan"].includes(node.class_type));
  if (plans.length > 1) throw new Error(`Expected one Swap Plan node in the workflow, found ${plans.length}.`);
  (plans[0] ?? graph[nodeByTitle(graph, "Schedule")]).inputs.steps = settings.steps;
  const unet = nodeByTitle(graph, "H3 Diffusion Model");
  const lora = nodeByTitle(graph, "DMAD LoRA");
  graph[unet].inputs.unet_name = settings.model;

  const template = graph[lora];
  delete graph[lora];
  let last: [string, number] = [unet, 0];
  settings.loras.filter((lora) => lora.enabled !== false).forEach((l, i) => {
    const id = i === 0 ? lora : `${lora}_lora${i + 1}`;
    graph[id] = { ...template, inputs: { ...template.inputs, lora_name: l.name, strength_model: l.strength, model: last }, _meta: { title: `LoRA ${i + 1}` } };
    last = [id, 0];
  });
  for (const [id, node] of Object.entries(graph)) {
    if (id === lora || id.startsWith(`${lora}_lora`)) continue;
    for (const [name, value] of Object.entries(node.inputs)) if (isLink(value) && value[0] === lora) node.inputs[name] = last;
  }

  // Separate saved clips when model components change; keep existing default runs resumable.
  const componentKey = (value: ModelSettings) => JSON.stringify([
    value.model, value.loras.filter((lora) => lora.enabled !== false && lora.strength !== 0).map(({ name, strength }) => [name, strength]),
    value.textEncoder ?? DEFAULT_MODEL.textEncoder, value.videoVae ?? DEFAULT_MODEL.videoVae,
    value.audioVae ?? DEFAULT_MODEL.audioVae, value.acceleration ?? "none",
    ...(value.describer && value.describer !== DEFAULT_DESCRIBER ? [value.describer] : []),
  ]);
  const key = componentKey(settings);
  if (key !== componentKey(DEFAULT_MODEL) && Object.values(graph).some((node) => node.class_type === "MiniMaxH3ChainPlanModern")) {
    let hash = 14695981039346656037n;
    for (const char of key) hash = BigInt.asUintN(64, (hash ^ BigInt(char.codePointAt(0)!)) * 1099511628211n);
    suffixRunName(graph, "model_run_name", `_model${hash.toString(16)}`, "Run name for these model components");
  }

  if (settings.acceleration === "spectrum") {
    const patched = new Map<string, string>();
    for (const node of Object.values(graph)) {
      if (node.class_type !== "BasicGuider" && node.class_type !== "CFGGuider") continue;
      const model = node.inputs.model as [string, number];
      const key = JSON.stringify(model);
      let id = patched.get(key);
      if (!id) {
        id = `${model[0]}_spectrum`;
        graph[id] = {
          class_type: "SpectrumApplyMiniMaxH3",
          inputs: {
            model, enabled: true, blend_weight: 0.5, degree: 1, ridge_lambda: 0.1,
            window_size: 2, flex_window: 0.75, warmup_steps: 1, tail_actual_steps: 1,
            max_history: 8, debug: false, history_storage: "system_ram",
            audio_blend_weight: 0, offline_smoothing_replay: true,
          },
          _meta: { title: "Spectrum acceleration" },
        };
        patched.set(key, id);
      }
      node.inputs.model = [id, 0];
    }
  }
}
