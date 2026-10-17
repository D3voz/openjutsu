import { NextResponse } from "next/server";
import { submitSimple } from "../../../lib/comfy.ts";
import { CLIP_SECONDS, MAX_PICTURES, MAX_SEED, RESOLUTIONS, type Resolution, type SimpleSettings } from "../../../lib/simple.ts";

export const runtime = "nodejs";

function parse(form: FormData) {
  if (form.get("mode") !== "simple") throw new Error("Only Simple motion transfer is available so far.");

  const video = form.get("video");
  if (!(video instanceof File) || video.size === 0) throw new Error("Drop a source video.");
  if (!video.type.startsWith("video/") && !/\.(mp4|mov|mkv|webm|avi)$/i.test(video.name)) throw new Error("The source must be a video file.");

  const pictures: File[] = [];
  const roles: string[] = [];
  for (let i = 1; i <= MAX_PICTURES; i++) {
    const picture = form.get(`picture_${i}`);
    if (!(picture instanceof File) || picture.size === 0) break;
    if (!picture.type.startsWith("image/")) throw new Error(`Character ${i} must be an image.`);
    pictures.push(picture);
    roles.push(String(form.get(`role_${i}`) ?? "").slice(0, 200));
  }
  if (!pictures.length) throw new Error("Add at least one character photo.");

  const resolution = String(form.get("resolution"));
  if (!RESOLUTIONS.includes(resolution as Resolution)) throw new Error("Choose a supported resolution.");
  const seed = Number(form.get("seed"));
  if (!Number.isInteger(seed) || seed < 0 || seed > MAX_SEED) throw new Error(`Seed must be a whole number from 0 to ${MAX_SEED}.`);
  const clipSeconds = Number(form.get("clip_seconds"));
  if (!(clipSeconds >= CLIP_SECONDS.min && clipSeconds <= CLIP_SECONDS.max)) {
    throw new Error(`Clip length must be ${CLIP_SECONDS.min}-${CLIP_SECONDS.max} s.`);
  }

  const settings: SimpleSettings = { roles, resolution: resolution as Resolution, hatFix: form.get("hat_fix") === "true", seed, clipSeconds };
  return { video, pictures, settings };
}

export async function POST(request: Request) {
  let input: ReturnType<typeof parse>;
  try {
    input = parse(await request.formData());
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid request." }, { status: 400 });
  }

  try {
    return NextResponse.json(await submitSimple(input.video, input.pictures, input.settings), { status: 202 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to submit the job." }, { status: 502 });
  }
}
