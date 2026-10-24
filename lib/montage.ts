// Montage: for edited clips where people take turns within one shot. Find people (workflows/people.api.json) tracks every
// person over the whole video, labels each appearance with a photo and saves the tracks; H3MontagePeople in
// comfyui-h3-oneclick-swap writes the result. The render (workflows/montage.api.json) loads those same tracks and makes the
// video as one chain, with one H3 pass per photo on screen in each clip.
import { PLAN, nodeByTitle, pruneAdvanced, type AdvancedSettings } from "./advanced.ts";
import type { ApiGraph } from "./simple.ts";

// One SAM track's appearance within one shot. It spans start..end (to the middle of the gaps around it), is on screen during
// `on`, takes at most `area` of the frame and looks like photo `role` (0 = none). Frames count from the start of the part used, at 24 fps.
export type Track = { track: number; start: number; end: number; role: number; on: [number, number][]; area: number; image: string };
// tracks: the file Find people saved them to, in ComfyUI's temp folder
export type People = { frames: number; tracks: string | null; people: Track[] };

// pick: the photo this appearance becomes, 0 to keep it. small: never big enough for H3 to draw them.
export type Appearance = Track & { frames: number; small: boolean; pick: number };
export type Label = { track: number; start: number; end: number; role: number };

// Node ids in workflows/people.api.json.
export const PEOPLE_NODES = { video: "1", crops: "6" };
export const TRACKS = "Tracks from Find people";
export const TRACKS_FILE = /^h3_montage_people_\d+_\.npz$/;

// Appearances start as kept unless they are on screen this long and this big: H3 draws a brief or small,
// far-off person as the grey figure of the motion reference instead of the photo.
const BRIEF = 12;
const MIN_SHARE = 0.02;

export function peopleRoles(roles: string[]) {
  return roles.map((role, i) => `<Subject ${i + 1}>: ${role.replace(/\s+/g, " ").trim()}`).join("\n");
}

export function appearances({ people }: People): Appearance[] {
  return people
    .map((t) => {
      const frames = t.on.reduce((sum, [a, b]) => sum + b - a, 0);
      const small = t.area < MIN_SHARE;
      return { ...t, frames, small, pick: t.role && !small && frames >= BRIEF ? t.role : 0 };
    })
    // unlabelled small flickers stay as they are either way; a big one may be part of someone (an arm, a knee)
    .filter((a) => a.role || a.frames >= BRIEF || !a.small)
    .sort((a, b) => a.on[0][0] - b.on[0][0] || a.track - b.track);
}

export function renderLabels(list: Appearance[]): Label[] {
  return list.filter((a) => a.pick).map(({ track, start, end, pick }) => ({ track, start, end, role: pick }));
}

export function pruneMontage(source: ApiGraph, pictures: number, settings: AdvancedSettings, tracks: string, labels: Label[]): ApiGraph {
  const graph = pruneAdvanced(source, pictures, settings);
  graph[nodeByTitle(graph, PLAN)].inputs.labels = JSON.stringify(labels);
  graph[nodeByTitle(graph, TRACKS)].inputs.file = tracks;
  return graph;
}
