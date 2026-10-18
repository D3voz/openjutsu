import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Comfy, resolveBaseUrl, resolveCredentials, type Job } from "@comfyorg/sdk";
import { ComfyLow } from "@comfyorg/sdk/low";
import { MASK_NODES, NODES, pruneMask, pruneSimple, type ApiGraph, type Margin, type SimpleSettings } from "./simple.ts";
import { VIDEO, nodeByTitle, pruneAdvanced, type AdvancedSettings } from "./advanced.ts";

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

// job.events() drops progress frames whose value is lower than the last one, but the proxy
// reports each node's own step fraction, so the next node's progress would be hidden. The raw
// stream has every frame; the browser's EventSource reconnects when it ends.
export function rawJobEvents(job: Job, signal: AbortSignal) {
  return new ComfyLow(resolveBaseUrl(), resolveCredentials(), { clientInfo: "openjutsu" }).getJobEvents(job.urls.events || job.id, { signal });
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

export async function submitSimple(video: File, picture: File, settings: SimpleSettings) {
  const comfy = client();
  const workflow = comfy.workflows.fromJson(pruneSimple(await loadGraph("simple"), settings));
  workflow.setInput(NODES.video, "video", await upload(comfy, video));
  workflow.setInput(NODES.picture, "image", await upload(comfy, picture));
  return publicJob(await comfy.submit(workflow));
}

export async function submitAdvanced(video: File, pictures: File[], settings: AdvancedSettings, maxQuality: boolean) {
  const comfy = client();
  const graph = pruneAdvanced(await loadGraph(maxQuality ? "advanced_maxq" : "advanced"), pictures.length, settings);
  const workflow = comfy.workflows.fromJson(graph);
  workflow.setInput(nodeByTitle(graph, VIDEO), "video", await upload(comfy, video));
  for (const [i, picture] of pictures.entries()) workflow.setInput(nodeByTitle(graph, `Picture ${i + 1}`), "image", await upload(comfy, picture));
  return publicJob(await comfy.submit(workflow));
}

export async function submitMask(video: File, hatFix: boolean, margin: Margin) {
  const comfy = client();
  const workflow = comfy.workflows.fromJson(pruneMask(await loadGraph("mask"), hatFix, margin));
  workflow.setInput(MASK_NODES.video, "video", await upload(comfy, video));
  return publicJob(await comfy.submit(workflow));
}

export function getJob(id: string) {
  return client().jobs.get(id);
}

export async function getOutput(jobId: string, outputId: string, range: string | null) {
  const job = await getJob(jobId);
  const output = job.outputs.find((candidate) => candidate.id === outputId);
  if (!output) throw new Error("Output not found on this job.");
  const { url } = await output.getDownloadUrl();
  return { name: output.name, response: await fetch(url, { headers: range ? { Range: range } : {} }) };
}
