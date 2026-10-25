import { apiAccess, HttpError, IMAGE_SIGNATURE, readFormData, StoredFile, VIDEO_SIGNATURE } from "../../../lib/http.ts";
import { NextResponse } from "next/server";
import { listModels, submitAdvanced, submitColor, submitControl, submitFace, submitMask, submitMontage, submitObject, submitPeople, submitSimple } from "../../../lib/comfy.ts";
import type { ControlSettings } from "../../../lib/control.ts";
import { TRACKS_FILE, type Label } from "../../../lib/montage.ts";
import { DEFAULT_TONE, DETAIL, TONE_MODES, TONE_RANGES, type ColorSettings, type ToneMode, type ToneSettings, type ToneValue } from "../../../lib/color.ts";
import { CHUNK_SECONDS, FACE_STYLES, type FaceSettings, type FaceStyle } from "../../../lib/face.ts";
import { MAX_CHARACTERS } from "../../../lib/advanced.ts";
import { MAX_LORAS, STEPS, STRENGTH, type ModelSettings } from "../../../lib/model.ts";
import { EDIT_MODES, OBJECT_MARGINS, parsePlacement, type EditMode, type ObjectMargin, type ObjectSettings } from "../../../lib/object.ts";
import { CLIP_SECONDS, DEFAULT_TARGET, MARGINS, MAX_SEED, MIN_SECTION_SECONDS, MOTION_SIZES, RESOLUTIONS, CUSTOM_SIZE, type Margin, type MotionSize, type Preset, type Resolution, type Section, type SimpleSettings } from "../../../lib/simple.ts";

export const runtime = "nodejs";

const FILE_CHECKS = {
  video: { signature: VIDEO_SIGNATURE, error: "The source must be an MP4, MOV, MKV, WebM or AVI video." },
  picture: { signature: IMAGE_SIGNATURE, error: "Photos must be PNG, JPEG or WebP images." },
};

function parseVideo(form: FormData) {
  const video = form.get("video");
  if (!(video instanceof StoredFile) || video.size === 0) throw new Error("Drop a source video.");
  if (!video.type.startsWith("video/") && !/\.(mp4|mov|mkv|webm|avi)$/i.test(video.name)) throw new Error("The source must be a video file.");
  return video;
}

// Without start and length the whole video is used.
function parseSection(form: FormData): Section {
  const start = Number(form.get("start") ?? 0);
  const length = Number(form.get("length") ?? 0);
  if (!Number.isFinite(start) || !(start >= 0)) throw new Error("The start of the part to use must be 0 s or later.");
  if (!Number.isFinite(length) || !(length === 0 || length >= MIN_SECTION_SECONDS)) throw new Error(`The part to use must be at least ${MIN_SECTION_SECONDS} s long.`);
  return { start, length };
}

function parseMask(form: FormData) {
  const margin = String(form.get("margin") ?? "normal");
  if (!Object.hasOwn(MARGINS, margin)) throw new Error("Choose a supported mask margin.");
  const target = String(form.get("target") ?? "").replace(/\s+/g, " ").trim().slice(0, 100) || DEFAULT_TARGET;
  return { hatFix: form.get("hat_fix") === "true", margin: margin as Margin, target };
}

function parsePicture(picture: FormDataEntryValue | null) {
  if (!(picture instanceof StoredFile) || picture.size === 0) throw new Error("Add a character photo.");
  if (!picture.type.startsWith("image/")) throw new Error("The character photo must be an image.");
  return picture;
}

function parseResolution(form: FormData): Resolution {
  const entry = String(form.get("resolution"));
  const custom = entry.match(/^(\d+)x(\d+)$/);
  const [width, height] = custom ? [custom[1], custom[2]].map((side) => Math.round(Number(side) / CUSTOM_SIZE.step) * CUSTOM_SIZE.step) : [0, 0];
  if (custom ? !(Math.min(width, height) >= CUSTOM_SIZE.min && Math.max(width, height) <= CUSTOM_SIZE.max) : !RESOLUTIONS.includes(entry as Preset)) {
    throw new Error(`Choose a resolution, or a custom size of ${CUSTOM_SIZE.min}-${CUSTOM_SIZE.max} px a side.`);
  }
  return custom ? { width, height } : entry as Preset;
}

function parseRun(form: FormData) {
  const resolution = parseResolution(form);
  const motion = Number(form.get("motion"));
  if (!MOTION_SIZES.includes(motion as MotionSize)) throw new Error("Choose a supported motion reference size.");
  const seed = Number(form.get("seed"));
  if (!Number.isInteger(seed) || seed < 0 || seed > MAX_SEED) throw new Error(`Seed must be a whole number from 0 to ${MAX_SEED}.`);
  const clipSeconds = Number(form.get("clip_seconds"));
  if (!(clipSeconds >= CLIP_SECONDS.min && clipSeconds <= CLIP_SECONDS.max)) {
    throw new Error(`Clip length must be ${CLIP_SECONDS.min}-${CLIP_SECONDS.max} s.`);
  }

  return { resolution, motion: motion as MotionSize, seed, clipSeconds };
}

function parseObject(form: FormData) {
  const mode = String(form.get("edit_mode"));
  if (!EDIT_MODES.includes(mode as EditMode)) throw new Error("Choose change, remove, background or add.");
  const margin = String(form.get("margin") ?? "normal");
  if (!Object.hasOwn(OBJECT_MARGINS, margin)) throw new Error("Choose a supported mask margin.");
  const target = String(form.get("target") ?? "").replace(/\s+/g, " ").trim().slice(0, 100);
  if (!target) throw new Error(mode === "add" ? "Say where the object goes, for example on the table." : mode === "background" ? "Say what stays, for example person." : "Say what to change, for example hair.");
  const changeTo = String(form.get("change_to") ?? "").replace(/\s+/g, " ").trim().slice(0, 300);
  const entry = form.get("picture");
  const picture = entry instanceof StoredFile && entry.size > 0 && mode !== "remove" ? parsePicture(entry) : null;
  if (mode !== "remove" && !changeTo && !picture) throw new Error(mode === "add" ? "Describe the object to add, or add a picture." : "Say what it becomes, or add a picture.");
  const settings: ObjectSettings = {
    mode: mode as EditMode, target, changeTo, biggestOnly: form.get("biggest_only") === "true", keepOutline: form.get("keep_outline") === "true",
    margin: margin as ObjectMargin, ...parseRun(form),
    ...(mode === "add" ? { placement: parsePlacement(form.get("placement")), action: String(form.get("action") ?? "").replace(/\s+/g, " ").trim().slice(0, 300) } : {}),
  };
  return { picture, settings };
}

function parseModel(form: FormData, available: { models: string[]; loras: string[] }): ModelSettings {
  const steps = Number(form.get("steps"));
  if (!Number.isInteger(steps) || steps < STEPS.min || steps > STEPS.max) throw new Error(`Steps must be a whole number from ${STEPS.min} to ${STEPS.max}.`);
  const model = String(form.get("model") ?? "").trim();
  if (!model || !available.models.includes(model)) throw new Error("Choose a base model ComfyUI has.");
  const names = form.getAll("lora").map((name) => String(name).trim());
  const strengths = form.getAll("lora_strength").map(Number);
  if (names.length > MAX_LORAS || strengths.length !== names.length) throw new Error(`Use at most ${MAX_LORAS} LoRAs, each with a strength.`);
  const loras = names.map((name, i) => {
    if (!name || !available.loras.includes(name)) throw new Error("Choose LoRAs ComfyUI has.");
    if (!(strengths[i] >= STRENGTH.min && strengths[i] <= STRENGTH.max)) throw new Error(`LoRA strength must be ${STRENGTH.min} to ${STRENGTH.max}.`);
    return { name, strength: strengths[i] };
  });
  return { steps, model, loras };
}

function parseFace(form: FormData) {
  const picture = parsePicture(form.get("picture"));
  const style = String(form.get("style"));
  if (!FACE_STYLES.includes(style as FaceStyle)) throw new Error("Choose Match the photo or Follow the mouth.");
  const seed = Number(form.get("seed"));
  if (!Number.isInteger(seed) || seed < 0 || seed > MAX_SEED) throw new Error(`Seed must be a whole number from 0 to ${MAX_SEED}.`);
  const chunkSeconds = Number(form.get("clip_seconds"));
  if (!(chunkSeconds >= CHUNK_SECONDS.min && chunkSeconds <= CHUNK_SECONDS.max)) throw new Error(`Chunk length must be ${CHUNK_SECONDS.min}-${CHUNK_SECONDS.max} s.`);
  const settings: FaceSettings = { style: style as FaceStyle, seed, chunkSeconds };
  return { picture, settings };
}

// A step without its fields is turned off.
function parseColor(form: FormData): ColorSettings {
  const detailEntry = form.get("detail");
  const detail = detailEntry === null ? null : Number(detailEntry);
  if (detail !== null && !(detail >= DETAIL.min && detail <= DETAIL.max)) throw new Error(`Detail contrast must be ${DETAIL.min} to ${DETAIL.max}.`);
  const mode = form.get("tone_mode");
  let tone: ToneSettings | null = null;
  if (mode !== null) {
    if (!TONE_MODES.includes(mode as ToneMode)) throw new Error("Choose a supported tone mapper mode.");
    tone = { ...DEFAULT_TONE, mode: mode as ToneMode };
    for (const key of Object.keys(TONE_RANGES) as ToneValue[]) {
      const range = TONE_RANGES[key];
      const value = Number(form.get(`tone_${key}`));
      if (!(value >= range.min && value <= range.max)) throw new Error(`${range.label} must be ${range.min} to ${range.max}.`);
      tone[key] = value;
    }
  }
  if (detail === null && tone === null) throw new Error("Turn on detail contrast, the tone mapper or both.");
  return { detail, tone };
}

function parseSimple(form: FormData) {
  const picture = parsePicture(form.get("picture"));
  const settings: SimpleSettings = { role: String(form.get("role") ?? "").slice(0, 200), noLipSync: form.get("no_lip_sync") === "true", ...parseRun(form), ...parseMask(form) };
  return { picture, settings };
}

function parseControl(form: FormData) {
  const picture = parsePicture(form.get("picture"));
  const { resolution, seed } = parseRun(form);
  const settings: ControlSettings = { target: parseMask(form).target, noLipSync: form.get("no_lip_sync") === "true", resolution, seed };
  return { picture, settings };
}

function parseAdvanced(form: FormData) {
  const pictures = form.getAll("picture").map(parsePicture);
  if (pictures.length < 1 || pictures.length > MAX_CHARACTERS) throw new Error(`Add 1-${MAX_CHARACTERS} character photos.`);
  const maxQuality = form.get("max_quality") === "true";
  if (maxQuality && pictures.length !== 2) throw new Error("One pass per person needs exactly two characters.");
  const roles = form.getAll("role").map((role) => String(role).slice(0, 200));
  return { pictures, maxQuality, settings: { roles, noLipSync: form.get("no_lip_sync") === "true", ...parseRun(form), ...parseMask(form) } };
}

// Find people matches the tracks to the roles' looks, so every photo needs one.
function parsePeople(form: FormData) {
  const roles = form.getAll("role").map((role) => String(role).replace(/\s+/g, " ").trim().slice(0, 200));
  if (roles.length < 1 || roles.length > MAX_CHARACTERS) throw new Error(`Add 1-${MAX_CHARACTERS} character photos.`);
  if (roles.some((role) => !role)) throw new Error("Say who each photo replaces and how they look, e.g. “the dancer - white polo, jeans”.");
  return { roles, resolution: parseResolution(form) };
}

// The appearances picked in the person list: a SAM track within its frames, and the photo it becomes.
function parseLabels(entry: FormDataEntryValue | null, photos: number): Label[] {
  let labels: Label[] = [];
  try {
    labels = JSON.parse(String(entry));
  } catch {}
  const whole = (value: unknown): value is number => Number.isInteger(value) && (value as number) >= 0;
  const valid = Array.isArray(labels) && labels.length > 0
    && labels.every((l) => whole(l?.track) && whole(l.start) && whole(l.end) && l.end > l.start && whole(l.role) && l.role >= 1 && l.role <= photos);
  if (!valid) throw new Error("Pick a photo for at least one person.");
  return labels.map(({ track, start, end, role }) => ({ track, start, end, role }));
}

// Without tracks the montage finds the people itself and starts from the default picks; with them, the person list's picks are used.
function parseMontage(form: FormData) {
  const { pictures, settings } = parseAdvanced(form);
  if (pictures.length !== parsePeople(form).roles.length) throw new Error("Give each photo a role.");
  const tracks = form.get("tracks");
  if (tracks === null) return { pictures, settings, review: null };
  if (!TRACKS_FILE.test(String(tracks))) throw new Error("Find people again.");
  return { pictures, settings, review: { tracks: String(tracks), labels: parseLabels(form.get("labels"), pictures.length) } };
}

// Uploads stream to temp files, so the cap bounds disk use rather than memory.
const MAX_UPLOADS = 3;
let uploads = 0;

export async function POST(request: Request) {
  const denied = apiAccess(request);
  if (denied) return denied;
  if (uploads >= MAX_UPLOADS) return NextResponse.json({ error: "Another upload is in progress. Try again shortly." }, { status: 429, headers: { "Retry-After": "5" } });
  uploads++;
  try {
    return await submitJob(request);
  } finally {
    uploads--;
  }
}

function invalid(error: unknown) {
  return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid request." }, { status: error instanceof HttpError ? error.status : 400 });
}

async function submitJob(request: Request) {
  let upload: Awaited<ReturnType<typeof readFormData>>;
  try {
    upload = await readFormData(request, FILE_CHECKS);
  } catch (error) {
    return invalid(error);
  }
  try {
    return await submitForm(upload.form);
  } finally {
    await upload.dispose();
  }
}

async function submitForm(form: FormData) {
  let submit: () => ReturnType<typeof submitSimple>;
  try {
    const mode = form.get("mode");
    const video = parseVideo(form);
    const section = parseSection(form);
    if (mode === "mask") {
      const { hatFix, margin, target } = parseMask(form);
      submit = () => submitMask(video, section, hatFix, margin, target);
    } else if (mode === "people") {
      const { roles, resolution } = parsePeople(form);
      submit = () => submitPeople(video, section, roles, resolution);
    } else if (mode === "montage") {
      const { pictures, settings, review } = parseMontage(form);
      const model = parseModel(form, await listModels());
      submit = () => submitMontage(video, section, pictures, settings, review, model);
    } else if (mode === "simple") {
      const { picture, settings } = parseSimple(form);
      const model = parseModel(form, await listModels());
      submit = () => submitSimple(video, section, picture, settings, model);
    } else if (mode === "advanced") {
      const { pictures, maxQuality, settings } = parseAdvanced(form);
      const model = parseModel(form, await listModels());
      submit = () => submitAdvanced(video, section, pictures, settings, maxQuality, model);
    } else if (mode === "object") {
      const { picture, settings } = parseObject(form);
      const model = parseModel(form, await listModels());
      submit = () => submitObject(video, section, picture, settings, model);
    } else if (mode === "control") {
      const { picture, settings } = parseControl(form);
      const model = parseModel(form, await listModels());
      submit = () => submitControl(video, section, picture, settings, model);
    } else if (mode === "face") {
      const { picture, settings } = parseFace(form);
      const model = parseModel(form, await listModels());
      submit = () => submitFace(video, section, picture, settings, model);
    } else if (mode === "color") {
      const settings = parseColor(form);
      submit = () => submitColor(video, section, settings);
    } else {
      throw new Error("Unknown mode.");
    }
  } catch (error) {
    return invalid(error);
  }

  try {
    return NextResponse.json(await submit(), { status: 202 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to submit the job." }, { status: 502 });
  }
}
