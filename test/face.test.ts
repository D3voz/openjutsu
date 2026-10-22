import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { nodeByTitle } from "../lib/advanced.ts";
import { FACE_PICTURE, FACE_VIDEO, faceChunkCount, pruneFace, type FaceSettings } from "../lib/face.ts";
import { applyModel, DEFAULT_MODEL } from "../lib/model.ts";
import { isLink, type ApiGraph } from "../lib/simple.ts";

const graph: ApiGraph = JSON.parse(readFileSync(new URL("../workflows/face.api.json", import.meta.url), "utf8"));
const settings = (style: FaceSettings["style"]): FaceSettings => ({ style, seed: 7, chunkSeconds: 5 });
const dangling = (g: ApiGraph) => Object.entries(g).flatMap(([id, node]) =>
  Object.entries(node.inputs).filter(([, v]) => isLink(v) && !g[v[0]]).map(([name]) => `${id}.${name}`));
const node = (g: ApiGraph, title: string) => g[nodeByTitle(g, title)];

test("the export has the video, the picture and Follow the mouth on", () => {
  assert.equal(node(graph, FACE_VIDEO).class_type, "VHS_LoadVideo");
  assert.equal(node(graph, FACE_PICTURE).class_type, "LoadImage");
  assert.ok(node(graph, "Face Fix Chunks").inputs.follow_mouth);
  assert.ok(node(graph, "Reference Conditioning").inputs["ref_videos.ref_video_0"]);
});

test("Follow the mouth keeps the graph and sets the seed and chunk length", () => {
  const pruned = pruneFace(graph, settings("mouth"));
  assert.equal(Object.keys(pruned).length, Object.keys(graph).length);
  assert.equal(node(pruned, "Seed").inputs.noise_seed, 7);
  assert.equal(node(pruned, "Face Fix Chunks").inputs.chunk_seconds, 5);
  assert.equal(node(graph, "Seed").inputs.noise_seed, 0, "the source graph is not modified");
});

test("Match the photo drops the blurred face and the motion reference", () => {
  const pruned = pruneFace(graph, settings("photo"));
  assert.deepEqual(dangling(pruned), []);
  assert.equal(Object.keys(pruned).length, Object.keys(graph).length - 1);
  assert.equal(node(pruned, "Face Fix Chunks").inputs.follow_mouth, undefined);
  const ref = node(pruned, "Reference Conditioning").inputs;
  assert.deepEqual(Object.keys(ref).filter((name) => name.startsWith("ref_")), ["ref_image_size", "ref_images.ref_image_0"]);
});

test("the steps go to the Schedule and the LoRAs into the sampler model", () => {
  const pruned = pruneFace(graph, settings("photo"));
  applyModel(pruned, { ...DEFAULT_MODEL, steps: 9, loras: [] });
  assert.equal(node(pruned, "Schedule").inputs.steps, 9);
  assert.deepEqual(node(pruned, "Comfy Kitchen Attention").inputs.model, [nodeByTitle(pruned, "H3 Diffusion Model"), 0]);
  assert.deepEqual(dangling(pruned), []);
});

test("chunk count mirrors H3 Face Fix Chunks", () => {
  // 413 frames, 6.5 s chunks of 141 frames overlapping by at least 24: 4 chunks; a short video is one chunk
  assert.equal(faceChunkCount(413 / 24, 6.5), 4);
  assert.equal(faceChunkCount(413 / 24, 6.6), 3);
  assert.equal(faceChunkCount(4, 6.5), 1);
});
