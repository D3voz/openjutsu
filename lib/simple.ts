// Simple motion transfer: one character replaces the main person in the video.
// workflows/simple.api.json (the swap) and workflows/mask.api.json (the mask check) are exported
// with the hat fix (and the swap with No lip-sync) enabled; each request prunes what it does not use.

export type ApiNode = { class_type: string; inputs: Record<string, unknown>; _meta?: { title?: string } };
export type ApiGraph = Record<string, ApiNode>;

export const RESOLUTIONS = ["480p", "576p", "736p", "768p", "1080p"] as const;
export type Preset = (typeof RESOLUTIONS)[number];
export type Size = { width: number; height: number };
// A preset is the short edge and keeps the source shape; a custom size is the exact canvas.
export type Resolution = Preset | Size;
export const CUSTOM_SIZE = { min: 256, max: 2048, step: 32 };

// Canvas the Swap Plan makes for a source of this size, as its plan_clips does.
export function canvasSize(width: number, height: number, preset: Preset) {
  const scale = parseInt(preset) / Math.min(width, height);
  return [width, height].map((side) => Math.max(32, Math.round((side * scale) / 32) * 32));
}

// A custom size scales and centre-crops the source frames before anything reads them, so SAM, the masks,
// the motion reference and the generation share that shape; the Production Plan alone would crop the frames but stretch the mask.
export function setResolution(graph: ApiGraph, plan: string, video: string, resolution: Resolution) {
  if (typeof resolution === "string") {
    graph[plan].inputs.resolution = resolution;
    return;
  }
  cropSource(graph, video, resolution);
  graph[plan].inputs.short_edge = Math.min(resolution.width, resolution.height);
}

// Also for Find people, whose SAM must see the same frames as the montage render.
export function cropSource(graph: ApiGraph, video: string, size: Size) {
  for (const node of Object.values(graph)) {
    for (const [name, value] of Object.entries(node.inputs)) if (isLink(value) && value[0] === video && value[1] === 0) node.inputs[name] = ["custom_size", 0];
  }
  graph.custom_size = { class_type: "ImageScale", inputs: { image: [video, 0], upscale_method: "bilinear", width: size.width, height: size.height, crop: "center" }, _meta: { title: "Custom size (centre crop)" } };
}

export const CLIP_SECONDS = { min: 2.5, max: 15, default: 6 };
export const MAX_SEED = 0xffffffff;

// Edit-mask grow in pixels at SAM's 1008 px canvas. Motion comes from the tight mannequin either way.
export const MARGINS = { tight: 20, normal: 40, loose: 60 } as const;
export type Margin = keyof typeof MARGINS;

// Long edge of the grey-mannequin motion reference H3 follows. H3 itself caps reference videos at 768x1344.
export const MOTION_SIZES = [512, 768, 1376] as const;
export type MotionSize = (typeof MOTION_SIZES)[number];

// Part of the source video to use, in seconds; length 0 runs to the end. VHS cuts the soundtrack to the same part.
export type Section = { start: number; length: number };
export const MIN_SECTION_SECONDS = 2;

export const PLACES = ["Whole", "Start", "Middle", "End"] as const;

// Where a part of the given length sits for each place button.
export function placeStart(place: (typeof PLACES)[number], duration: number, length: number) {
  return place === "Middle" ? (duration - length) / 2 : place === "End" ? duration - length : 0;
}

export function timecode(seconds: number) {
  return `${Math.floor(seconds / 60)}:${(seconds % 60).toFixed(1).padStart(4, "0")}`;
}

export function setSection(graph: ApiGraph, video: string, section: Section) {
  // every export loads the video at force_rate 24
  graph[video].inputs.skip_first_frames = Math.round(section.start * 24);
  graph[video].inputs.frame_load_cap = Math.round(section.length * 24);
}

export const DEFAULT_TARGET = "person";

export type SimpleSettings = {
  role: string; // who the character replaces, "" to let the describer name the main person
  resolution: Resolution;
  motion: MotionSize;
  hatFix: boolean;
  noLipSync: boolean; // the people do not sing along: H3 hears silence, sees their faces and is told nobody sings
  margin: Margin;
  target: string; // what SAM tracks; the biggest one is replaced ("person", "cat", ...)
  seed: number;
  clipSeconds: number;
};

type MaskNodes = { target: string; hat: string[]; growMask: string; peopleMask: string };

// Node ids in workflows/simple.api.json.
export const NODES = {
  picture: "2",
  video: "5",
  plan: "11",
  target: "24",
  loopStart: "28",
  peopleMask: "39",
  growMask: "42",
  loopEnd: "66",
  final: "67",
  hat: ["47", "48", "49", "50", "51", "52"],
};

// Node ids in workflows/mask.api.json.
export const MASK_NODES = {
  video: "1",
  target: "3",
  peopleMask: "7",
  growMask: "9",
  hat: ["10", "11", "12", "13", "19", "20"],
};

export function isLink(value: unknown): value is [string, number] {
  return Array.isArray(value) && value.length === 2 && typeof value[0] === "string" && typeof value[1] === "number";
}

function maskSettings(source: ApiGraph, hatFix: boolean, margin: Margin, target: string, nodes: MaskNodes): ApiGraph {
  const graph: ApiGraph = structuredClone(source);
  graph[nodes.target].inputs.text = target;
  graph[nodes.growMask].inputs.expand = MARGINS[margin];
  if (!hatFix) {
    for (const id of nodes.hat) delete graph[id];
    graph[nodes.growMask].inputs.mask = [nodes.peopleMask, 0];
  }
  for (const [id, node] of Object.entries(graph)) {
    for (const [name, value] of Object.entries(node.inputs)) {
      if (isLink(value) && !graph[value[0]]) throw new Error(`Node ${id}.${name} still links to removed node ${value[0]}.`);
    }
  }
  return graph;
}

// The No lip-sync nodes, titled the same in every swap export (workflows/build/oneclick_*_build.js).
const MUTE = /^Mute the (clip|reference) audio H3 hears$/;
const NO_LIP_SYNC = /^(No lip-sync in the prompt|SAM: faces|SAM 3\.1 track faces|Faces \(shown on the mannequins?\))$/;

// No lip-sync off: the nodes go, H3 hears the soundtrack again and the mannequins get no faces.
export function dropNoLipSync(graph: ApiGraph) {
  const through = new Map<string, unknown>();
  for (const [id, node] of Object.entries(graph)) {
    const title = node._meta?.title ?? "";
    if (MUTE.test(title)) through.set(id, node.inputs.audio);
    else if (NO_LIP_SYNC.test(title)) through.set(id, undefined);
  }
  for (const id of through.keys()) delete graph[id];
  for (const [id, node] of Object.entries(graph)) {
    for (const [name, value] of Object.entries(node.inputs)) {
      if (!isLink(value) || !through.has(value[0])) continue;
      if (through.get(value[0])) node.inputs[name] = through.get(value[0]);
      else if (["no_lip_sync", "faces", "face_size"].includes(name)) delete node.inputs[name];
      else throw new Error(`Node ${id}.${name} still links to removed node ${value[0]}.`);
    }
  }
}

// Every motion reference resize in a swap export, including One pass per person's pass 2. The Swap Plan's run name
// (which picks the saved clips a rerun resumes from) does not know the size, so other sizes get their own run.
export function setMotionSize(graph: ApiGraph, size: MotionSize) {
  const nodes = Object.values(graph).filter((node) => node.class_type === "ImageScaleToMaxDimension" && /motion reference/i.test(node._meta?.title ?? ""));
  if (!nodes.length) throw new Error("Expected a motion reference resize in the workflow.");
  for (const node of nodes) node.inputs.largest_size = size;
  if (size === MOTION_SIZES[0]) return;
  suffixRunName(graph, "motion_run_name", `_motion${size}`, "Run name for this motion reference size");
}

// Settings the Swap Plan's run name does not know get their own run, so a rerun never resumes from clips made without them.
export function suffixRunName(graph: ApiGraph, id: string, suffix: string, title: string) {
  const plans = Object.values(graph).filter((node) => node.class_type === "MiniMaxH3ChainPlanModern");
  if (plans.length !== 1) throw new Error(`Expected one Production Plan node in the workflow, found ${plans.length}.`);
  graph[id] = { class_type: "StringConcatenate", inputs: { string_a: plans[0].inputs.run_name, string_b: suffix, delimiter: "" }, _meta: { title } };
  plans[0].inputs.run_name = [id, 0];
}

export function pruneSimple(source: ApiGraph, settings: SimpleSettings): ApiGraph {
  const graph = maskSettings(source, settings.hatFix, settings.margin, settings.target, NODES);
  if (!settings.noLipSync) dropNoLipSync(graph);
  setMotionSize(graph, settings.motion);
  const plan = graph[NODES.plan].inputs;
  setResolution(graph, NODES.plan, NODES.video, settings.resolution);
  plan.seed = settings.seed;
  plan.clip_seconds = settings.clipSeconds;
  plan.roles = settings.role.replace(/\s+/g, " ").trim();
  return graph;
}

export function pruneMask(source: ApiGraph, hatFix: boolean, margin: Margin, target: string): ApiGraph {
  return maskSettings(source, hatFix, margin, target, MASK_NODES);
}
