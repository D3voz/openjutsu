// Montage: for edited clips where people take turns within one shot. workflows/montage.api.json tracks every person over the
// whole video, labels each appearance with a photo and makes the video as one chain, with one H3 pass per photo on screen in
// each clip. To review the picks first, Find people (workflows/people.api.json) does the tracking and labelling alone and saves
// the tracks (H3MontagePeople in comfyui-h3-oneclick-swap); the render then loads those tracks instead of tracking again.
import { PLAN, nodeByTitle, pruneAdvanced, type AdvancedSettings } from "./advanced.ts";
import { isLink, type ApiGraph } from "./simple.ts";

// One SAM track's appearance within one shot. It spans start..end (to the middle of the gaps around it), is on screen during
// `on`, takes at most `area` of the frame and looks like photo `role` (0 = none). pick: the photo it starts as, 0 to keep it
// (brief or small appearances, which H3 draws as grey figures). Frames count from the start of the part used, at 24 fps.
export type Track = { track: number; start: number; end: number; role: number; on: [number, number][]; area: number; pick: number; image: string };
// tracks: the file Find people saved them to, in ComfyUI's temp folder
export type People = { frames: number; tracks: string | null; people: Track[] };

// small: never big enough for H3 to draw them.
export type Appearance = Track & { frames: number; small: boolean };
export type Label = { track: number; start: number; end: number; role: number };
// The picks from the person list, and the tracks file Find people saved.
export type Review = { tracks: string; labels: Label[] };
// What a montage without review left as it is: a labelled appearance of `photo` too brief or small to swap.
export type Kept = { photo: number; start: number; end: number; small: boolean };

// Node ids in workflows/people.api.json.
export const PEOPLE_NODES = { video: "1", crops: "6" };
export const TRACKS = "Tracks from Find people";
// The montage graph's own tracking and labelling, for a run without review.
const SAM = "SAM 3.1 track every person (whole video)";
const CROPS = "Show each track per shot";
const ANALYSIS = [SAM, CROPS, "Who is each track (Qwen3-VL)", "Read the track labels", "Picks without review"];
export const TRACKS_FILE = /^h3_montage_people_\d+_\.npz$/;

// Listed even when unlabelled once on screen this long or this big.
const BRIEF = 12;
const MIN_SHARE = 0.02;

export function peopleRoles(roles: string[]) {
  return roles.map((role, i) => `<Subject ${i + 1}>: ${role.replace(/\s+/g, " ").trim()}`).join("\n");
}

export function appearances({ people }: People): Appearance[] {
  return people
    .map((t) => {
      const frames = t.on.reduce((sum, [a, b]) => sum + b - a, 0);
      return { ...t, frames, small: t.area < MIN_SHARE };
    })
    // unlabelled small flickers stay as they are either way; a big one may be part of someone (an arm, a knee)
    .filter((a) => a.role || a.frames >= BRIEF || !a.small)
    .sort((a, b) => a.on[0][0] - b.on[0][0] || a.track - b.track);
}

export function renderLabels(list: Appearance[]): Label[] {
  return list.filter((a) => a.pick).map(({ track, start, end, pick }) => ({ track, start, end, role: pick }));
}

export function pruneMontage(source: ApiGraph, pictures: number, settings: AdvancedSettings, review: Review | null): ApiGraph {
  const graph = pruneAdvanced(source, pictures, settings);
  const tracks = nodeByTitle(graph, TRACKS);
  if (!review) {
    delete graph[tracks];
    graph[nodeByTitle(graph, CROPS)].inputs.people = peopleRoles(settings.roles.slice(0, pictures));
    return graph;
  }
  const sam = nodeByTitle(graph, SAM);
  for (const title of ANALYSIS) delete graph[nodeByTitle(graph, title)];
  for (const node of Object.values(graph)) {
    for (const [name, value] of Object.entries(node.inputs)) if (isLink(value) && value[0] === sam) node.inputs[name] = [tracks, 0];
  }
  graph[nodeByTitle(graph, PLAN)].inputs.labels = JSON.stringify(review.labels);
  graph[tracks].inputs.file = review.tracks;
  return graph;
}
