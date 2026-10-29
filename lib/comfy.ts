import { HttpError, validateJobId, type StoredFile } from "./http.ts";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { Asset, Comfy, COMFY_CLOUD_BASE_URL, NotFound, resolveCredentials, type Job, type Workflow } from "@comfyorg/sdk";
import { ComfyLow } from "@comfyorg/sdk/low";
import { MASK_NODES, NODES, cropSource, isLink, pruneMask, pruneSimple, setSection, type ApiGraph, type Margin, type Resolution, type Section, type SimpleSettings } from "./simple.ts";
import { VIDEO, nodeByTitle, pruneAdvanced, type AdvancedSettings } from "./advanced.ts";
import { applyDescriber, applyModel, type ModelFiles, type ModelSettings } from "./model.ts";
import { OBJECT_PICTURE, OBJECT_VIDEO, pruneFit, pruneObject, type ObjectSettings, type PlacementKeyframe } from "./object.ts";
import { FACE_PICTURE, FACE_VIDEO, pruneFace, type FaceSettings } from "./face.ts";
import { COLOR_VIDEO, pruneColor, type ColorSettings } from "./color.ts";
import { PEOPLE_NODES, peopleRoles, pruneMontage, type Review } from "./montage.ts";

export type PublicJob = {
  id: string;
  status: string;
  queuePosition: number | null;
  error: string | null;
  video: { id: string; name: string; url: string } | null;
  data: string | null; // JSON: what Find people found, or who a montage kept as they are
};

export const TERMINAL = new Set(["succeeded", "failed", "canceled", "expired"]);

// undici clones any request it may redirect, teeing the body into a copy nobody reads, so a whole upload would wait in
// memory. Uploads are never redirected.
const fetchUploads: typeof fetch = (input, init) => fetch(input, init?.body instanceof FormData ? { ...init, redirect: "error" } : init);

// SDK handle lookups do not expose a signal argument. Bind read cancellation to
// their transport while retaining the SDK's own per-request deadline.
function fetchWithSignal(signal?: AbortSignal): typeof fetch {
  if (!signal) return fetchUploads;
  return (input, init) => fetchUploads(input, { ...init, signal: init?.signal ? AbortSignal.any([init.signal, signal]) : signal });
}

// COMFY_BASE_URL and the optional COMFY_API_KEY come from .env.local; the SDK reads both.
export function client(signal?: AbortSignal) {
  return new Comfy({ clientInfo: "openjutsu", fetch: fetchWithSignal(signal) });
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

export const JOB_KINDS = ["simple", "mask", "advanced", "advanced_maxq", "object", "fit", "face", "color", "people", "montage"] as const;
export type JobKind = (typeof JOB_KINDS)[number];

export async function loadGraph(kind: JobKind): Promise<ApiGraph> {
  const graph: ApiGraph = JSON.parse(await readFile(join(process.cwd(), "workflows", `${kind}.api.json`), "utf8"));
  silenceWhenSoundless(graph);
  return graph;
}

// VHS fails as soon as anything reads the soundtrack of a video that has none, so every reader gets silence instead.
function silenceWhenSoundless(graph: ApiGraph) {
  for (const id of Object.keys(graph).filter((id) => graph[id].class_type === "VHS_LoadVideo")) {
    const soundtrack = `${id}_soundtrack`;
    let read = false;
    for (const node of Object.values(graph)) {
      for (const [name, value] of Object.entries(node.inputs)) {
        if (isLink(value) && value[0] === id && value[1] === 2) {
          node.inputs[name] = [soundtrack, 0];
          read = true;
        }
      }
    }
    if (read) graph[soundtrack] = { class_type: "H3SoundtrackOrSilence", inputs: { audio: [id, 2], video_info: [id, 3] }, _meta: { title: "Soundtrack (silence if none)" } };
  }
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
  const data = job.outputs.find((output) => output.contentType === "application/json");
  return {
    id: job.id,
    status: job.status,
    queuePosition: job.queuePosition,
    error: job.error ? jobErrorMessage(job.error) : null,
    video: video ? { id: video.id, name: video.name, url: `/api/jobs/${job.id}/outputs/${video.id}` } : null,
    data: data ? `/api/jobs/${job.id}/outputs/${data.id}` : null,
  };
}

// The SDK streams the temp file from disk and names the upload after it.
function upload(comfy: Comfy, file: StoredFile) {
  return comfy.assets.fromFile(file.path);
}

// Inputs this server uploaded, with the jobs still using each. The proxy hands identical bytes the same asset id,
// so an input is deleted only once no job here uses it, and only if this server uploaded it rather than reused it.
const inputs = ((globalThis as { [key: symbol]: unknown })[Symbol.for("openjutsu.inputs")] ??= new Map()) as Map<string, { jobs: number; owned: boolean }>;

function hold(asset: Asset) {
  const entry = inputs.get(asset.id!) ?? { jobs: 0, owned: false };
  inputs.set(asset.id!, { jobs: entry.jobs + 1, owned: entry.owned || asset.createdNew === true });
}

async function release(comfy: Comfy, ids: string[]) {
  for (const id of ids) {
    const entry = inputs.get(id);
    if (!entry) continue;
    if (entry.jobs > 1) {
      inputs.set(id, { ...entry, jobs: entry.jobs - 1 });
      continue;
    }
    inputs.delete(id);
    if (entry.owned) await comfy.assets.delete(id).catch(() => {});
  }
}

// Retry and every other run upload their inputs again from the page, so nothing reuses them after a terminal status.
async function releaseWhenDone(comfy: Comfy, job: Job, ids: string[]) {
  for (;;) {
    try {
      await job.wait();
      break;
    } catch (error) {
      // The proxy forgets jobs when it restarts.
      if (error instanceof NotFound) break;
      await sleep(30_000);
    }
  }
  await release(comfy, ids);
}

async function submit(comfy: Comfy, workflow: Workflow) {
  const assets = Object.values(workflow.json).flatMap((node) => Object.values((node as { inputs?: object }).inputs ?? {})).filter((value) => value instanceof Asset);
  const ids: string[] = [];
  try {
    for (const asset of assets) {
      ids.push(await asset.commit());
      hold(asset);
    }
    const job = await comfy.submit(workflow);
    void releaseWhenDone(comfy, job, ids);
    return publicJob(job);
  } catch (error) {
    await release(comfy, ids);
    throw error;
  }
}

export async function submitSimple(video: StoredFile, section: Section, picture: StoredFile, settings: SimpleSettings, model: ModelSettings) {
  const comfy = client();
  const graph = pruneSimple(await loadGraph("simple"), settings);
  applyModel(graph, model);
  setSection(graph, NODES.video, section);
  const workflow = comfy.workflows.fromJson(graph);
  workflow.setInput(NODES.video, "video", upload(comfy, video));
  workflow.setInput(NODES.picture, "image", upload(comfy, picture));
  return submit(comfy, workflow);
}

export async function submitAdvanced(video: StoredFile, section: Section, pictures: StoredFile[], settings: AdvancedSettings, maxQuality: boolean, model: ModelSettings) {
  const comfy = client();
  const graph = pruneAdvanced(await loadGraph(maxQuality ? "advanced_maxq" : "advanced"), pictures.length, settings);
  applyModel(graph, model);
  setSection(graph, nodeByTitle(graph, VIDEO), section);
  const workflow = comfy.workflows.fromJson(graph);
  workflow.setInput(nodeByTitle(graph, VIDEO), "video", upload(comfy, video));
  for (const [i, picture] of pictures.entries()) workflow.setInput(nodeByTitle(graph, `Picture ${i + 1}`), "image", upload(comfy, picture));
  return submit(comfy, workflow);
}

export async function submitObject(video: StoredFile, section: Section, picture: StoredFile | null, settings: ObjectSettings, model: ModelSettings) {
  const comfy = client();
  const graph = pruneObject(await loadGraph("object"), !!picture, settings);
  applyModel(graph, model);
  setSection(graph, nodeByTitle(graph, OBJECT_VIDEO), section);
  const workflow = comfy.workflows.fromJson(graph);
  workflow.setInput(nodeByTitle(graph, OBJECT_VIDEO), "video", upload(comfy, video));
  if (picture && settings.mode !== "remove") workflow.setInput(nodeByTitle(graph, OBJECT_PICTURE), "image", upload(comfy, picture));
  return submit(comfy, workflow);
}

export async function submitFit(video: StoredFile, section: Section, placement: PlacementKeyframe[], resolution: Resolution, action = "") {
  const comfy = client();
  const graph = pruneFit(await loadGraph("fit"), placement, action);
  if (typeof resolution === "object") cropSource(graph, nodeByTitle(graph, OBJECT_VIDEO), resolution);
  setSection(graph, nodeByTitle(graph, OBJECT_VIDEO), section);
  const workflow = comfy.workflows.fromJson(graph);
  workflow.setInput(nodeByTitle(graph, OBJECT_VIDEO), "video", upload(comfy, video));
  return submit(comfy, workflow);
}

export async function submitFace(video: StoredFile, section: Section, picture: StoredFile, settings: FaceSettings, model: ModelSettings) {
  const comfy = client();
  const graph = pruneFace(await loadGraph("face"), settings);
  applyModel(graph, model);
  setSection(graph, nodeByTitle(graph, FACE_VIDEO), section);
  const workflow = comfy.workflows.fromJson(graph);
  workflow.setInput(nodeByTitle(graph, FACE_VIDEO), "video", upload(comfy, video));
  workflow.setInput(nodeByTitle(graph, FACE_PICTURE), "image", upload(comfy, picture));
  return submit(comfy, workflow);
}

export async function submitColor(video: StoredFile, section: Section, settings: ColorSettings) {
  const comfy = client();
  const graph = pruneColor(await loadGraph("color"), settings);
  setSection(graph, nodeByTitle(graph, COLOR_VIDEO), section);
  const workflow = comfy.workflows.fromJson(graph);
  workflow.setInput(nodeByTitle(graph, COLOR_VIDEO), "video", upload(comfy, video));
  return submit(comfy, workflow);
}

export async function submitMask(video: StoredFile, section: Section, hatFix: boolean, margin: Margin, target: string) {
  const comfy = client();
  const graph = pruneMask(await loadGraph("mask"), hatFix, margin, target);
  setSection(graph, MASK_NODES.video, section);
  const workflow = comfy.workflows.fromJson(graph);
  workflow.setInput(MASK_NODES.video, "video", upload(comfy, video));
  return submit(comfy, workflow);
}

export async function submitMontage(video: StoredFile, section: Section, pictures: StoredFile[], settings: AdvancedSettings, review: Review | null, model: ModelSettings) {
  const comfy = client();
  const graph = pruneMontage(await loadGraph("montage"), pictures.length, settings, review);
  applyModel(graph, model);
  setSection(graph, nodeByTitle(graph, VIDEO), section);
  const workflow = comfy.workflows.fromJson(graph);
  workflow.setInput(nodeByTitle(graph, VIDEO), "video", upload(comfy, video));
  for (const [i, picture] of pictures.entries()) workflow.setInput(nodeByTitle(graph, `Picture ${i + 1}`), "image", upload(comfy, picture));
  return submit(comfy, workflow);
}

export async function submitPeople(video: StoredFile, section: Section, roles: string[], resolution: Resolution, describer?: string) {
  const comfy = client();
  const graph = await loadGraph("people");
  applyDescriber(graph, describer);
  graph[PEOPLE_NODES.crops].inputs.people = peopleRoles(roles);
  if (typeof resolution === "object") cropSource(graph, PEOPLE_NODES.video, resolution);
  setSection(graph, PEOPLE_NODES.video, section);
  const workflow = comfy.workflows.fromJson(graph);
  workflow.setInput(PEOPLE_NODES.video, "video", upload(comfy, video));
  return submit(comfy, workflow);
}

// COMFYUI_URL points at ComfyUI itself, not the proxy: the proxy lists no nodes, models or presets.
export async function comfyUi(path: string, timeout: number) {
  const url = (process.env.COMFYUI_URL?.trim() || "http://127.0.0.1:8188").replace(/\/+$/, "");
  const response = await fetch(`${url}${path}`, { cache: "no-store", signal: AbortSignal.timeout(timeout) });
  if (!response.ok) throw new Error(`ComfyUI answered ${path} with HTTP ${response.status}.`);
  return response.json();
}

export const MODELS_UNAVAILABLE = "Could not read the model lists from ComfyUI. Make sure it is running and COMFYUI_URL points to it, then try again.";

// The pickers read ComfyUI's own node info; when that fails, the page falls back to typed file names.
export async function listModels(): Promise<ModelFiles> {
  const options = async (node: string, input: string) => {
    const names = (await comfyUi(`/object_info/${node}`, 5000))?.[node]?.input?.required?.[input]?.[0];
    if (!Array.isArray(names) || names.some((name) => typeof name !== "string")) throw new Error(`ComfyUI sent no ${input} list.`);
    return names as string[];
  };
  try {
    const [models, loras, textEncoders, vaes] = await Promise.all([
      options("UNETLoader", "unet_name"), options("LoraLoaderModelOnly", "lora_name"),
      options("CLIPLoader", "clip_name"), options("VAELoader", "vae_name"),
    ]);
    return { models, loras, textEncoders, vaes };
  } catch (error) {
    console.warn(`${MODELS_UNAVAILABLE} ${error instanceof Error ? error.message : ""}`.trim());
    throw new HttpError(502, MODELS_UNAVAILABLE);
  }
}

// Orion4D's saved DCTL Tone Mapper presets, read from ComfyUI like the model lists; empty when it does not answer.
export async function listTonePresets(): Promise<{ name: string; settings: Record<string, unknown> }[]> {
  const get = (path: string) => comfyUi(`/orion4d_fxmax/${path}`, 5000);
  try {
    const { presets } = await get("presets/color_fx_dctl_tone_mapper");
    return await Promise.all((presets as string[]).map(async (name) => ({ name, settings: (await get(`preset/color_fx_dctl_tone_mapper/${encodeURIComponent(name)}`)).settings })));
  } catch {
    return [];
  }
}

export function getJob(id: string, signal?: AbortSignal) {
  validateJobId(id);
  return client(signal).jobs.get(id);
}

export async function getOutput(jobId: string, outputId: string, range: string | null, signal?: AbortSignal) {
  const job = await getJob(jobId, signal);
  const output = job.outputs.find((candidate) => candidate.id === outputId);
  // A running job lists no outputs yet; its mask previews arrive as live output events, so any other id must name an
  // asset this job produced. Uploaded inputs have no producing job.
  const asset = output ? null : await low().getAsset(outputId, { signal }).catch(() => null);
  if (!output && (!asset || asset.job_id !== job.id)) throw new HttpError(404, "This job has no such output.");
  const { url } = output ? await output.getDownloadUrl() : await low().getAssetContentUrl(outputId, { signal });
  return { name: output?.name ?? asset?.file_path ?? outputId, response: await fetch(url, { headers: range ? { Range: range } : {}, signal }) };
}
