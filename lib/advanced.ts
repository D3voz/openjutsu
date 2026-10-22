// Advanced motion transfer: 1-4 characters, SAM tracks labelled by role, only the labelled people regenerated.
// workflows/advanced.api.json (one pass) and advanced_maxq.api.json (one pass per person, 2 characters) are exported
// with every picture, the hat fix and No lip-sync enabled; each request prunes what it does not use. Nodes are found by title, as
// the builder (ComfyUI user/default/oneclick_advanced_build.js) names them.
import { MARGINS, dropNoLipSync, isLink, setMotionSize, type ApiGraph, type Margin, type MotionSize, type Resolution } from "./simple.ts";

export const MAX_CHARACTERS = 4;

export type AdvancedSettings = {
  roles: string[]; // one per picture, "" to let the describer name them
  resolution: Resolution;
  motion: MotionSize;
  hatFix: boolean;
  noLipSync: boolean;
  margin: Margin;
  seed: number;
  clipSeconds: number;
};

const HAT = /\bhats?\b/i;
const PLAN = "Swap Plan (roles, seed, size)";
export const VIDEO = "Source video (people get replaced)";

export function nodeByTitle(graph: ApiGraph, title: string) {
  const ids = Object.keys(graph).filter((id) => graph[id]._meta?.title === title);
  if (ids.length !== 1) throw new Error(`Expected one "${title}" node in the workflow, found ${ids.length}.`);
  return ids[0];
}

export function pictureCount(graph: ApiGraph) {
  return Object.values(graph).filter((node) => node.class_type === "LoadImage" && /^Picture \d$/.test(node._meta?.title ?? "")).length;
}

// Names for pictures left without a role when others have one, as the Swap Plan's own defaults.
function ordinal(i: number, count: number) {
  return count === 1 ? "the main person" : `the person with the ${["", "second ", "third ", "fourth "][i]}most screen time`;
}

export function pruneAdvanced(source: ApiGraph, pictures: number, settings: AdvancedSettings): ApiGraph {
  const graph: ApiGraph = structuredClone(source);
  const available = pictureCount(graph);
  if (pictures < 1 || pictures > available) throw new Error(`This mode takes 1-${available} character photos.`);

  const removed = new Set<string>();
  // Unused pictures: the photo, its shrink and its describer go; inputs that read them are dropped.
  for (let k = pictures + 1; k <= available; k++) {
    const load = nodeByTitle(graph, `Picture ${k}`);
    const shrink = Object.keys(graph).find((id) => isLink(graph[id].inputs.image) && graph[id].inputs.image[0] === load && graph[id].class_type === "ImageScaleToMaxDimension");
    const describe = nodeByTitle(graph, `Describe picture ${k}`);
    for (const id of [load, shrink, describe]) if (id) removed.add(id);
  }
  // Hat fix off: drop the hat nodes; whatever read "people + hats" reads the people mask instead.
  const bypass = new Map<string, unknown>();
  if (!settings.hatFix) {
    for (const [id, node] of Object.entries(graph)) {
      if (!HAT.test(node._meta?.title ?? "")) continue;
      removed.add(id);
      if (node.class_type === "MaskComposite" && node.inputs.operation === "add") bypass.set(id, node.inputs.destination);
    }
  }
  for (const id of removed) delete graph[id];
  for (const [id, node] of Object.entries(graph)) {
    for (const [name, value] of Object.entries(node.inputs)) {
      if (!isLink(value) || !removed.has(value[0])) continue;
      if (bypass.has(value[0])) node.inputs[name] = bypass.get(value[0]);
      else if (node._meta?.title === PLAN || name.startsWith("ref_images.")) delete node.inputs[name];
      else throw new Error(`Node ${id}.${name} still links to removed node ${value[0]}.`);
    }
  }
  if (!settings.noLipSync) dropNoLipSync(graph);
  setMotionSize(graph, settings.motion);

  for (const node of Object.values(graph)) {
    if (node.class_type === "GrowMaskWithBlur" && / grow mask /.test(node._meta?.title ?? "")) node.inputs.expand = MARGINS[settings.margin];
  }
  const plan = graph[nodeByTitle(graph, PLAN)].inputs;
  const roles = settings.roles.slice(0, pictures).map((role) => role.replace(/\s+/g, " ").trim());
  plan.resolution = settings.resolution;
  plan.seed = settings.seed;
  plan.clip_seconds = settings.clipSeconds;
  plan.roles = roles.some(Boolean) ? roles.map((role, i) => role || ordinal(i, pictures)).join("\n") : "";
  return graph;
}
