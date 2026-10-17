// Simple motion transfer: one character replaces the main person in the video.
// workflows/simple.api.json (the swap) and workflows/mask.api.json (the mask check) are exported
// with the hat fix enabled; each request prunes what it does not use.

export type ApiNode = { class_type: string; inputs: Record<string, unknown>; _meta?: { title?: string } };
export type ApiGraph = Record<string, ApiNode>;

export const RESOLUTIONS = ["480p", "576p", "736p", "768p", "1080p"] as const;
export type Resolution = (typeof RESOLUTIONS)[number];

export const CLIP_SECONDS = { min: 2.5, max: 15, default: 6 };
export const MAX_SEED = 0xffffffff;

// Edit-mask grow in pixels at SAM's 1008 px canvas. Motion comes from the tight mannequin either way.
export const MARGINS = { tight: 20, normal: 40, loose: 60 } as const;
export type Margin = keyof typeof MARGINS;

export type SimpleSettings = {
  role: string; // who the character replaces, "" to let the describer name the main person
  resolution: Resolution;
  hatFix: boolean;
  margin: Margin;
  seed: number;
  clipSeconds: number;
};

type HatNodes = { hat: string[]; growMask: string; peopleMask: string };

// Node ids in workflows/simple.api.json.
export const NODES = {
  picture: "2",
  video: "5",
  plan: "11",
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
  peopleMask: "7",
  growMask: "9",
  hat: ["10", "11", "12", "13", "19", "20"],
};

export function isLink(value: unknown): value is [string, number] {
  return Array.isArray(value) && value.length === 2 && typeof value[0] === "string" && typeof value[1] === "number";
}

function maskSettings(source: ApiGraph, hatFix: boolean, margin: Margin, nodes: HatNodes): ApiGraph {
  const graph: ApiGraph = structuredClone(source);
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

export function pruneSimple(source: ApiGraph, settings: SimpleSettings): ApiGraph {
  const graph = maskSettings(source, settings.hatFix, settings.margin, NODES);
  const plan = graph[NODES.plan].inputs;
  plan.resolution = settings.resolution;
  plan.seed = settings.seed;
  plan.clip_seconds = settings.clipSeconds;
  plan.roles = settings.role.replace(/\s+/g, " ").trim();
  return graph;
}

export function pruneMask(source: ApiGraph, hatFix: boolean, margin: Margin): ApiGraph {
  return maskSettings(source, hatFix, margin, MASK_NODES);
}
