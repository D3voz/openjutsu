import { DEFAULT_MODEL, MAX_LORAS, STEPS, STRENGTH } from "./model.ts";
import { canvasSize, MAX_SEED, MOTION_SIZES, RESOLUTIONS, type ApiGraph, type MotionSize, type Resolution } from "./simple.ts";

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
    resolution = { width: Math.max(32, Math.round(size.width / 32) * 32), height: Math.max(32, Math.round(size.height / 32) * 32) };
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

// The describer's paragraph opens the detailed description; SolarRenderer keeps its shot tag and opening sentence first.
export function applyDescription(graph: ApiGraph, description: string) {
  const text = description.trim().replace(/\s+/g, " ");
  if (text) graph["56"].inputs.prompt = String(graph["56"].inputs.prompt).replace(/detailed_description:\n(\[Shot 1\] The shot begins from <Video 2>\. )?/, (head) => `${head}${text} `);
}

export const LIGHT_LOOKS = [
  { name: "Cold beam", image: "/relight/cold_beam.webp", light: "Light the new photo as a dark horror scene: a single narrow cold white spotlight shines straight down from directly above, with a visible beam of light cutting through dusty air above the head; it lights the top of the hair, forehead, cheekbones, nose and shoulders, leaves deep shadows in the eye sockets and under the nose and chin, and the background falls to black. Cold, desaturated blue-grey colour grade." },
  { name: "Golden halo", image: "/relight/golden_halo.webp", light: "Light the new photo with a warm golden glow: a strong amber backlight behind the head turns the background into glowing orange-gold haze and puts a bright golden rim on the hair and shoulders, while soft warm gold light falls on the face from the front. Rich honey and orange tones, glowing highlights, warm shadows, like sunset in a cathedral." },
  { name: "Red and blue gels", image: "/relight/red_blue_gels.webp", light: "Light the new photo with two coloured gel lights in a dark room: saturated red light from the left and deep electric blue light from the right, each colour wrapping around its side of the face, hair and body, purple where they meet, and a dark red-blue background. High-contrast cinematic colour." },
  { name: "Magenta club · mostly the background", image: "/relight/magenta_club.webp", light: "Light the new photo as a night club scene: the face, hair, skin and clothes are washed in hot magenta and purple stage light from above and the left, with pink highlights and deep violet shadows on the person, pink haze in the air and a blurry purple background with sparkling lights." },
  { name: "Teal lasers · mostly the background", image: "/relight/teal_lasers.webp", light: "Light the new photo as a dark club scene in teal and blue: the face, hair, skin and clothes are lit by cold cyan light from the side, with blue-tinted skin, cyan highlights and deep navy shadows on the person; thin bright cyan laser beams cut diagonally through the haze behind, and the background is dark blue-black." },
  { name: "Toxic green", image: "/relight/toxic_green.webp", light: "Light the new photo with eerie toxic green light: a vivid green light from below and the side lights the face, hair and clothes, green laser beams shine through dark haze behind, deep green-black shadows, the whole scene tinted acid green." },
  { name: "Lime and purple", image: "/relight/lime_purple.webp", light: "Light the new photo with two bold gel colours: acid yellow-lime light from the front left floods the face and hair, deep purple light fills the shadows on the right and the background, high saturation and strong contrast, like a music video." },
  { name: "Cyan orb", image: "/relight/cyan_orb.webp", light: "Light the new photo as a dark, moody scene lit only by a small glowing cold-blue light orb floating close to the face on the right side of the frame; the person is in darkness except where the orb's cool cyan-white light falls on the near side of the face, falling off quickly into blue-black shadow, with blue highlights in the eyes. No other light in the scene." },
  { name: "Red room", image: "/relight/red_room.webp", light: "Light the new photo with deep crimson red light filling the whole scene, dark red shadows and a red-black background, and one small bright white light at the left edge of the frame that puts a cold white highlight on the near cheek and in the eyes." },
];

export const FRAME_RELIGHT_PROMPT = "Relight this photograph. Keep the person, face, identity, expression, pose, hair, clothing, framing and setting exactly as they are; change only the lighting and the colour of the light. {look}";

export const RELIGHT_PROMPT = "Create a photograph of the person from <image 1> in exactly the pose, head angle, hand and arm positions, camera angle, framing and body cut of the person in <image 2>; describe that pose fully. The person from <image 1> also makes exactly the facial expression of the person in <image 2>, with the same mouth shape, eyebrows and gaze; describe that expression instead of their usual one. Take only the pose, expression and framing from <image 2>, never its person, face shape, hair or clothing. Keep the face, identity, eye colour, hair and clothing of <image 1>. {look}";

const KLEIN_UPSAMPLER = "You are the prompt upsampler of an image-editing model. You see the reference image(s), attached in order (the first image, the second image, ...), and the user's short request. Expand it into ONE detailed, self-contained instruction: the caption the editing model receives together with the same images. Output only the instruction as one continuous English prose block, with no greetings, explanations, Markdown, JSON, coordinates, ids or angle-bracket tokens. Read a vague or conversational request as the most plausible edit of the supplied images.\n\nPick the voice by task shape. When one reference stays and gets bounded changes, write an imperative editing instruction on it (\"Remove the ...\", \"Change the ... to ...\", \"Zoom in on ...\"); a whole-image transformation opens with its scope (\"Convert the entire image into ...\", \"Apply a ... filter over the entire scene\", \"Horizontally flip the entire image so that ...\", \"Shift the camera viewpoint to ...\", then where the major elements should now be). When the references are drawn into a newly composed frame (combining subjects, a new scene, a garment, object or style donor), write a generation request (\"Create a photograph of ...\", \"Create an anime-style illustration of ...\", \"Generate a new image featuring ...\") that says what to take from each image, by ordinal, and what is newly generated.\n\nKeep every explicit edit, constraint, count, position, style cue and piece of wording, and decide what is left open as one concrete plan. Ground everything in what is actually visible: identify each referent unambiguously by its real appearance, never mention content that is not there, and use every image the user attached. State every end state concretely (which color, how large, which pose, which material) and give new content enough appearance to be generated. Cover the knock-on effects of the change (shadows, reflections, occlusion, perspective, scale, lighting) and say what fills a removed region. A zoom-in names what stays in frame and which neighbors are cropped out; an outpainting continues the scene in the same medium. Describe the change, not the whole scene, and close an editing instruction with one compact clause naming what stays unchanged; transferred people keep their identity, face and accessories unless asked otherwise. Transcribe on-image text verbatim in its original language inside double quotes, with line breaks as \\n, and match the original font, size and color when replacing it. Name recognizable public figures, brands and landmarks you can see. Directions are frame-relative; use no evaluative or quality words. Typical length is 50 to 150 words.\n\nOutput only the instruction.";

function relightRequest(graph: ApiGraph, light: string) {
  const request = String(graph["6"].inputs.value);
  graph["6"].inputs.value = request.includes("{look}") ? request.replaceAll("{look}", light) : `${request} ${light}`;
  graph["25"].inputs.value = KLEIN_UPSAMPLER;
  Object.assign(graph["23"].inputs, { max_length: 3584, sampling_mode: "on", "sampling_mode.temperature": 1, "sampling_mode.top_k": 1, "sampling_mode.top_p": 0.95,
    "sampling_mode.min_p": 0, "sampling_mode.repetition_penalty": 1.05, "sampling_mode.seed": 0 });
}

// Pose and light in one FLUX pass, because stacked edits degrade the picture. FLUX sees only the character picture at 3 MP;
// the raw frame reaches it through the upsampler's written pose and sets the canvas shape.
export function applyRelight(graph: ApiGraph, light: string) {
  relightRequest(graph, light);
  delete graph["5"];
  graph["7"] = { class_type: "BatchImagesNode", inputs: { "images.image0": ["4", 0], "images.image1": ["3", 0] }, _meta: { title: "Character picture + raw frame for the prompt upsampler" } };
  const { positive, negative, vae } = graph["15"].inputs;
  graph["15"] = { class_type: "ReferenceMultiLatent", inputs: { positive, negative, vae, resolution: "resize", "resolution.megapixels": 3, "images.image0": ["4", 0] }, _meta: { title: "Character picture only, 3 MP" } };
  graph["relight_canvas"] = { class_type: "ImageScaleToTotalPixels", inputs: { image: ["3", 0], upscale_method: "lanczos", megapixels: 3, resolution_steps: 16 }, _meta: { title: "Frame shape at 3 MP" } };
  graph["relight_size"] = { class_type: "GetImageSize", inputs: { image: ["relight_canvas", 0] } };
  graph["relight_latent"] = { class_type: "EmptyFlux2LatentImage", inputs: { width: ["relight_size", 0], height: ["relight_size", 1], batch_size: 1 }, _meta: { title: "Relit canvas" } };
  graph["19"].inputs.latent_image = ["relight_latent", 0];
  graph["21"].inputs.filename_prefix = "openjutsu_picture/flux3/relit_frame";
}

// Relights the video's own person: FLUX edits the raw frame at 3 MP and keeps its person, pose and setting.
// Below denoise 1 sampling starts from the frame itself, which keeps its crop; at 1 FLUX may zoom out to fit the light.
export function applyFrameRelight(graph: ApiGraph, light: string, denoise: number) {
  relightRequest(graph, light);
  for (const id of ["4", "5", "7"]) delete graph[id];
  graph["8"].inputs.image = ["2", 0];
  const { positive, negative, vae } = graph["15"].inputs;
  graph["15"] = { class_type: "ReferenceMultiLatent", inputs: { positive, negative, vae, resolution: "resize", "resolution.megapixels": 3, "images.image0": ["2", 0] }, _meta: { title: "Raw frame only, 3 MP" } };
  graph["21"].inputs.filename_prefix = "openjutsu_picture/flux3/relit_video_frame";
  graph["19"].inputs.denoise = denoise;
  if (denoise === 1) return;
  graph["relight_frame"] = { class_type: "ImageScaleToTotalPixels", inputs: { image: ["2", 0], upscale_method: "lanczos", megapixels: 3, resolution_steps: 16 }, _meta: { title: "Raw frame at 3 MP" } };
  graph["relight_start"] = { class_type: "VAEEncode", inputs: { pixels: ["relight_frame", 0], vae: ["12", 0] }, _meta: { title: "Start from the frame" } };
  graph["19"].inputs.latent_image = ["relight_start", 0];
}
