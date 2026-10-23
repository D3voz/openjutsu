// Fix colours: post-processing for a finished video. Image Detail Contrast (F:\AI\comfyui-image-detail-contrast) softens
// H3's crunchy fine detail, then Orion4D's DCTL Tone Mapper grades the frames: by default H3 soft, a lighter take on
// zuanfilm's H3 preset that softens contrast and highlights without washing out the blacks. workflows/color.api.json is
// hand-written; each request sets the values and drops a step that is turned off. Nodes are found by title.
import { nodeByTitle } from "./advanced.ts";
import type { ApiGraph } from "./simple.ts";

export const COLOR_VIDEO = "Video to fix";

export const TONE_MODES = ["Filmic Soft", "Filmic Strong", "ACES Approx", "Reinhard", "Cineon-ish"] as const;
export type ToneMode = (typeof TONE_MODES)[number];

export type ToneSettings = {
  mode: ToneMode; exposure: number; contrast: number; pivot: number; highlight_rolloff: number;
  shadow_lift: number; black_floor: number; saturation: number; strength: number;
};
export type ToneValue = Exclude<keyof ToneSettings, "mode">;

// Orion's own ranges for each value.
export const TONE_RANGES: Record<ToneValue, { label: string; min: number; max: number; step: number }> = {
  exposure: { label: "Exposure", min: -5, max: 5, step: 0.01 },
  contrast: { label: "Contrast", min: 0, max: 3, step: 0.01 },
  pivot: { label: "Pivot", min: 0.01, max: 1, step: 0.01 },
  highlight_rolloff: { label: "Highlight rolloff", min: 0, max: 2, step: 0.01 },
  shadow_lift: { label: "Shadow lift", min: -1, max: 1, step: 0.01 },
  black_floor: { label: "Black floor", min: 0, max: 0.25, step: 0.01 },
  saturation: { label: "Saturation", min: 0, max: 3, step: 0.01 },
  strength: { label: "Strength", min: 0, max: 2, step: 0.01 },
};

export const DEFAULT_PRESET = "H3 soft";
export const DEFAULT_TONE: ToneSettings = {
  mode: "Reinhard", exposure: 0.09, contrast: 0.84, pivot: 0.69, highlight_rolloff: 0.27,
  shadow_lift: 0.15, black_floor: 0.03, saturation: 1.05, strength: 0.2,
};

export const DETAIL = { min: -1, max: 1, default: -0.2 };

// null turns a step off.
export type ColorSettings = { detail: number | null; tone: ToneSettings | null };

// An Orion preset as ComfyUI returns it, with the values this page does not show left out.
export function toneFromPreset(settings: Record<string, unknown>): ToneSettings {
  const tone = { ...DEFAULT_TONE };
  if (TONE_MODES.includes(settings.mode as ToneMode)) tone.mode = settings.mode as ToneMode;
  for (const key of Object.keys(TONE_RANGES) as ToneValue[]) {
    const value = settings[key];
    if (typeof value === "number") tone[key] = value;
  }
  return tone;
}

export function pruneColor(source: ApiGraph, settings: ColorSettings): ApiGraph {
  const graph: ApiGraph = structuredClone(source);
  const detail = nodeByTitle(graph, "Detail contrast");
  const tone = nodeByTitle(graph, "Tone mapper");
  if (settings.detail === null) {
    graph[tone].inputs.image = graph[detail].inputs.image;
    delete graph[detail];
  } else {
    graph[detail].inputs.detail_contrast = settings.detail;
  }
  if (settings.tone === null) {
    graph[nodeByTitle(graph, "Fixed video")].inputs.images = graph[tone].inputs.image;
    delete graph[tone];
  } else {
    // Orion uses raw_settings over its preset files when the preset names match.
    const node = graph[tone].inputs;
    node.raw_settings = JSON.stringify({ node_type: "color_fx_dctl_tone_mapper", preset: node.preset, settings: { ...settings.tone, preserve_luminosity: false, clamp_output: true } });
  }
  return graph;
}
