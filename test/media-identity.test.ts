import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { bindMediaIdentity } from "../lib/media-identity.ts";
import { isLink, type ApiGraph } from "../lib/simple.ts";

test("complete contents, reference order and retry identity are independent of file paths", async () => {
  const dir = await mkdtemp(join(tmpdir(), "openjutsu-media-hash-"));
  try {
    const file = async (name: string, bytes: Uint8Array | string) => {
      const path = join(dir, name); await writeFile(path, bytes); return { path };
    };
    const videoBytes = Buffer.alloc(256 * 1024 + 1, 42);
    const video = await file("video.mp4", videoBytes);
    const a = await file("a.png", "photo A"), b = await file("b.png", "photo B");
    const source: ApiGraph = JSON.parse(await readFile(new URL("../workflows/simple.api.json", import.meta.url), "utf8"));
    const key = async (media: { path: string }, photos: { path: string }[]) => {
      const graph = structuredClone(source); await bindMediaIdentity(graph, media, photos); return graph.media_fingerprint.inputs.string_b;
    };
    const original = await key(video, [a, b]);
    assert.equal(await key(await file("a-new-temporary-name.mp4", videoBytes), [a, b]), original);
    videoBytes[videoBytes.length - 1] ^= 1;
    assert.notEqual(await key(await file("last-byte-changed.mp4", videoBytes), [a, b]), original);
    assert.notEqual(await key(video, [b, a]), original);
    assert.notEqual(await key(video, [a]), original);
    assert.notEqual(await key(video, [a, await file("changed.png", "photo C")]), original);
    assert.match(String(original), /^media-sha256:[0-9a-f]{64}$/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("media identity composes with existing run and compatibility links within the native name limit", async () => {
  const graph: ApiGraph = JSON.parse(await readFile(new URL("../workflows/simple.api.json", import.meta.url), "utf8"));
  const plan = Object.values(graph).find((node) => node.class_type === "MiniMaxH3ChainPlanModern")!;
  const priorRun = ["existing_model_motion_mask_names", 0];
  graph.existing_model_motion_mask_names = { class_type: "StringConcatenate", inputs: { string_a: "edit_0123456789_moving_area_motion1376_mask0123456789abcdef_model0123456789abcdef", string_b: "", delimiter: "" } };
  graph.existing_compatibility = { class_type: "StringConcatenate", inputs: { string_a: "external-policy", string_b: "", delimiter: "" } };
  plan.inputs.run_name = priorRun;
  plan.inputs.generation_fingerprint = ["existing_compatibility", 0];
  await bindMediaIdentity(graph, { path: fileURLToPath(new URL("../package.json", import.meta.url)) }, []);
  assert.deepEqual(graph.media_run_name.inputs.string_a, priorRun);
  assert.deepEqual(graph.media_fingerprint.inputs.string_a, ["existing_compatibility", 0]);
  const resolve = (value: unknown): string => {
    if (!isLink(value)) return String(value);
    const input = graph[value[0]].inputs;
    return resolve(input.string_a) + String(input.delimiter) + resolve(input.string_b);
  };
  assert.ok(resolve(plan.inputs.run_name).length <= 96);
  assert.match(resolve(plan.inputs.generation_fingerprint), /^external-policy\|media-sha256:[0-9a-f]{64}$/);
});

test("unreadable media fails before altering the graph", async () => {
  const graph: ApiGraph = JSON.parse(await readFile(new URL("../workflows/simple.api.json", import.meta.url), "utf8"));
  const before = structuredClone(graph);
  await assert.rejects(bindMediaIdentity(graph, { path: join(tmpdir(), "missing-openjutsu-media", "absent.mp4") }, []));
  assert.deepEqual(graph, before);
});
