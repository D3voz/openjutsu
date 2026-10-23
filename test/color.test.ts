import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { nodeByTitle } from "../lib/advanced.ts";
import { COLOR_VIDEO, DEFAULT_TONE, pruneColor, toneFromPreset } from "../lib/color.ts";
import { isLink, type ApiGraph } from "../lib/simple.ts";

const graph: ApiGraph = JSON.parse(readFileSync(new URL("../workflows/color.api.json", import.meta.url), "utf8"));
const dangling = (g: ApiGraph) => Object.entries(g).flatMap(([id, node]) =>
  Object.entries(node.inputs).filter(([, v]) => isLink(v) && !g[v[0]]).map(([name]) => `${id}.${name}`));
const node = (g: ApiGraph, title: string) => g[nodeByTitle(g, title)];
const video = nodeByTitle(graph, COLOR_VIDEO);

test("both steps set the amount and embed the tone settings under the node's preset name", () => {
  const pruned = pruneColor(graph, { detail: -0.35, tone: { ...DEFAULT_TONE, strength: 0.5 } });
  assert.equal(node(pruned, "Detail contrast").inputs.detail_contrast, -0.35);
  const tone = node(pruned, "Tone mapper").inputs;
  const raw = JSON.parse(String(tone.raw_settings));
  assert.equal(raw.preset, tone.preset);
  assert.equal(raw.node_type, "color_fx_dctl_tone_mapper");
  assert.deepEqual(raw.settings, { ...DEFAULT_TONE, strength: 0.5, preserve_luminosity: false, clamp_output: true });
  assert.equal(node(graph, "Tone mapper").inputs.raw_settings, "", "the source graph is not modified");
});

test("a step that is off is dropped and the video goes around it", () => {
  const toneOnly = pruneColor(graph, { detail: null, tone: DEFAULT_TONE });
  assert.deepEqual(dangling(toneOnly), []);
  assert.deepEqual(node(toneOnly, "Tone mapper").inputs.image, [video, 0]);

  const detailOnly = pruneColor(graph, { detail: -0.2, tone: null });
  assert.deepEqual(dangling(detailOnly), []);
  assert.deepEqual(node(detailOnly, "Fixed video").inputs.images, [nodeByTitle(detailOnly, "Detail contrast"), 0]);

  const neither = pruneColor(graph, { detail: null, tone: null });
  assert.deepEqual(node(neither, "Fixed video").inputs.images, [video, 0]);
  assert.deepEqual(node(neither, "Fixed video").inputs.audio, [video, 2]);
});

test("an Orion preset keeps the values the page shows and ignores the rest", () => {
  const tone = toneFromPreset({ mode: "Filmic Strong", contrast: 1.25, saturation: 1.1, mask_blur: 3, exposure: "x" });
  assert.deepEqual(tone, { ...DEFAULT_TONE, mode: "Filmic Strong", contrast: 1.25, saturation: 1.1 });
  assert.equal(toneFromPreset({ mode: "Sepia" }).mode, DEFAULT_TONE.mode);
});
