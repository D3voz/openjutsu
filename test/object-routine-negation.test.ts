import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { nodeByTitle } from "../lib/advanced.ts";
import { pruneFit, pruneObject, type ObjectSettings } from "../lib/object.ts";
import { isLink, type ApiGraph } from "../lib/simple.ts";

const load = (name: string): ApiGraph => JSON.parse(readFileSync(new URL(`../workflows/${name}.api.json`, import.meta.url), "utf8"));
const placement = [{ frame: 0, x: 0.1, y: 0.2, width: 0.2, height: 0.3 }];
const settings: ObjectSettings = { mode: "add", target: "on the left", changeTo: "a dancer", biggestOnly: false, keepOutline: false, resolution: "480p", motion: 512, margin: "normal", seed: 0, clipSeconds: 6, placement };

test("explicitly negated synchronization does not enable a copied-routine moving mask", () => {
  for (const action of ["not in sync", "do not synchronize", "never synchronized", "not the same dance routine", "without being synchronised"]) {
    const fit = pruneFit(load("fit"), placement, action);
    assert.equal(fit[nodeByTitle(fit, "Check the fit")].inputs.moving_area, false, action);
    const graph = pruneObject(load("object"), false, { ...settings, action });
    assert.equal(graph.object_placement.class_type, "H3ObjectPlacementMask", action);
    assert.ok(!Object.values(graph).some((node) => node.class_type === "H3AddMovingArea"));
    assert.equal(graph[nodeByTitle(graph, "Object Swap Plan (what to change)")].inputs.action, action, "retain the user's instruction");
    for (const node of Object.values(graph)) for (const value of Object.values(node.inputs)) if (isLink(value)) assert.ok(graph[value[0]]);
  }
});

test("positive copying instructions still enable moving masks in preview and render", () => {
  for (const action of ["dance in sync", "use the same dance routine", "synchronise", "not a solo; do the same routine"]) {
    const fit = pruneFit(load("fit"), placement, action);
    assert.equal(fit[nodeByTitle(fit, "Check the fit")].inputs.moving_area, true, action);
    const graph = pruneObject(load("object"), false, { ...settings, action });
    assert.equal(graph.object_moving_area.class_type, "H3AddMovingArea", action);
  }
});
