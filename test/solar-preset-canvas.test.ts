import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { applyPictureVideoSettings, DEFAULT_PICTURE_VIDEO, parsePictureVideoSettings } from "../lib/picture.ts";
import { canvasSize, RESOLUTIONS, type ApiGraph } from "../lib/simple.ts";

const load = (renderer: "solar" | "h3"): ApiGraph => JSON.parse(readFileSync(new URL(`../workflows/picture/from_picture_${renderer === "h3" ? "motion" : "solar"}_flux3.api.json`, import.meta.url), "utf8"));

test("Solar presets fit the native 256–2048 canvas for wide and tall sources", () => {
  for (const source of [[1856, 768], [768, 1856], [4096, 256], [256, 4096]]) {
    for (const resolution of RESOLUTIONS) {
      const graph = load("solar");
      applyPictureVideoSettings(graph, parsePictureVideoSettings({ ...DEFAULT_PICTURE_VIDEO, resolution }), source[0], source[1]);
      const dimensions = [graph["56"].inputs.width, graph["56"].inputs.height] as number[];
      assert.ok(dimensions.every((side) => side >= 256 && side <= 2048 && side % 32 === 0), `${source} at ${resolution}: ${dimensions}`);
      assert.deepEqual([graph["33"].inputs.width, graph["33"].inputs.height], dimensions, "matching motion guidance uses the bounded canvas too");
    }
  }
});

test("H3 presets, valid custom canvases and the default Solar canvas keep their dimensions", () => {
  const h3 = load("h3");
  applyPictureVideoSettings(h3, parsePictureVideoSettings({ renderer: "h3", resolution: "1080p" }), 1856, 768);
  assert.deepEqual([h3["56"].inputs.width, h3["56"].inputs.height], canvasSize(1856, 768, "1080p"));
  const solar = load("solar");
  applyPictureVideoSettings(solar, DEFAULT_PICTURE_VIDEO, 768, 1376);
  assert.deepEqual([solar["56"].inputs.width, solar["56"].inputs.height], [480, 864]);
  for (const renderer of ["h3", "solar"] as const) {
    const graph = load(renderer);
    applyPictureVideoSettings(graph, parsePictureVideoSettings({ renderer, resolution: { width: 640, height: 960 } }), 1856, 768);
    assert.deepEqual([graph["56"].inputs.width, graph["56"].inputs.height], [640, 960]);
  }
});
