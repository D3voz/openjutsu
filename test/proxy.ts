import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

// Just enough of comfy-api-proxy 0.1.6 for the upload, job, output and delete paths. Like the proxy, identical bytes
// map to one asset id, and uploads are counted rather than kept.
type FakeAsset = { id: string; hash: string; size: number; contentType: string; filePath: string; jobId?: string; body?: string };
type FakeJob = { workflow: unknown; id: string; status: string; inputs: string[]; outputs: FakeAsset[] };

export async function fakeProxy() {
  const assets = new Map<string, FakeAsset>();
  const jobs = new Map<string, FakeJob>();
  const deleted: string[] = [];
  const uploads: FakeAsset[] = [];
  const models = {
    UNETLoader: ["base.safetensors"], LoraLoaderModelOnly: ["style.safetensors", "minimax_h3_DMAD.safetensors"],
    CLIPLoader: ["encoder.safetensors"], VAELoader: ["video.safetensors", "audio.safetensors"],
  };
  const state = { rejectJobs: false };
  let base = "";

  const json = (response: ServerResponse, status: number, body: unknown) => {
    response.writeHead(status, { "Content-Type": "application/json" }).end(JSON.stringify(body));
  };
  const missing = (response: ServerResponse) => json(response, 404, { error: { code: "not_found", message: "Not found." } });
  const assetJson = (asset: FakeAsset, createdNew?: boolean) => ({
    id: asset.id, hash: asset.hash, size_bytes: asset.size, content_type: asset.contentType, file_path: asset.filePath,
    created_at: new Date().toISOString(), url: `${base}/api/v2/assets/${asset.id}/content`, url_expires_at: new Date(Date.now() + 3600_000).toISOString(),
    ...(createdNew === undefined ? {} : { created_new: createdNew }), ...(asset.jobId ? { job_id: asset.jobId } : {}),
  });
  const jobJson = (job: FakeJob) => ({
    id: job.id, status: job.status, created_at: new Date().toISOString(), started_at: null, completed_at: null,
    expires_at: new Date(Date.now() + 86400_000).toISOString(), queue_position: job.status === "queued" ? 0 : null, progress: null, error: null,
    outputs: job.outputs.map((output) => ({ ...assetJson(output), node_id: "1", name: output.filePath, type: "video" })),
    urls: { self: `${base}/api/v2/jobs/${job.id}`, events: `${base}/api/v2/jobs/${job.id}/events`, cancel: `${base}/api/v2/jobs/${job.id}/cancel` },
  });
  const text = async (request: IncomingMessage) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    return body;
  };
  // The SDK sends content_type, file_path and expected_hash before the file, so only the first bytes are decoded.
  const upload = async (request: IncomingMessage) => {
    let head = "";
    let size = 0;
    for await (const chunk of request as AsyncIterable<Buffer>) {
      if (head.length < 4096) head += chunk.toString("latin1", 0, 4096);
      size += chunk.length;
    }
    const field = (name: string) => head.match(new RegExp(`name="${name}"\\r\\n\\r\\n([^\\r]*)`))?.[1] ?? "";
    const boundary = String(request.headers["content-type"]).match(/boundary=(.+)$/)![1];
    const start = head.indexOf("\r\n\r\n", head.indexOf('name="file"')) + 4;
    return { hash: field("expected_hash"), contentType: field("content_type"), filePath: field("file_path"), size: size - start - `\r\n--${boundary}--\r\n`.length };
  };

  const server = createServer(async (request, response) => {
    const url = new URL(request.url!, base);
    const path = url.pathname;
    let match: RegExpMatchArray | null;
    if ((match = path.match(/^\/object_info\/(\w+)$/))) {
      const node = match[1] as keyof typeof models;
      const input = { UNETLoader: "unet_name", LoraLoaderModelOnly: "lora_name", CLIPLoader: "clip_name", VAELoader: "vae_name" }[node];
      return models[node] ? json(response, 200, { [node]: { input: { required: { [input]: [models[node]] } } } }) : missing(response);
    }
    if (request.method === "HEAD" && (match = path.match(/^\/api\/v2\/assets\/by-hash\/(.+)$/))) {
      const known = [...assets.values()].some((asset) => asset.hash === decodeURIComponent(match![1]));
      return response.writeHead(known ? 200 : 404).end();
    }
    if (request.method === "POST" && path === "/api/v2/assets/from-hash") {
      const { hash } = JSON.parse(await text(request));
      const asset = [...assets.values()].find((candidate) => candidate.hash === hash);
      return asset ? json(response, 200, assetJson(asset, false)) : missing(response);
    }
    if (request.method === "POST" && path === "/api/v2/assets") {
      const asset = { id: randomUUID(), ...(await upload(request)) };
      assets.set(asset.id, asset);
      uploads.push(asset);
      return json(response, 201, assetJson(asset, true));
    }
    if ((match = path.match(/^\/api\/v2\/assets\/([^/]+)(\/content)?$/))) {
      const asset = assets.get(decodeURIComponent(match[1]));
      if (!asset) return missing(response);
      if (request.method === "DELETE") {
        assets.delete(asset.id);
        deleted.push(asset.id);
        return response.writeHead(204).end();
      }
      if (!match[2]) return json(response, 200, assetJson(asset));
      return response.writeHead(200, { "Content-Type": asset.contentType }).end(asset.body ?? "");
    }
    if (request.method === "POST" && path === "/api/v2/jobs") {
      const { workflow } = JSON.parse(await text(request));
      const refs = [...JSON.stringify(workflow).matchAll(/"__type":"core\/ASSET","info":\{"id":"([^"]+)"/g)].map((ref) => ref[1]);
      if (state.rejectJobs) return json(response, 422, { error: { code: "invalid_workflow", message: "Workflow rejected." } });
      if (refs.some((id) => !assets.has(id))) return json(response, 422, { error: { code: "missing_asset", message: "Unresolvable core/ASSET reference(s)." } });
      const job = { workflow, id: randomUUID(), status: "queued", inputs: refs, outputs: [] };
      jobs.set(job.id, job);
      return json(response, 201, jobJson(job));
    }
    if (request.method === "GET" && (match = path.match(/^\/api\/v2\/jobs\/([^/]+)$/))) {
      const job = jobs.get(match[1]);
      return job ? json(response, 200, jobJson(job)) : missing(response);
    }
    missing(response);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  return {
    url: base, assets, jobs, uploads, deleted, models, state,
    // A job's own result or preview, or a file the proxy holds for no job.
    output(jobId: string | undefined, contentType: string, body = "") {
      const asset = { id: randomUUID(), hash: "", size: body.length, contentType, filePath: `out-${assets.size}`, jobId, body };
      assets.set(asset.id, asset);
      return asset;
    },
    finish(jobId: string, status = "succeeded", outputs: FakeAsset[] = []) {
      Object.assign(jobs.get(jobId)!, { status, outputs });
    },
    close: () => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }),
  };
}

if (import.meta.main) {
  const proxy = await fakeProxy();
  console.log(proxy.url);
}
