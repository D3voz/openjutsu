import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { applyPictureVideoSettings, parsePictureVideoSettings } from "../lib/picture.ts";
import type { ApiGraph } from "../lib/simple.ts";

test("picture render custom dimensions respect the shared canvas bounds after snapping", () => {
  for (const side of [1, 32, 239, 2064, 10_000, Number.MAX_VALUE]) {
    for (const resolution of [{ width: side, height: 512 }, { width: 512, height: side }]) {
      assert.throws(() => parsePictureVideoSettings({ resolution }), /256-2048/);
    }
  }
});

test("bounded snapped dimensions reach the real H3 and Solar workflow canvases", () => {
  for (const renderer of ["h3", "solar"] as const) {
    for (const size of [{ width: 240, height: 2063 }, { width: 650, height: 970 }]) {
      const graph: ApiGraph = JSON.parse(readFileSync(new URL(`../workflows/picture/from_picture_${renderer === "h3" ? "motion" : "solar"}_flux3.api.json`, import.meta.url), "utf8"));
      const settings = parsePictureVideoSettings({ renderer, resolution: size });
      applyPictureVideoSettings(graph, settings, 768, 1376);
      const expected = size.width === 240 ? [256, 2048] : [640, 960];
      assert.deepEqual([graph["56"].inputs.width, graph["56"].inputs.height], expected);
      assert.deepEqual([graph["33"].inputs.width, graph["33"].inputs.height], expected);
    }
  }
});
