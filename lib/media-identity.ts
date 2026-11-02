import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { suffixRunName, type ApiGraph } from "./simple.ts";

type MediaFile = { path: string };

async function fileDigest(file: MediaFile) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file.path, { highWaterMark: 64 * 1024 })) hash.update(chunk);
  return hash.digest("hex");
}

// Native run_hash samples video frames and averages RGB; it also omits audio.
// Bind complete file contents before any upload, without retaining them in RAM.
export async function bindMediaIdentity(graph: ApiGraph, video: MediaFile, pictures: readonly MediaFile[]) {
  const plans = Object.values(graph).filter((node) => node.class_type === "MiniMaxH3ChainPlanModern");
  if (plans.length !== 1) throw new Error(`Expected one Production Plan node in the workflow, found ${plans.length}.`);
  const hashes = [];
  for (const file of [video, ...pictures]) hashes.push(await fileDigest(file));
  // Different windows of one file may have identical sampled pictures but
  // different audio. Preserve the selected source interval in the identity too.
  const windows = Object.values(graph).filter((node) => node.class_type === "VHS_LoadVideo")
    .map((node) => [node.inputs.skip_first_frames ?? 0, node.inputs.frame_load_cap ?? 0]);
  const identity = createHash("sha256").update(JSON.stringify(["openjutsu-media-v1", hashes, windows])).digest("hex");

  // Keep the composed run name within native's 96-character limit. The full
  // digest additionally guards native checkpoint compatibility, so a compact
  // folder-name collision fails closed instead of resuming different media.
  suffixRunName(graph, "media_run_name", `_m${identity.slice(0, 12)}`, "Run name for these media contents");
  graph.media_fingerprint = { class_type: "StringConcatenate", inputs: {
    string_a: plans[0].inputs.generation_fingerprint ?? "", string_b: `media-sha256:${identity}`, delimiter: "|",
  }, _meta: { title: "Full media checkpoint fingerprint" } };
  plans[0].inputs.generation_fingerprint = ["media_fingerprint", 0];
}
