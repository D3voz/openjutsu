import { createWriteStream } from "node:fs";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { downloadUrl, SUGGESTIONS } from "./describers.ts";
import { HttpError } from "./http.ts";

export type DownloadStatus = { name: string; state: "idle" | "downloading" | "done" | "error"; received: number; total: number; error?: string };

// One download at a time, kept on globalThis so every route handler sees it.
const current = ((globalThis as { [key: symbol]: unknown })[Symbol.for("openjutsu.download")] ??=
  { status: { name: "", state: "idle", received: 0, total: 0 } as DownloadStatus }) as { status: DownloadStatus };

export const downloadStatus = () => current.status;

export async function startDownload(name: string) {
  const model = SUGGESTIONS.find((item) => item.name === name);
  if (!model) throw new HttpError(400, "Unknown model.");
  const root = process.env.COMFYUI_DIR?.trim();
  if (!root) throw new HttpError(409, "Set COMFYUI_DIR in .env.local to your ComfyUI folder and restart Openjutsu, or use Browser download.");
  if (current.status.state === "downloading") throw new HttpError(409, "A model is already downloading.");

  const dir = join(root, "models", "text_encoders");
  const file = join(dir, name);
  const exists = await stat(file).then(() => true, () => false);
  current.status = { name, state: exists ? "done" : "downloading", received: 0, total: 0 };
  if (exists) return;

  void (async () => {
    const part = `${file}.part`;
    try {
      await mkdir(dir, { recursive: true });
      const response = await fetch(downloadUrl(model.url), { redirect: "follow" });
      if (!response.ok || !response.body) throw new Error(`Hugging Face answered ${response.status}.`);
      current.status.total = Number(response.headers.get("content-length")) || 0;
      const body = Readable.fromWeb(response.body as import("node:stream/web").ReadableStream);
      body.on("data", (chunk: Buffer) => { current.status.received += chunk.length; });
      await pipeline(body, createWriteStream(part));
      await rename(part, file);
      current.status.state = "done";
    } catch (error) {
      await rm(part, { force: true });
      current.status = { ...current.status, state: "error", error: error instanceof Error ? error.message : "Download failed." };
    }
  })();
}
