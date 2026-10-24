// ControlNet picture swap: the whole frame, the main person and the setting, comes from the picture. A depth video of only
// the main person (SAM 3.1 + Depth Anything V2) holds the framing, camera and poses through the H3 Fun ControlNet Union 2.0.
// workflows/control.api.json is exported (ComfyUI user/default/oneclick_control_build.js) with No lip-sync on; nodes are found by title.
import { nodeByTitle } from "./advanced.ts";
import { dropNoLipSync, setResolution, setSection, type ApiGraph, type Resolution, type Section } from "./simple.ts";

export type ControlSettings = {
  target: string; // what SAM tracks; the biggest one becomes the person in the picture
  resolution: Resolution;
  noLipSync: boolean;
  seed: number;
};

// One H3 clip, the longest H3 is trained on: a continuation clip loses the depth framing where its new frames start.
export const CONTROL_MAX_SECONDS = 15;

export const CONTROL_VIDEO = "Source video (people get replaced)";
export const CONTROL_PICTURE = "Picture 1";
const PLAN = "Swap Plan (roles, seed, size)";

export function pruneControl(source: ApiGraph, settings: ControlSettings): ApiGraph {
  const graph: ApiGraph = structuredClone(source);
  if (!settings.noLipSync) dropNoLipSync(graph);
  graph[nodeByTitle(graph, "SAM: what to replace")].inputs.text = settings.target;
  Object.assign(graph[nodeByTitle(graph, PLAN)].inputs, { seed: settings.seed, clip_seconds: CONTROL_MAX_SECONDS, roles: "" });
  setResolution(graph, nodeByTitle(graph, PLAN), nodeByTitle(graph, CONTROL_VIDEO), settings.resolution);
  return graph;
}

// The whole video, or a longer part, is cut to its first CONTROL_MAX_SECONDS.
export function setControlSection(graph: ApiGraph, section: Section) {
  setSection(graph, nodeByTitle(graph, CONTROL_VIDEO), { start: section.start, length: Math.min(section.length || CONTROL_MAX_SECONDS, CONTROL_MAX_SECONDS) });
}
