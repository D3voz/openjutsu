import { pruneAdvanced, type AdvancedSettings } from "./advanced.ts";
import { comfyUi } from "./comfy.ts";
import { pruneColor, type ColorSettings } from "./color.ts";
import { pruneControl, type ControlSettings } from "./control.ts";
import { pruneFace, type FaceSettings } from "./face.ts";
import { applyModel, type ModelSettings } from "./model.ts";
import { PEOPLE_NODES, pruneMontage, type Review } from "./montage.ts";
import { pruneObject, type ObjectSettings } from "./object.ts";
import { cropSource, pruneMask, pruneSimple, type ApiGraph, type Margin, type Resolution, type SimpleSettings } from "./simple.ts";

export type SetupRequest =
  | { kind: "simple"; settings: SimpleSettings; model: ModelSettings }
  | { kind: "advanced" | "advanced_maxq"; settings: AdvancedSettings; pictures: number; model: ModelSettings }
  | { kind: "object"; settings: ObjectSettings; picture: boolean; model: ModelSettings }
  | { kind: "control"; settings: ControlSettings; model: ModelSettings }
  | { kind: "face"; settings: FaceSettings; model: ModelSettings }
  | { kind: "color"; settings: ColorSettings }
  | { kind: "mask"; hatFix: boolean; margin: Margin; target: string }
  | { kind: "people"; resolution: Resolution }
  | { kind: "montage"; settings: AdvancedSettings; pictures: number; review: Review | null; model: ModelSettings };

export type SetupResult = {
  ok: boolean;
  error?: string;
  packs: { name: string; url: string; nodes: string[] }[];
  models: { name: string; folder: string }[];
};

type NodeInfo = { input?: { required?: Record<string, unknown[]>; optional?: Record<string, unknown[]> } };
export type NodeRegistry = Record<string, NodeInfo>;

const PACKS = [
  { name: "ComfyUI-MiniMaxH3-Context-Loop (0.7.3+)", url: "https://github.com/ethanfel/ComfyUI-MiniMaxH3-Context-Loop", nodes: ["MiniMaxH3GenerationProfile", "MiniMaxH3SourceTimeline", "MiniMaxH3ChainPlanModern", "MiniMaxH3ChainLoopStart", "MiniMaxH3ChainCurrent", "MiniMaxH3ChainContext", "MiniMaxH3ChainSegmentSave", "MiniMaxH3ChainReview", "MiniMaxH3ChainLoopEnd", "MiniMaxH3ChainAssemble", "MiniMaxH3ContexLoopSourceSlice", "MiniMaxH3ContexMaskedTarget", "MiniMaxH3ContexMaskGridPreview", "MiniMaxH3LoopTrim"] },
  { name: "comfyui-h3-oneclick-swap", url: "https://github.com/D3voz/comfyui-h3-oneclick-swap", nodes: ["H3OneClickSwapPlan", "H3AdvancedSwapPlan", "H3PictureSwapPlan", "H3ObjectSwapPlan", "H3ObjectPlacementMask", "H3PeopleMask", "H3GreyMannequins", "H3ClipShots", "H3FillShots", "H3TrackCrops", "H3TrackRoles", "H3RoleMask", "H3SubjectPrompt", "H3MontagePeople", "H3MontageTracks", "H3MontagePicks", "H3MontagePlan", "H3MontagePass", "H3FaceChunks", "H3FaceJoin"] },
  { name: "ComfyUI-Fantastic-MiniMaxH3-PromptBuilder", url: "https://github.com/Adudeguyman/ComfyUI-Fantastic-MiniMaxH3-PromptBuilder", nodes: ["MiniMaxH3FantasticVideoEditLatent"] },
  { name: "ComfyUI-KJNodes", url: "https://github.com/kijai/ComfyUI-KJNodes", nodes: ["GrowMaskWithBlur", "ImageAndMaskPreview"] },
  { name: "ComfyUI-VideoHelperSuite", url: "https://github.com/Kosinkadink/ComfyUI-VideoHelperSuite", nodes: ["VHS_LoadVideo", "VHS_SelectEveryNthImage", "VHS_VideoCombine"] },
  { name: "ComfyUI-H3-FaceRefine", url: "https://github.com/Carasibana/ComfyUI-H3-FaceRefine", nodes: ["H3FaceTrackCrop", "H3FaceMaskSAM", "H3FaceStitch"] },
  { name: "ComfyUI-Impact-Pack", url: "https://github.com/ltdrdata/ComfyUI-Impact-Pack", nodes: ["SAMLoader"] },
  { name: "comfyui-image-detail-contrast", url: "https://github.com/D3voz/comfyui-image-detail-contrast", nodes: ["ImageDetailContrast"] },
  { name: "Orion4D_FXMax", url: "https://github.com/orion4d/Orion4D_FXMax", nodes: ["Orion4D_FXMax_DCTLToneMapper"] },
  { name: "comfyui_controlnet_aux", url: "https://github.com/Fannovel16/comfyui_controlnet_aux", nodes: ["DepthAnythingV2Preprocessor"] },
];
const CORE = { name: "ComfyUI (update required)", url: "https://github.com/Comfy-Org/ComfyUI", nodes: [] as string[] };
const PACK_HINT = "Already installed? ComfyUI may be too old for the pack, or the pack failed to load. Update ComfyUI, restart it and check its console for import errors.";
const MODEL_INPUTS: Record<string, Record<string, string>> = {
  UNETLoader: { unet_name: "diffusion_models" },
  LoraLoaderModelOnly: { lora_name: "loras" },
  CLIPLoader: { clip_name: "text_encoders" },
  VAELoader: { vae_name: "vae" },
  CheckpointLoaderSimple: { ckpt_name: "checkpoints" },
  SAMLoader: { model_name: "sams" },
  ModelPatchLoader: { name: "model_patches" },
  H3FaceTrackCrop: { detector: "ultralytics", fallback_detector: "ultralytics" },
};

export function setupGraph(source: ApiGraph, selection: SetupRequest): ApiGraph {
  let graph: ApiGraph;
  if (selection.kind === "simple") graph = pruneSimple(source, selection.settings);
  else if (selection.kind === "object") graph = pruneObject(source, selection.picture, selection.settings);
  else if (selection.kind === "control") graph = pruneControl(source, selection.settings);
  else if (selection.kind === "face") graph = pruneFace(source, selection.settings);
  else if (selection.kind === "color") graph = pruneColor(source, selection.settings);
  else if (selection.kind === "mask") graph = pruneMask(source, selection.hatFix, selection.margin, selection.target);
  else if (selection.kind === "montage") graph = pruneMontage(source, selection.pictures, selection.settings, selection.review);
  else if (selection.kind === "people") {
    graph = structuredClone(source);
    if (typeof selection.resolution === "object") cropSource(graph, PEOPLE_NODES.video, selection.resolution);
  } else graph = pruneAdvanced(source, selection.pictures, selection.settings);
  if ("model" in selection) applyModel(graph, selection.model);
  return graph;
}

export function inspectSetup(graph: ApiGraph, registry: NodeRegistry): SetupResult {
  const packs: SetupResult["packs"] = [];
  const models: SetupResult["models"] = [];
  for (const type of new Set(Object.values(graph).map((node) => node.class_type))) {
    if (Object.hasOwn(registry, type)) continue;
    const pack = PACKS.find((p) => p.nodes.includes(type)) ?? CORE;
    let missing = packs.find((p) => p.url === pack.url);
    if (!missing) packs.push(missing = { name: pack.name, url: pack.url, nodes: [] });
    missing.nodes.push(type);
  }
  for (const node of Object.values(graph)) {
    const schema = registry[node.class_type]?.input;
    for (const [input, folder] of Object.entries(MODEL_INPUTS[node.class_type] ?? {})) {
      const name = node.inputs[input];
      const options = (schema?.required?.[input] ?? schema?.optional?.[input])?.[0];
      if (typeof name !== "string" || name === "none" || !Array.isArray(options)) continue;
      const normalized = name.replaceAll("\\", "/");
      if (!options.some((value) => typeof value === "string" && value.replaceAll("\\", "/") === normalized)
        && !models.some((m) => m.name === name && m.folder === folder)) models.push({ name, folder });
    }
  }
  const result: SetupResult = { ok: packs.length === 0 && models.length === 0, packs, models };
  if (packs.some((p) => p.url !== CORE.url)) result.error = PACK_HINT;
  return result;
}

export async function checkSetup(graph: ApiGraph): Promise<SetupResult> {
  try {
    const registry = await comfyUi("/object_info", 8000);
    if (!registry || typeof registry !== "object" || Array.isArray(registry)) throw new Error("Invalid node list");
    return inspectSetup(graph, registry);
  } catch {
    return { ok: false, error: "Could not check ComfyUI. Make sure it is running and COMFYUI_URL points to it, then try again.", packs: [], models: [] };
  }
}
