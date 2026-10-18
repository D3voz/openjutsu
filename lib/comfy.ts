import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Comfy, COMFY_CLOUD_BASE_URL, resolveCredentials, type Job } from "@comfyorg/sdk";
import { ComfyLow } from "@comfyorg/sdk/low";
import { MASK_NODES, NODES, pruneMask, pruneSimple, type ApiGraph, type Margin, type SimpleSettings } from "./simple.ts";
import { VIDEO, nodeByTitle, pruneAdvanced, type AdvancedSettings } from "./advanced.ts";
import { applyModel, type ModelSettings } from "./model.ts";

export type PublicJob = {
  id: string;
  status: string;
  queuePosition: number | null;
  error: string | null;
  video: { id: string; name: string; url: string } | null;
};

export const TERMINAL = new Set(["succeeded", "failed", "canceled", "expired"]);

// COMFY_BASE_URL and the optional COMFY_API_KEY come from .env.local; the SDK reads both.
export function client() {
  return new Comfy({ clientInfo: "openjutsu" });
}

// The same deployment as client(); the SDK's resolveBaseUrl() is the Comfy Router's, not COMFY_BASE_URL.
function low() {
  return new ComfyLow(process.env.COMFY_BASE_URL?.trim().replace(/\/+$/, "") || COMFY_CLOUD_BASE_URL, resolveCredentials(), { clientInfo: "openjutsu" });
}

// job.events() drops progress frames whose value is lower than the last one, but the proxy
// reports each node's own step fraction, so the next node's progress would be hidden. The raw
// stream has every frame; the browser's EventSource reconnects when it ends.
export function rawJobEvents(job: Job, signal: AbortSignal) {
  return low().getJobEvents(job.urls.events || job.id, { signal });
}

export const JOB_KINDS = ["simple", "mask", "advanced", "advanced_maxq"] as const;
export type JobKind = (typeof JOB_KINDS)[number];

export async function loadGraph(kind: JobKind): Promise<ApiGraph> {
  return JSON.parse(await readFile(join(process.cwd(), "workflows", `${kind}.api.json`), "utf8"));
}

function jobErrorMessage(error: unknown) {
  const message = error && typeof error === "object" && typeof Reflect.get(error, "message") === "string"
    ? (Reflect.get(error, "message") as string)
    : typeof error === "string" ? error : "";
  const missingNode = message.match(/Node ['"]([^'"]+)['"] not found/i)?.[1];
  if (missingNode) return `ComfyUI is missing the "${missingNode}" node. Install the custom nodes listed in the README and restart ComfyUI.`;
  return message || "ComfyUI could not run this workflow. Check the ComfyUI console.";
}

export function publicJob(job: Job): PublicJob {
  const video = job.outputs.find((output) => output.contentType.startsWith("video/"));
  return {
    id: job.id,
    status: job.status,
    queuePosition: job.queuePosition,
    error: job.error ? jobErrorMessage(job.error) : null,
    video: video ? { id: video.id, name: video.name, url: `/api/jobs/${job.id}/outputs/${video.id}` } : null,
  };
}

function upload(comfy: Comfy, file: File) {
  return file.arrayBuffer().then((bytes) =>
    comfy.assets.fromBytes(new Uint8Array(bytes), {
      filename: file.name.replace(/[^\w.\- ]+/g, "_").slice(-100) || "upload",
      contentType: file.type || "application/octet-stream",
    }),
  );
}

export async function submitSimple(video: File, picture: File, settings: SimpleSettings, model: ModelSettings) {
  const comfy = client();
  const graph = pruneSimple(await loadGraph("simple"), settings);
  applyModel(graph, model);
  const workflow = comfy.workflows.fromJson(graph);
  workflow.setInput(NODES.video, "video", await upload(comfy, video));
  workflow.setInput(NODES.picture, "image", await upload(comfy, picture));
  return publicJob(await comfy.submit(workflow));
}

export async function submitAdvanced(video: File, pictures: File[], settings: AdvancedSettings, maxQuality: boolean, model: ModelSettings) {
  const comfy = client();
  const graph = pruneAdvanced(await loadGraph(maxQuality ? "advanced_maxq" : "advanced"), pictures.length, settings);
  applyModel(graph, model);
  const workflow = comfy.workflows.fromJson(graph);
  workflow.setInput(nodeByTitle(graph, VIDEO), "video", await upload(comfy, video));
  for (const [i, picture] of pictures.entries()) workflow.setInput(nodeByTitle(graph, `Picture ${i + 1}`), "image", await upload(comfy, picture));
  return publicJob(await comfy.submit(workflow));
}

export async function submitMask(video: File, hatFix: boolean, margin: Margin, target: string) {
  const comfy = client();
  const workflow = comfy.workflows.fromJson(pruneMask(await loadGraph("mask"), hatFix, margin, target));
  workflow.setInput(MASK_NODES.video, "video", await upload(comfy, video));
  return publicJob(await comfy.submit(workflow));
}

// The proxy has no model listing, so the pickers read ComfyUI's own node info. COMFYUI_URL points at ComfyUI itself
// (not the proxy); without it, or when it does not answer, the page falls back to typed file names.
export async function listModels(): Promise<{ models: string[]; loras: string[] } | null> {
  const base = process.env.COMFYUI_URL || "http://127.0.0.1:8188";
  const options = async (node: string, input: string) => {
    const info = await (await fetch(`${base}/object_info/${node}`, { signal: AbortSignal.timeout(5000) })).json();
    return info[node].input.required[input][0] as string[];
  };
  try {
    const [models, loras] = await Promise.all([options("UNETLoader", "unet_name"), options("LoraLoaderModelOnly", "lora_name")]);
    return { models, loras };
  } catch {
    return null;
  }
}

export function getJob(id: string) {
  return client().jobs.get(id);
}

export async function getOutput(jobId: string, outputId: string, range: string | null) {
  const job = await getJob(jobId);
  const output = job.outputs.find((candidate) => candidate.id === outputId);
  // A running job lists no outputs yet; its mask previews arrive as live output events, fetched by asset id.
  const { url } = output ? await output.getDownloadUrl() : await low().getAssetContentUrl(outputId);
  return { name: output?.name ?? outputId, response: await fetch(url, { headers: range ? { Range: range } : {} }) };
}
