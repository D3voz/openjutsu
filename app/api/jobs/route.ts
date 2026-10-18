import { NextResponse } from "next/server";
import { submitAdvanced, submitMask, submitSimple } from "../../../lib/comfy.ts";
import { MAX_CHARACTERS } from "../../../lib/advanced.ts";
import { CLIP_SECONDS, MARGINS, MAX_SEED, RESOLUTIONS, type Margin, type Resolution, type SimpleSettings } from "../../../lib/simple.ts";

export const runtime = "nodejs";

function parseVideo(form: FormData) {
  const video = form.get("video");
  if (!(video instanceof File) || video.size === 0) throw new Error("Drop a source video.");
  if (!video.type.startsWith("video/") && !/\.(mp4|mov|mkv|webm|avi)$/i.test(video.name)) throw new Error("The source must be a video file.");
  return video;
}

function parseMask(form: FormData) {
  const margin = String(form.get("margin") ?? "normal");
  if (!Object.hasOwn(MARGINS, margin)) throw new Error("Choose a supported mask margin.");
  return { hatFix: form.get("hat_fix") === "true", margin: margin as Margin };
}

function parsePicture(picture: FormDataEntryValue | null) {
  if (!(picture instanceof File) || picture.size === 0) throw new Error("Add a character photo.");
  if (!picture.type.startsWith("image/")) throw new Error("The character photo must be an image.");
  return picture;
}

function parseRun(form: FormData) {
  const resolution = String(form.get("resolution"));
  if (!RESOLUTIONS.includes(resolution as Resolution)) throw new Error("Choose a supported resolution.");
  const seed = Number(form.get("seed"));
  if (!Number.isInteger(seed) || seed < 0 || seed > MAX_SEED) throw new Error(`Seed must be a whole number from 0 to ${MAX_SEED}.`);
  const clipSeconds = Number(form.get("clip_seconds"));
  if (!(clipSeconds >= CLIP_SECONDS.min && clipSeconds <= CLIP_SECONDS.max)) {
    throw new Error(`Clip length must be ${CLIP_SECONDS.min}-${CLIP_SECONDS.max} s.`);
  }

  return { resolution: resolution as Resolution, ...parseMask(form), seed, clipSeconds };
}

function parseSimple(form: FormData) {
  const picture = parsePicture(form.get("picture"));
  const settings: SimpleSettings = { role: String(form.get("role") ?? "").slice(0, 200), ...parseRun(form) };
  return { picture, settings };
}

function parseAdvanced(form: FormData) {
  const pictures = form.getAll("picture").map(parsePicture);
  if (pictures.length < 1 || pictures.length > MAX_CHARACTERS) throw new Error(`Add 1-${MAX_CHARACTERS} character photos.`);
  const maxQuality = form.get("max_quality") === "true";
  if (maxQuality && pictures.length !== 2) throw new Error("One pass per person needs exactly two characters.");
  const roles = form.getAll("role").map((role) => String(role).slice(0, 200));
  return { pictures, maxQuality, settings: { roles, ...parseRun(form) } };
}

export async function POST(request: Request) {
  let submit: () => ReturnType<typeof submitSimple>;
  try {
    const form = await request.formData();
    const mode = form.get("mode");
    const video = parseVideo(form);
    if (mode === "mask") {
      const { hatFix, margin } = parseMask(form);
      submit = () => submitMask(video, hatFix, margin);
    } else if (mode === "simple") {
      const { picture, settings } = parseSimple(form);
      submit = () => submitSimple(video, picture, settings);
    } else if (mode === "advanced") {
      const { pictures, maxQuality, settings } = parseAdvanced(form);
      submit = () => submitAdvanced(video, pictures, settings, maxQuality);
    } else {
      throw new Error("Unknown mode.");
    }
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid request." }, { status: 400 });
  }

  try {
    return NextResponse.json(await submit(), { status: 202 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to submit the job." }, { status: 502 });
  }
}
