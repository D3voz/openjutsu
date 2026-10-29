import { randomUUID } from "node:crypto";
import { openAsBlob } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { apiAccess, HttpError, IMAGE_SIGNATURE, readFormData, StoredFile, validateJobId, VIDEO_SIGNATURE } from "../../../lib/http.ts";
import { canvasSize, isLink, MAX_SEED, type ApiGraph } from "../../../lib/simple.ts";
import { listModels } from "../../../lib/comfy.ts";
import { applyPictureVideoSettings, DEFAULT_PICTURE_VIDEO, parsePictureVideoSettings, pictureLoras, solarLoraFiles, type PictureVideoSettings } from "../../../lib/picture.ts";

export const runtime = "nodejs";
const PREPARED = "OpenJutsu · prepared picture";
const RENDERED = "OpenJutsu · picture motion";
const FILE_CHECKS = {
  video: { signature: VIDEO_SIGNATURE, error: "Choose an MP4, MOV, MKV, WebM or AVI video." },
  picture: { signature: IMAGE_SIGNATURE, error: "Choose a PNG, JPEG or WebP character picture." },
};
type OutputFile = { filename: string; subfolder?: string; type?: string };
type History = { prompt?: [number, string, ApiGraph]; status?: { status_str?: string; completed?: boolean }; outputs?: Record<string, { images?: OutputFile[]; gifs?: OutputFile[] }> };

async function comfy(path: string, init?: RequestInit, rangeResponse = false) {
  const base = (process.env.COMFYUI_URL?.trim() || "http://127.0.0.1:8188").replace(/\/+$/, "");
  const response = await fetch(`${base}${path}`, { ...init, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(30_000) });
  if (!response.ok && !(rangeResponse && response.status === 416)) {
    const data = await response.json().catch(() => null);
    const details = Object.values(data?.node_errors ?? {}).flatMap((node) => (node as { errors?: { message: string; details?: string }[] }).errors ?? [])
      .map((error) => `${error.message}${error.details ? `: ${error.details}` : ""}`).join("; ");
    throw new HttpError(502, details || data?.error?.message || `ComfyUI answered with HTTP ${response.status}. Check its console.`);
  }
  return response;
}

async function template(stage: "prepare" | "motion" | "solar"): Promise<ApiGraph> {
  return JSON.parse(await readFile(join(process.cwd(), "workflows", "picture", `from_picture_${stage}_flux3.api.json`), "utf8"));
}

function view(file: OutputFile) {
  return `/view?${new URLSearchParams({ filename: file.filename, subfolder: file.subfolder ?? "", type: file.type ?? "output" })}`;
}

async function uploadFile(blob: Blob, extension: string) {
  const form = new FormData();
  form.set("image", blob, `openjutsu_picture_${randomUUID()}${extension}`);
  form.set("type", "input");
  const asset = await (await comfy("/upload/image", { method: "POST", body: form })).json();
  return asset.subfolder ? `${asset.subfolder}/${asset.name}` : asset.name;
}

async function history(id: string) {
  validateJobId(id);
  const data = await (await comfy(`/history/${encodeURIComponent(id)}`)).json();
  const item: History | undefined = data[id];
  if (item) {
    const graph = item.prompt?.[2];
    const prepared = graph?.["21"]?.class_type === "SaveImage" && graph["21"]._meta?.title === PREPARED;
    const rendered = graph?.["63"]?.class_type === "VHS_VideoCombine" && graph["63"]._meta?.title === RENDERED;
    if (!prepared && !rendered) throw new HttpError(404, "This is not an OpenJutsu picture job.");
    if (item.status?.status_str === "error") throw new HttpError(422, "Generation failed. Check the ComfyUI console for missing models or memory errors.");
  }
  return item;
}

function failure(error: unknown) {
  return Response.json({ error: error instanceof HttpError ? error.message : "Could not reach ComfyUI. Start it locally and try again." }, { status: error instanceof HttpError ? error.status : 502 });
}

let uploading = false;

export async function POST(request: Request) {
  const denied = apiAccess(request);
  if (denied) return denied;
  if (uploading) return Response.json({ error: "Another picture request is in progress. Try again shortly." }, { status: 429 });
  uploading = true;
  let upload: Awaited<ReturnType<typeof readFormData>> | undefined;
  try {
    let graph: ApiGraph;
    if (request.headers.get("Content-Type")?.startsWith("application/json")) {
      const body = await request.json().catch(() => { throw new HttpError(400, "Send valid JSON picture settings."); });
      if (!body || typeof body !== "object" || Array.isArray(body) || typeof body.prepared !== "string") throw new HttpError(400, "Prepare a picture first.");
      const item = await history(body.prepared);
      const file = item?.outputs?.["21"]?.images?.[0];
      const source = item?.prompt?.[2];
      if (!file || !source || source["21"]?._meta?.title !== PREPARED || source["1"]?.class_type !== "VHS_LoadVideo") throw new HttpError(409, "The prepared picture is not ready. Generate it first.");
      let settings: PictureVideoSettings;
      try { settings = parsePictureVideoSettings(body.settings ?? { ...DEFAULT_PICTURE_VIDEO, seed: source["19"].inputs.seed }); }
      catch (error) { throw new HttpError(400, (error as Error).message); }
      const available = await listModels();
      if (!available.models.includes(settings.model)) throw new HttpError(400, "Choose a video model ComfyUI has.");
      if (settings.renderer === "solar") {
        const installed = solarLoraFiles(settings.solarRank, available.loras);
        const defaults = solarLoraFiles(settings.solarRank);
        for (const key of ["solarFourStep", "solarControl"] as const) if (settings[key] === defaults[key]) settings[key] = installed[key];
        const nodes = await (await comfy("/object_info/SolarRendererLoraLoader")).json();
        if (!nodes.SolarRendererLoraLoader) throw new HttpError(400, "Install the SolarRenderer custom nodes and restart ComfyUI: https://github.com/Enderfga/SolarRenderer");
      }
      if (pictureLoras(settings).some((name) => !available.loras.includes(name))) throw new HttpError(400, "Choose LoRA files installed in ComfyUI/models/loras (subfolders are supported).");
      const [clipInfo, vaeInfo] = await Promise.all([comfy("/object_info/CLIPLoader").then((response) => response.json()), comfy("/object_info/VAELoader").then((response) => response.json())]);
      for (const [name, choices, label] of [
        [settings.textEncoder, clipInfo.CLIPLoader.input.required.clip_name[0], "H3 text encoder"],
        [settings.videoVae, vaeInfo.VAELoader.input.required.vae_name[0], "video VAE"],
        ...(settings.renderer === "h3" ? [[settings.audioVae, vaeInfo.VAELoader.input.required.vae_name[0], "audio VAE"] as const] : []),
      ] as const) if (!choices.includes(name)) throw new HttpError(400, `Choose a ${label} ComfyUI has.`);
      const picture = await (await comfy(view(file))).blob();
      graph = await template(settings.renderer === "solar" ? "solar" : "motion");
      graph["20"] = { class_type: "LoadImage", inputs: { image: await uploadFile(picture, ".png") } };
      graph["1"].inputs.video = source["1"].inputs.video;
      graph["1"].inputs.skip_first_frames = source["1"].inputs.skip_first_frames;
      applyPictureVideoSettings(graph, settings, Number(source["3"].inputs.width), Number(source["3"].inputs.height));
      graph["63"]._meta = { title: RENDERED };
      const keep = new Set<string>();
      function visit(id: string) {
        if (keep.has(id)) return;
        keep.add(id);
        for (const value of Object.values(graph[id].inputs)) if (isLink(value)) visit(value[0]);
      }
      visit("63");
      graph = Object.fromEntries(Object.entries(graph).filter(([id]) => keep.has(id)));
    } else {
      upload = await readFormData(request, FILE_CHECKS);
      const form = upload.form, video = form.get("video"), picture = form.get("picture");
      if (!(video instanceof StoredFile) || !video.size || !(picture instanceof StoredFile) || !picture.size) throw new HttpError(400, "Choose a video and a character picture.");
      const start = Number(form.get("start") ?? 0), seed = Number(form.get("seed") ?? 0);
      const width = Number(form.get("width")), height = Number(form.get("height"));
      if (!Number.isFinite(start) || start < 0 || !Number.isInteger(seed) || seed < 0 || seed > MAX_SEED) throw new HttpError(400, "Use a start time of 0 or later and a valid whole-number seed.");
      if (![width, height].every((side) => Number.isFinite(side) && side > 0)) throw new HttpError(400, "Wait for the video's dimensions to load.");
      const extension = video.name.match(/\.(mp4|mov|mkv|webm|avi)$/i)?.[0];
      const pictureExtension = picture.name.match(/\.(png|jpe?g|webp)$/i)?.[0];
      if (!extension || !pictureExtension) throw new HttpError(400, "Choose a supported video and PNG, JPEG or WebP picture.");
      graph = await template("prepare");
      const prompt = form.get("prompt");
      if (typeof prompt === "string" && prompt.trim()) graph["6"].inputs.value = prompt;
      const [editWidth, editHeight] = canvasSize(width, height, "768p");
      for (const id of ["3", "5"]) Object.assign(graph[id].inputs, { width: editWidth, height: editHeight });
      graph["1"].inputs.video = await uploadFile(await openAsBlob(video.path), extension.toLowerCase());
      graph["1"].inputs.skip_first_frames = Math.round(start * 24);
      graph["4"].inputs.image = await uploadFile(await openAsBlob(picture.path), pictureExtension.toLowerCase());
      graph["19"].inputs.seed = seed;
      graph["21"]._meta = { title: PREPARED };
    }
    const result = await (await comfy("/prompt", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt: graph }) })).json();
    return Response.json({ id: result.prompt_id }, { status: 202 });
  } catch (error) {
    return failure(error);
  } finally {
    await upload?.dispose();
    uploading = false;
  }
}

export async function GET(request: Request) {
  const denied = apiAccess(request);
  if (denied) return denied;
  try {
    const url = new URL(request.url), id = url.searchParams.get("id") ?? "";
    const item = await history(id);
    if (!item) {
      const queue = await (await comfy("/queue")).json();
      const waiting = [...queue.queue_running, ...queue.queue_pending].some((entry: unknown[]) => entry[1] === id);
      if (!waiting) throw new HttpError(404, "This job was removed or ComfyUI restarted. Generate the picture again.");
      return Response.json({ status: "processing" });
    }
    const isVideo = item.prompt?.[2]?.["63"]?._meta?.title === RENDERED;
    const media = url.searchParams.get("media");
    const output = item.outputs?.[isVideo ? "63" : media === "frame" ? "22" : "21"];
    const file = isVideo ? output?.gifs?.[0] : output?.images?.[0];
    if (!file) throw new HttpError(422, "ComfyUI returned no result. Check its console.");
    const base = `/api/picture?id=${encodeURIComponent(id)}`;
    if (!media) return Response.json({ status: "ready", url: `${base}&media=result`, ...(!isVideo ? { frame: `${base}&media=frame`, width: item.prompt![2]["3"].inputs.width, height: item.prompt![2]["3"].inputs.height } : {}) });
    const response = await comfy(view(file), { headers: request.headers.has("Range") ? { Range: request.headers.get("Range")! } : {} }, true);
    if (response.status === 416) {
      await response.body?.cancel();
      const headers = new Headers({ "Cache-Control": "private, no-store" });
      const range = response.headers.get("Content-Range");
      if (range) headers.set("Content-Range", range);
      return new Response(null, { status: 416, headers });
    }
    return new Response(response.body, { status: response.status, headers: {
      "Content-Type": isVideo ? "video/mp4" : "image/png", "X-Content-Type-Options": "nosniff", "Cache-Control": "private, no-store",
      ...Object.fromEntries(["Content-Length", "Content-Range", "Accept-Ranges"].flatMap((key) => response.headers.has(key) ? [[key, response.headers.get(key)!]] : [])),
    } });
  } catch (error) { return failure(error); }
}
