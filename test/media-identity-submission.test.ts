import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import { fakeProxy } from "./proxy.ts";
import { StoredFile } from "../lib/http.ts";
import { DEFAULT_MODEL } from "../lib/model.ts";
import { isLink, type ApiGraph, type SimpleSettings } from "../lib/simple.ts";

const proxy = await fakeProxy();
const folder = await mkdtemp(join(tmpdir(), "openjutsu-media-proof-"));
process.env.COMFY_BASE_URL = proxy.url;
delete process.env.COMFY_API_KEY;
const { submitSimple, submitAdvanced, submitObject, submitMontage } = await import("../lib/comfy.ts");
const settings: SimpleSettings = { role: "the dancer", resolution: "480p", motion: 512, hatFix: false, noLipSync: false, margin: "normal", target: "person", seed: 0, clipSeconds: 6 };
const section = { start: 0, length: 0 };
let sequence = 0;
async function file(bytes: string) {
  const path = join(folder, `temporary-${sequence++}.bin`);
  await writeFile(path, bytes);
  return new StoredFile(new Blob([bytes]), "same-name.mp4", "video/mp4", path);
}
function identity(graph: ApiGraph) {
  const resolve = (value: unknown): string => {
    if (!isLink(value)) return String(value);
    const node = graph[value[0]];
    if (node.class_type !== "StringConcatenate") return "same-native-media-hash";
    return resolve(node.inputs.string_a) + String(node.inputs.delimiter) + resolve(node.inputs.string_b);
  };
  const plan = Object.values(graph).find((node) => node.class_type === "MiniMaxH3ChainPlanModern")!;
  return { run: resolve(plan.inputs.run_name), fingerprint: resolve(plan.inputs.generation_fingerprint) };
}

test.after(async () => {
  for (const job of proxy.jobs.values()) proxy.finish(job.id, "canceled");
  const inputs = (globalThis as { [key: symbol]: Map<string, unknown> })[Symbol.for("openjutsu.inputs")];
  for (let i = 0; inputs.size && i < 200; i++) await sleep(50);
  assert.equal(inputs.size, 0);
  await proxy.close();
  await rm(folder, { recursive: true, force: true });
});

for (const mode of ["simple", "advanced", "advanced_maxq", "object", "montage"] as const) {
  test(`${mode}: actual SDK submissions bind saved histories to ordered complete media bytes`, async () => {
    const submit = async (videoBytes: string, pictures: string[], span = section) => {
      const video = await file(videoBytes), photos = await Promise.all(pictures.map(file));
      const advanced = { ...settings, roles: ["dancer", "singer"] };
      const job = mode === "simple" ? await submitSimple(video, span, photos[0], settings, DEFAULT_MODEL)
        : mode === "object" ? await submitObject(video, span, photos[0], { ...settings, mode: "change", changeTo: "a coat", biggestOnly: false, keepOutline: false }, DEFAULT_MODEL)
        : mode === "montage" ? await submitMontage(video, span, photos, advanced, null, DEFAULT_MODEL)
        : await submitAdvanced(video, span, photos, advanced, mode === "advanced_maxq", DEFAULT_MODEL);
      return identity(proxy.jobs.get(job.id)!.workflow as ApiGraph);
    };
    const photos = mode === "simple" || mode === "object" ? ["photo A"] : ["photo A", "photo B"];
    const first = await submit("same video frames; soundtrack A", photos);
    assert.deepEqual(await submit("same video frames; soundtrack A", photos), first, "new temp paths preserve retries");
    const videoChanged = await submit("same video frames; soundtrack B", photos);
    assert.notEqual(videoChanged.run, first.run, "different full video bytes must not resume the same clips");
    assert.notEqual(videoChanged.fingerprint, first.fingerprint, "full native compatibility identity changes too");
    const photoChanged = await submit("same video frames; soundtrack A", ["photo C", ...photos.slice(1)]);
    assert.notEqual(photoChanged.run, first.run);
    assert.notEqual((await submit("same video frames; soundtrack A", photos, { start: 6, length: 3 })).run, first.run, "another source interval can contain different audio");
    if (photos.length > 1) assert.notEqual((await submit("same video frames; soundtrack A", [...photos].reverse())).run, first.run, "photo order is meaningful");
    assert.match(first.fingerprint, /media-sha256:[0-9a-f]{64}/);
    assert.ok(first.run.length <= 96);
  });
}

test("Remove fingerprints only the video, excluding an unused reference", async () => {
  const video = await file("remove video");
  const settingsRemove = { ...settings, mode: "remove" as const, changeTo: "", biggestOnly: false, keepOutline: false };
  const first = await submitObject(video, section, null, settingsRemove, DEFAULT_MODEL);
  const ignored = await file("unused photo");
  await rm(ignored.path);
  const second = await submitObject(video, section, ignored, settingsRemove, DEFAULT_MODEL);
  assert.deepEqual(identity(proxy.jobs.get(first.id)!.workflow as ApiGraph), identity(proxy.jobs.get(second.id)!.workflow as ApiGraph));
});
