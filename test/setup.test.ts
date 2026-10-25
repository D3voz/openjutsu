import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { POST } from "../app/api/setup/route.ts";
import { DEFAULT_TONE } from "../lib/color.ts";
import { JOB_KINDS } from "../lib/comfy.ts";
import { DEFAULT_MODEL } from "../lib/model.ts";
import { checkSetup, inspectSetup, setupGraph, type NodeRegistry, type SetupRequest } from "../lib/setup.ts";
import type { ApiGraph, SimpleSettings } from "../lib/simple.ts";

const load = (kind: string): ApiGraph => JSON.parse(readFileSync(new URL(`../workflows/${kind}.api.json`, import.meta.url), "utf8"));
const settings: SimpleSettings = { role: "the drummer", resolution: "480p", motion: 512, hatFix: false, noLipSync: false, margin: "normal", target: "person", seed: 0, clipSeconds: 6 };
const simple: SetupRequest = { kind: "simple", settings, model: DEFAULT_MODEL };

function registryFor(...graphs: ApiGraph[]): NodeRegistry {
  const registry: NodeRegistry = {};
  for (const graph of graphs) for (const node of Object.values(graph)) {
    const required = (registry[node.class_type] ??= { input: { required: {} } }).input!.required!;
    for (const [key, value] of Object.entries(node.inputs)) if (typeof value === "string") {
      const options = (required[key] ??= [[]])[0] as string[];
      if (!options.includes(value)) options.push(value);
    }
  }
  return registry;
}

test("all ten workflows pass with their nodes and model filenames registered", () => {
  for (const kind of JOB_KINDS) {
    const graph = load(kind);
    assert.deepEqual(inspectSetup(graph, registryFor(graph)), { ok: true, packs: [], models: [] }, kind);
  }
});

test("missing nodes are grouped by their source pack, including both published D3voz repos", () => {
  const graph = { ...load("simple"), ...Object.fromEntries(Object.entries(load("color")).map(([id, node]) => [`color_${id}`, node])) };
  const registry = registryFor(graph);
  for (const name of ["H3PeopleMask", "H3ClipShots", "ImageDetailContrast", "VHS_LoadVideo"]) delete registry[name];
  const result = inspectSetup(graph, registry);
  assert.equal(result.ok, false);
  assert.equal(result.packs.length, 3);
  assert.deepEqual(result.packs.find((p) => p.url === "https://github.com/D3voz/comfyui-h3-oneclick-swap")?.nodes.sort(), ["H3ClipShots", "H3PeopleMask"]);
  assert.equal(result.packs.find((p) => p.nodes.includes("ImageDetailContrast"))?.url, "https://github.com/D3voz/comfyui-image-detail-contrast");
});

test("missing pack nodes also point to an old ComfyUI or a pack that failed to load", () => {
  const graph = load("simple");
  const registry = registryFor(graph);
  delete registry.H3OneClickSwapPlan;
  assert.match(inspectSetup(graph, registry).error!, /ComfyUI may be too old.*Update ComfyUI.*import errors/);
  const core = registryFor(graph);
  delete core.SAM3_VideoTrack;
  const result = inspectSetup(graph, core);
  assert.equal(result.packs[0].url, "https://github.com/Comfy-Org/ComfyUI");
  assert.equal(result.error, undefined, "core nodes already say update required");
});

test("all custom node types in the exports have a pack mapping", () => {
  const custom = /^(H3|MiniMaxH3(?!ReferenceToVideo|SigmaShift|FunControlNetApply)|VHS_|GrowMaskWithBlur$|ImageAndMaskPreview$|ImageDetailContrast$|Orion4D_|SAMLoader$)/;
  const graphs = JOB_KINDS.map(load);
  const missing = inspectSetup(Object.fromEntries(graphs.flatMap((g, i) => Object.entries(g).map(([id, node]) => [`${i}_${id}`, node]))), {});
  const core = missing.packs.find((p) => p.url === "https://github.com/Comfy-Org/ComfyUI")!;
  assert.ok(core.nodes.includes("SAM3_VideoTrack"));
  assert.ok(core.nodes.every((name) => !custom.test(name)), core.nodes.join(", "));
});

test("disabled colour steps and unrelated features do not block a job", () => {
  for (const selected of [{ detail: null, tone: DEFAULT_TONE }, { detail: -0.2, tone: null }]) {
    const graph = setupGraph(load("color"), { kind: "color", settings: selected });
    const registry = registryFor(graph);
    delete registry[selected.detail === null ? "ImageDetailContrast" : "Orion4D_FXMax_DCTLToneMapper"];
    assert.equal(inspectSetup(graph, registry).ok, true);
  }
  const graph = setupGraph(load("simple"), simple);
  const registry = registryFor(graph);
  delete registry.H3FaceTrackCrop;
  delete registry.SAM3_TrackToMask;
  assert.equal(inspectSetup(graph, registry).ok, true, "the hat and face-tracking branches are not used");
});

test("adding an object checks the new placement node but does not require SAM", () => {
  const selection: SetupRequest = { kind: "object", picture: false, model: DEFAULT_MODEL, settings: {
    mode: "add", target: "on the table", changeTo: "a cake", biggestOnly: false, keepOutline: false,
    resolution: "480p", motion: 512, margin: "normal", seed: 0, clipSeconds: 6,
    placement: [{ frame: 0, x: 0.3, y: 0.4, width: 0.2, height: 0.2 }],
  } };
  const graph = setupGraph(load("object"), selection);
  const registry = registryFor(graph);
  assert.equal(inspectSetup(graph, registry).ok, true);
  delete registry.H3ObjectPlacementMask;
  const missing = inspectSetup(graph, registry);
  assert.equal(missing.packs.length, 1);
  assert.equal(missing.packs[0].url, "https://github.com/D3voz/comfyui-h3-oneclick-swap");
  assert.deepEqual(missing.packs[0].nodes, ["H3ObjectPlacementMask"]);
});

test("the selected base model and LoRAs replace the workflow defaults in the check", () => {
  const graph = setupGraph(load("simple"), { ...simple, model: { model: "other.safetensors", loras: [{ name: "style.safetensors", strength: 0.8 }], steps: 8 } });
  const registry = registryFor(graph);
  assert.equal(inspectSetup(graph, registry).ok, true);
  registry.UNETLoader.input!.required!.unet_name = [[]];
  registry.LoraLoaderModelOnly.input!.required!.lora_name = [[]];
  assert.deepEqual(inspectSetup(graph, registry).models, [
    { name: "other.safetensors", folder: "diffusion_models" },
    { name: "style.safetensors", folder: "loras" },
  ]);
  const noLora = setupGraph(load("simple"), { ...simple, model: { ...DEFAULT_MODEL, loras: [] } });
  const noLoraRegistry = registryFor(noLora);
  delete noLoraRegistry.LoraLoaderModelOnly;
  assert.equal(inspectSetup(noLora, noLoraRegistry).ok, true);
});

test("model checks deduplicate files, normalize path separators, and ignore upload placeholders and preset names", () => {
  const graph: ApiGraph = {
    a: { class_type: "CLIPLoader", inputs: { clip_name: "missing.safetensors" } },
    b: { class_type: "CLIPLoader", inputs: { clip_name: "missing.safetensors" } },
    c: { class_type: "H3FaceTrackCrop", inputs: { detector: "bbox\\face.pt", fallback_detector: "none" } },
    d: { class_type: "LoadImage", inputs: { image: "example.png" } },
    e: { class_type: "Orion4D_FXMax_DCTLToneMapper", inputs: { preset: "Openjutsu" } },
  };
  const registry = registryFor(graph);
  registry.CLIPLoader.input!.required!.clip_name = [[]];
  registry.H3FaceTrackCrop.input!.required!.detector = [["bbox/face.pt"]];
  registry.LoadImage.input!.required!.image = [[]];
  registry.Orion4D_FXMax_DCTLToneMapper.input!.required!.preset = [["Other"]];
  assert.deepEqual(inspectSetup(graph, registry).models, [{ name: "missing.safetensors", folder: "text_encoders" }]);
});

test("setup reads the registry once and never uploads or submits a job", async (t) => {
  const graph = setupGraph(load("simple"), simple);
  const urls: string[] = [];
  t.mock.method(globalThis, "fetch", async (url: string) => {
    urls.push(url);
    return Response.json(registryFor(graph));
  });
  assert.equal((await checkSetup(graph)).ok, true);
  assert.equal(urls.length, 1);
  assert.ok(urls[0].endsWith("/object_info"));
});

test("offline, HTTP failure and invalid registry responses give an actionable error", async (t) => {
  for (const response of [new Response("offline", { status: 503 }), Response.json(null)]) {
    const mock = t.mock.method(globalThis, "fetch", async () => response);
    const result = await checkSetup(load("mask"));
    assert.equal(result.ok, false);
    assert.match(result.error!, /COMFYUI_URL/);
    mock.mock.restore();
  }
  t.mock.method(globalThis, "fetch", async () => { throw new Error("connection refused"); });
  assert.equal((await checkSetup(load("mask"))).ok, false);
});

test("setup route rejects invalid modes and foreign origins before contacting ComfyUI", async (t) => {
  let requests = 0;
  t.mock.method(globalThis, "fetch", async () => { requests++; throw new Error("Unexpected request"); });
  const request = (body: unknown, origin = "http://127.0.0.1:3000") => new Request("http://127.0.0.1:3000/api/setup", {
    method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  assert.equal((await POST(request({ kind: "../../secret" }))).status, 400);
  assert.equal((await POST(request({ kind: "advanced", pictures: 500 }))).status, 400);
  assert.equal((await POST(request(simple, "https://example.com"))).status, 403);
  assert.equal(requests, 0);
});

test("setup route returns missing packs for the chosen workflow without submitting", async (t) => {
  const graph = setupGraph(load("simple"), simple);
  const registry = registryFor(graph);
  delete registry.H3OneClickSwapPlan;
  t.mock.method(globalThis, "fetch", async () => Response.json(registry));
  const response = await POST(new Request("http://127.0.0.1:3000/api/setup", { method: "POST", body: JSON.stringify(simple) }));
  const result = await response.json();
  assert.equal(response.status, 200);
  assert.equal(result.ok, false);
  assert.equal(result.packs[0].name, "comfyui-h3-oneclick-swap");
});
