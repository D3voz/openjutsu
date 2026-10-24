// Object swap: change, remove or re-set the things SAM tracks, keeping the rest of the shot.
// workflows/object.api.json is exported (ComfyUI user/default/oneclick_object_build.js) in change mode with a picture;
// each request prunes it. Nodes are found by title.
import { nodeByTitle } from "./advanced.ts";
import { setMotionSize, setResolution, type ApiGraph, type MotionSize, type Resolution } from "./simple.ts";

export const EDIT_MODES = ["change", "remove", "background", "add"] as const;
export type EditMode = (typeof EDIT_MODES)[number];

// Edit-mask grow in pixels at SAM's 1008 px canvas. For background, how far the new setting reaches into the edge of what stays.
export const OBJECT_MARGINS = { tight: 10, normal: 20, loose: 40 } as const;
export type ObjectMargin = keyof typeof OBJECT_MARGINS;

export type PlacementKeyframe = { frame: number; x: number; y: number; width: number; height: number };

export function parsePlacement(value: unknown): PlacementKeyframe[] {
  const points = typeof value === "string" ? JSON.parse(value) : value;
  if (!Array.isArray(points) || !points.length) throw new Error("Draw an object placement area first.");
  if (!points.every((p) => p && Number.isInteger(p.frame) && [p.x, p.y, p.width, p.height].every(Number.isFinite)
    && p.x >= 0 && p.y >= 0 && p.x < 1 && p.y < 1 && p.width > 0 && p.height > 0
    && p.x + p.width <= 1 + 1e-6 && p.y + p.height <= 1 + 1e-6)) throw new Error("Keep the placement area inside the video frame.");
  return points.map(({ frame, x, y, width, height }) => ({ frame, x, y, width, height })).sort((a, b) => a.frame - b.frame);
}

export function placementAt(points: PlacementKeyframe[], frame: number) {
  if (!points.length) return null;
  const next = points.findIndex((p) => p.frame > frame);
  const a = points[Math.max(0, next === -1 ? points.length - 1 : next - 1)];
  const b = points[next === -1 ? points.length - 1 : next];
  const t = a.frame === b.frame ? 0 : Math.max(0, Math.min(1, (frame - a.frame) / (b.frame - a.frame)));
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t,
    width: a.width + (b.width - a.width) * t, height: a.height + (b.height - a.height) * t };
}

export type ObjectSettings = {
  mode: EditMode;
  target: string; // what SAM tracks, several separated by commas; for background, what stays
  changeTo: string; // what it becomes, or for remove what shows instead
  biggestOnly: boolean;
  keepOutline: boolean; // change: send the grey shape, which keeps the face and hands around it but also the old outline
  resolution: Resolution;
  motion: MotionSize;
  margin: ObjectMargin;
  seed: number;
  clipSeconds: number;
  placement?: PlacementKeyframe[];
};

export const OBJECT_VIDEO = "Source video";
export const OBJECT_PICTURE = "Picture 1";

export const objectTargets = (target: string) => target.split(",").map((t) => t.trim()).filter(Boolean);

// The picture describer names only what is copied from the picture, with about 20 more words for each thing.
// Asked for "the top", it described only the tee under an open flannel shirt, so layers are named outer first.
function describer(settings: ObjectSettings) {
  const background = settings.mode === "background";
  const things = background ? ["place (the setting, its lighting and what is around)"] : settings.mode === "add" ? [settings.changeTo.replace(/^(?:a|an|the)\s+/i, "") || "main object"] : objectTargets(settings.target);
  const named = things.length === 1 ? things[0] : things.slice(0, -1).join(", ") + " and the " + things.at(-1);
  const words = 30 + 20 * things.length;
  return {
    prompt: `Describe the ${named} in this picture in about ${words} words${things.length > 1 ? ", one sentence for each" : ""}: their shape, colours, `
      + "materials, patterns and details. "
      + (background || settings.mode === "add" ? "" : "Include every layer worn there, outer layer first: an open shirt or jacket over a top is part of the top. ")
      + "No preamble, and nothing about anything else in the picture.",
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
  // H3 copies a grey shape's outline, so a changed top keeps the old silhouette and a removed object would come back grey.
  if (settings.mode === "remove" || settings.mode === "change" && !settings.keepOutline) {
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
    keep_outline: settings.keepOutline,
    seed: settings.seed,
    clip_seconds: settings.clipSeconds,
  });
  if (settings.mode === "add") {
    const placement = JSON.stringify(parsePlacement(settings.placement));
    plan.placement = placement;
    plan.keep_outline = false;
    ref["ref_videos.ref_video_0"] = [id("Motion reference for this clip"), 0];
    graph.object_placement = { class_type: "H3ObjectPlacementMask", inputs: {
      images: [id("Source clip (frames + audio)"), 0], start_frame: [id("Clip start frame"), 1], placement,
    }, _meta: { title: "Object placement area" } };
    grow.mask = ["object_placement", 0];
    grow.expand = { tight: 0, normal: 2, loose: 4 }[settings.margin];
    for (const title of ["SAM 3.1", "SAM: what to change", "SAM video (1008 px, SAM's own size)", "SAM frames for this clip", "SAM 3.1 track it",
      "Tracked area", "Tracked area, tight (for the grey shape)", "Turn it grey (shape and movement only)"]) delete graph[id(title)];
  }
  setResolution(graph, id("Object Swap Plan (what to change)"), id(OBJECT_VIDEO), settings.resolution);
  return graph;
}
