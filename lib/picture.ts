import { DEFAULT_MODEL, MAX_LORAS, STEPS, STRENGTH } from "./model.ts";
import { canvasSize, CUSTOM_SIZE, MAX_SEED, MOTION_SIZES, RESOLUTIONS, type ApiGraph, type MotionSize, type Resolution } from "./simple.ts";

export type PictureVideoSettings = {
  renderer: "h3" | "solar"; solarRank: 384 | 64; solarFourStep: string; solarControl: string;
  seconds: number; resolution: Resolution; motion: 0 | MotionSize; seed: number; steps: number;
  model: string; useLoras: boolean; loras: { name: string; strength: number; enabled: boolean }[];
  textEncoder: string; videoVae: string; audioVae: string;
};

export const DEFAULT_PICTURE_VIDEO: PictureVideoSettings = {
  renderer: "solar", solarRank: 384, ...solarLoraFiles(384),
  seconds: 6, resolution: "480p", motion: 0, seed: 0, steps: 4,
  model: DEFAULT_MODEL.model, useLoras: true, loras: DEFAULT_MODEL.loras.map((lora) => ({ ...lora, enabled: true })),
  textEncoder: "qwen3vl_32b_minimax_h3_int4_convrot.safetensors",
  videoVae: "minimax_h3_video_vae_int8_convrot.safetensors", audioVae: "minimax_h3_audio_vae_fp32.safetensors",
};

export function solarLoraFiles(rank: 384 | 64, files: string[] = []) {
  const find = (role: string) => {
    const name = `solarrenderer_${role}_lora${rank === 64 ? "_rank64" : ""}.safetensors`;
    return files.includes(name) ? name : files.find((file) => file.replaceAll("\\", "/").split("/").at(-1) === name) ?? name;
  };
  return { solarFourStep: find("4step"), solarControl: find("control") };
}

export function pictureLoras(settings: PictureVideoSettings) {
  return settings.renderer === "solar" ? [settings.solarFourStep, settings.solarControl]
    : settings.useLoras ? settings.loras.filter((lora) => lora.enabled).map((lora) => lora.name) : [];
}

export function pictureFrames(seconds: number) {
  return Math.max(5, Math.floor((Math.floor(seconds * 24 + 1e-6) - 5) / 17) * 17 + 5);
}

export function parsePictureVideoSettings(value: unknown): PictureVideoSettings {
  if (value !== undefined && (!value || typeof value !== "object" || Array.isArray(value))) throw new Error("Choose video render settings.");
  const input = { ...DEFAULT_PICTURE_VIDEO, ...value as Partial<PictureVideoSettings> };
  if (value && !Object.hasOwn(value, "renderer") && Object.keys(value).length) input.renderer = "h3";
  if (!["h3", "solar"].includes(input.renderer)) throw new Error("Choose H3 or SolarRenderer.");
  if (![384, 64].includes(input.solarRank)) throw new Error("Choose SolarRenderer rank 384 or rank 64.");
  const seconds = Number(input.seconds), seed = Number(input.seed), steps = Number(input.steps), motion = Number(input.motion);
  if (!Number.isFinite(seconds) || seconds < 5 / 24 || seconds > 15) throw new Error("Video length must be between 5 frames and 15 seconds.");
  if (input.renderer === "solar" && pictureFrames(seconds) < 22) throw new Error("SolarRenderer needs at least 22 frames.");
  if (!Number.isInteger(seed) || seed < 0 || seed > MAX_SEED) throw new Error(`Seed must be a whole number from 0 to ${MAX_SEED}.`);
  if (!Number.isInteger(steps) || steps < STEPS.min || steps > STEPS.max) throw new Error(`Steps must be ${STEPS.min}-${STEPS.max}.`);
  if (input.renderer === "solar" && steps > 50) throw new Error("SolarRenderer supports at most 50 steps; use 4 with its four-step LoRA.");
  if (![0, ...MOTION_SIZES].includes(motion)) throw new Error("Choose a supported motion reference resolution.");
  let resolution: Resolution;
  if (typeof input.resolution === "string" && RESOLUTIONS.includes(input.resolution)) resolution = input.resolution;
  else {
    const size = input.resolution;
    if (!size || typeof size !== "object" || ![size.width, size.height].every((side) => Number.isFinite(side) && side > 0)) throw new Error("Choose a video resolution or positive custom dimensions.");
    const [width, height] = [size.width, size.height].map((side) => Math.round(side / CUSTOM_SIZE.step) * CUSTOM_SIZE.step);
    if (Math.min(width, height) < CUSTOM_SIZE.min || Math.max(width, height) > CUSTOM_SIZE.max) throw new Error(`Choose custom dimensions of ${CUSTOM_SIZE.min}-${CUSTOM_SIZE.max} px a side.`);
    resolution = { width, height };
  }
  if (typeof input.useLoras !== "boolean" || !Array.isArray(input.loras) || input.loras.length > MAX_LORAS) throw new Error(`Use at most ${MAX_LORAS} LoRAs.`);
  const loras = input.loras.map((lora) => {
    if (!lora || typeof lora.name !== "string" || !Number.isFinite(lora.strength) || lora.strength < STRENGTH.min || lora.strength > STRENGTH.max) throw new Error(`Choose each LoRA and a strength from ${STRENGTH.min} to ${STRENGTH.max}.`);
    return { name: lora.name.trim(), strength: lora.strength, enabled: lora.enabled !== false };
  });
  for (const key of ["model", "textEncoder", "videoVae", "audioVae", "solarFourStep", "solarControl"] as const) if (typeof input[key] !== "string" || !input[key].trim()) throw new Error("Choose the model components and both SolarRenderer LoRA files.");
  return { seconds, seed, steps, motion: motion as 0 | MotionSize, resolution, useLoras: input.useLoras, loras,
    renderer: input.renderer, solarRank: input.solarRank, solarFourStep: input.solarFourStep.trim(), solarControl: input.solarControl.trim(),
    model: input.model.trim(), textEncoder: input.textEncoder.trim(), videoVae: input.videoVae.trim(), audioVae: input.audioVae.trim() };
}

export function applyPictureVideoSettings(graph: ApiGraph, settings: PictureVideoSettings, sourceWidth: number, sourceHeight: number) {
  const [width, height] = typeof settings.resolution === "string" ? canvasSize(sourceWidth, sourceHeight, settings.resolution) : [settings.resolution.width, settings.resolution.height];
  const length = pictureFrames(settings.seconds);
  graph["1"].inputs.frame_load_cap = length;
  Object.assign(graph["56"].inputs, { width, height, length });
  const scale = settings.motion ? settings.motion / Math.max(width, height) : 1;
  Object.assign(graph["33"].inputs, { width: Math.max(32, Math.round(width * scale / 32) * 32), height: Math.max(32, Math.round(height * scale / 32) * 32), crop: "center" });
  graph["33"]._meta = { title: "Normal-map motion reference resolution" };
  graph["58"].inputs.noise_seed = settings.seed;
  graph["60"].inputs.steps = settings.steps;
  graph["50"].inputs.unet_name = settings.model;
  graph["53"].inputs.clip_name = settings.textEncoder;
  graph["54"].inputs.vae_name = settings.videoVae;
  if (settings.renderer === "solar") {
    graph["51"].inputs.lora_name = settings.solarFourStep;
    graph["64"].inputs.lora_name = settings.solarControl;
    graph["65"].inputs.seed = settings.seed;
    return;
  }
  graph["55"].inputs.vae_name = settings.audioVae;
  delete graph["51"];
  let model: [string, number] = ["50", 0];
  if (settings.useLoras) settings.loras.filter((lora) => lora.enabled).forEach((lora, index) => {
    const id = `picture_lora_${index}`;
    graph[id] = { class_type: "LoraLoaderModelOnly", inputs: { model, lora_name: lora.name, strength_model: lora.strength }, _meta: { title: `LoRA ${index + 1}` } };
    model = [id, 0];
  });
  graph["49"].inputs.model = model;
}
