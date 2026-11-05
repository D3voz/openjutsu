import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { downloadStatus, startDownload } from "../lib/download.ts";

const NAME = "qwen3vl_4b_fp8_scaled.safetensors";

test("download rejects unknown models and a missing COMFYUI_DIR", async () => {
  delete process.env.COMFYUI_DIR;
  await assert.rejects(startDownload("evil.safetensors"), { status: 400 });
  await assert.rejects(startDownload(NAME), { status: 409 });
});

test("download saves a suggested model into models/text_encoders", async () => {
  const root = await mkdtemp(join(tmpdir(), "openjutsu-"));
  process.env.COMFYUI_DIR = root;
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response("weights", { headers: { "content-length": "7" } })) as typeof fetch;
  try {
    await startDownload(NAME);
    for (let i = 0; i < 100 && downloadStatus().state === "downloading"; i++) await new Promise((r) => setTimeout(r, 20));
    assert.equal(downloadStatus().state, "done");
    assert.equal(await readFile(join(root, "models", "text_encoders", NAME), "utf8"), "weights");
  } finally {
    globalThis.fetch = realFetch;
  }
});
