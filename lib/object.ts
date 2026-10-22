// Object swap: change, remove or re-set the things SAM tracks, keeping the rest of the shot.
// workflows/object.api.json is exported (ComfyUI user/default/oneclick_object_build.js) in change mode with a picture;
// each request prunes it. Nodes are found by title.
import { nodeByTitle } from "./advanced.ts";
import { setMotionSize, type ApiGraph, type MotionSize, type Resolution } from "./simple.ts";

export const EDIT_MODES = ["change", "remove", "background"] as const;
export type EditMode = (typeof EDIT_MODES)[number];

// Edit-mask grow in pixels at SAM's 1008 px canvas. For background, how far the new setting reaches into the edge of what stays.
export const OBJECT_MARGINS = { tight: 10, normal: 20, loose: 40 } as const;
export type ObjectMargin = keyof typeof OBJECT_MARGINS;

export type ObjectSettings = {
  mode: EditMode;
  target: string; // what SAM tracks, several separated by commas; for background, what stays
  changeTo: string; // what it becomes, or for remove what shows instead
  biggestOnly: boolean;
  resolution: Resolution;
  motion: MotionSize;
  margin: ObjectMargin;
  seed: number;
  clipSeconds: number;
};

export const OBJECT_VIDEO = "Source video";
export const OBJECT_PICTURE = "Picture 1";

export const objectTargets = (target: string) => target.split(",").map((t) => t.trim()).filter(Boolean);

// The picture describer names only what is copied from the picture, with about 20 more words for each thing.
function describer(settings: ObjectSettings) {
  const things = settings.mode === "background" ? ["place (the setting, its lighting and what is around)"] : objectTargets(settings.target);
  const named = things.length === 1 ? things[0] : things.slice(0, -1).join(", ") + " and the " + things.at(-1);
  const words = 30 + 20 * things.length;
  return {
    prompt: `Describe the ${named} in this picture in about ${words} words${things.length > 1 ? ", one sentence for each" : ""}: their shape, colours, `
      + "materials, patterns and details. No preamble, and nothing about anything else in the picture.",
    max_length: 2 * words + 40,
  };
}

export function pruneObject(source: ApiGraph, picture: boolean, settings: ObjectSettings): ApiGraph {
  const graph: ApiGraph = structuredClone(source);
  const id = (title: string) => nodeByTitle(graph, title);
  const plan = graph[id("Object Swap Plan (what to change)")].inputs;
  const ref = graph[id("Reference Conditioning")].inputs;
  const grow = graph[id("Grow mask")].inputs;
  const grey = graph[id("Turn it grey (shape and movement only)")].inputs;

  if (picture && settings.mode !== "remove") Object.assign(graph[id("Describe picture 1")].inputs, describer(settings));
  if (!picture || settings.mode === "remove") {
    for (const title of [OBJECT_PICTURE, "Shrink for the describer", "Describe picture 1"]) delete graph[id(title)];
    delete plan.picture_1;
    delete plan.picture_1_text;
    delete ref["ref_images.ref_image_0"];
  }
  // A grey shape in the motion reference would come back as a grey object.
  if (settings.mode === "remove") {
    delete ref["ref_videos.ref_video_0"];
    delete ref["ref_video_audios.ref_video_audio_0"];
  }
  // The edit area is everything but what stays, reaching a little into its edge; the whole of it turns grey.
  if (settings.mode === "background") {
    grow.flip_input = true;
    grey.mask = [id("Grow mask"), 0];
    grey.size = [id("Grow mask"), 0];
  }
  grow.expand = OBJECT_MARGINS[settings.margin];
  setMotionSize(graph, settings.motion);
  // One of each thing when only the biggest is kept: hair and top are two tracked objects.
  const most = settings.biggestOnly ? objectTargets(settings.target).length : 0;
  for (const title of ["Tracked area", "Tracked area, tight (for the grey shape)"]) graph[id(title)].inputs.max_people = most;
  graph[id("SAM: what to change")].inputs.text = settings.target;
  Object.assign(plan, {
    mode: settings.mode,
    target: settings.target,
    change_to: settings.changeTo,
    resolution: settings.resolution,
    seed: settings.seed,
    clip_seconds: settings.clipSeconds,
  });
  return graph;
}
