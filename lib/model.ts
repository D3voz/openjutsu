// Base model, LoRAs and steps, shared by every swap workflow. Each export has one "H3 Diffusion Model" UNETLoader
// feeding one "DMAD LoRA" LoraLoaderModelOnly; the LoRA list replaces that node with a chain (or removes it).
import { nodeByTitle } from "./advanced.ts";
import { isLink, type ApiGraph } from "./simple.ts";

export type Lora = { name: string; strength: number };
export type ModelSettings = { model: string; loras: Lora[]; steps: number };

export const DEFAULT_MODEL: ModelSettings = {
  model: "minimax_h3_ref2va_pruned_int8_convrot.safetensors",
  loras: [{ name: "minimax_h3_DMAD_4step_full_lora_avg_rank_39_bf16.safetensors", strength: 1 }],
  steps: 6,
};
export const MAX_LORAS = 4;
export const STEPS = { min: 1, max: 100 };
export const STRENGTH = { min: -4, max: 4 };

// Mutates graph: the steps (on the Swap Plan, or the Schedule in Fix faces, which has no plan), the chosen diffusion model,
// then the LoRAs in order into whatever read the old LoRA node.
export function applyModel(graph: ApiGraph, settings: ModelSettings) {
  const plans = Object.values(graph).filter((node) => node.class_type === "H3OneClickSwapPlan" || node.class_type === "H3AdvancedSwapPlan");
  if (plans.length > 1) throw new Error(`Expected one Swap Plan node in the workflow, found ${plans.length}.`);
  (plans[0] ?? graph[nodeByTitle(graph, "Schedule")]).inputs.steps = settings.steps;
  const unet = nodeByTitle(graph, "H3 Diffusion Model");
  const lora = nodeByTitle(graph, "DMAD LoRA");
  graph[unet].inputs.unet_name = settings.model;

  const template = graph[lora];
  delete graph[lora];
  let last: [string, number] = [unet, 0];
  settings.loras.forEach((l, i) => {
    const id = i === 0 ? lora : `${lora}_lora${i + 1}`;
    graph[id] = { ...template, inputs: { ...template.inputs, lora_name: l.name, strength_model: l.strength, model: last }, _meta: { title: `LoRA ${i + 1}` } };
    last = [id, 0];
  });
  for (const [id, node] of Object.entries(graph)) {
    if (id === lora || id.startsWith(`${lora}_lora`)) continue;
    for (const [name, value] of Object.entries(node.inputs)) if (isLink(value) && value[0] === lora) node.inputs[name] = last;
  }
}
