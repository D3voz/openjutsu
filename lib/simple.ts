// Simple motion transfer: workflows/simple.api.json is one export with all four
// picture branches and the hat fix enabled. Each request prunes what it does not use.

export type ApiNode = { class_type: string; inputs: Record<string, unknown>; _meta?: { title?: string } };
export type ApiGraph = Record<string, ApiNode>;

export const RESOLUTIONS = ["480p", "576p", "736p", "768p", "1080p"] as const;
export type Resolution = (typeof RESOLUTIONS)[number];

export const MAX_PICTURES = 4;
export const CLIP_SECONDS = { min: 2.5, max: 15, default: 6 };
export const MAX_SEED = 0xffffffff;

export type SimpleSettings = {
  roles: string[]; // one entry per picture, "" when the user left it blank
  resolution: Resolution;
  hatFix: boolean;
  seed: number;
  clipSeconds: number;
};

// Node ids in workflows/simple.api.json.
export const NODES = {
  video: "14",
  plan: "20",
  reference: "39",
  peopleMask: "46",
  growMask: "48",
  loopStart: "37",
  loopEnd: "70",
  final: "71",
  pictures: [
    { load: "2", shrink: "3", describe: "4" },
    { load: "5", shrink: "6", describe: "7" },
    { load: "8", shrink: "9", describe: "10" },
    { load: "11", shrink: "12", describe: "13" },
  ],
  hat: ["53", "54", "55", "56"],
};

export function isLink(value: unknown): value is [string, number] {
  return Array.isArray(value) && value.length === 2 && typeof value[0] === "string" && typeof value[1] === "number";
}

// The Swap Plan falls back to "the person with the most screen time", "... second most ..." when roles is blank.
// A partly filled list keeps that fallback for the blank lines so every line stays on its own picture.
function ordinalRole(index: number, count: number) {
  if (count === 1) return "the main person";
  return `the person with the ${["", "second ", "third ", "fourth "][index]}most screen time`;
}

export function rolesText(roles: string[]) {
  const clean = roles.map((role) => role.replace(/\s+/g, " ").trim());
  if (clean.every((role) => !role)) return "";
  return clean.map((role, i) => role || ordinalRole(i, clean.length)).join("\n");
}

export function pruneSimple(source: ApiGraph, settings: SimpleSettings): ApiGraph {
  const count = settings.roles.length;
  if (count < 1 || count > MAX_PICTURES) throw new Error(`Use 1 to ${MAX_PICTURES} pictures.`);

  const graph: ApiGraph = structuredClone(source);
  const plan = graph[NODES.plan].inputs;
  const reference = graph[NODES.reference].inputs;

  for (const [i, picture] of NODES.pictures.entries()) {
    if (i < count) continue;
    delete graph[picture.load];
    delete graph[picture.shrink];
    delete graph[picture.describe];
    delete plan[`picture_${i + 1}`];
    delete plan[`picture_${i + 1}_text`];
    delete reference[`ref_images.ref_image_${i}`];
  }

  if (!settings.hatFix) {
    for (const id of NODES.hat) delete graph[id];
    graph[NODES.growMask].inputs.mask = [NODES.peopleMask, 0];
  }

  for (const [id, node] of Object.entries(graph)) {
    for (const [name, value] of Object.entries(node.inputs)) {
      if (isLink(value) && !graph[value[0]]) throw new Error(`Node ${id}.${name} still links to removed node ${value[0]}.`);
    }
  }

  plan.resolution = settings.resolution;
  plan.seed = settings.seed;
  plan.clip_seconds = settings.clipSeconds;
  plan.roles = rolesText(settings.roles);
  return graph;
}
