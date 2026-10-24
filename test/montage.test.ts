import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PEOPLE_NODES, TRACKS, TRACKS_FILE, appearances, peopleRoles, pruneMontage, renderLabels, type Track } from "../lib/montage.ts";
import { PLAN, nodeByTitle, type AdvancedSettings } from "../lib/advanced.ts";
import { isLink, type ApiGraph } from "../lib/simple.ts";
import { DEFAULT_MODEL, applyModel } from "../lib/model.ts";

const track = (id: number, role: number, start: number, end: number, on: [number, number][], area = 0.1): Track => ({ track: id, start, end, role, on, area, image: `img${id}` });

test("appearances are listed in order and start as their photo unless brief or small", () => {
  const list = appearances({
    frames: 300, tracks: "h3_montage_people_00001_.npz", people: [
      track(1, 2, 0, 160, [[104, 160]]),
      track(0, 1, 0, 160, [[0, 110]]),
      track(3, 1, 0, 160, [[138, 158]], 0.006), // the dancer far off behind the filmer
      track(4, 2, 160, 300, [[160, 166]]), // a flicker
      track(5, 0, 160, 300, [[170, 175]], 0.005), // a small unlabelled flicker: not listed
      track(7, 0, 160, 300, [[176, 180]], 0.06), // a big one may be part of someone: listed, kept
      track(6, 0, 160, 300, [[170, 300]]), // nobody Qwen knew
    ],
  });
  assert.deepEqual(list.map((a) => [a.track, a.role, a.pick, a.small]), [[0, 1, 1, false], [1, 2, 2, false], [3, 1, 0, true], [4, 2, 0, false], [6, 0, 0, false], [7, 0, 0, false]]);
});

test("a person whose track broke is the same photo in every appearance", () => {
  // SAM lost the woman at 174 and found her again as a new track
  const list = appearances({ frames: 216, tracks: null, people: [track(6, 3, 131, 174, [[131, 174]], 0.8), track(9, 3, 174, 216, [[174, 216]], 0.9)] });
  assert.deepEqual(renderLabels(list), [{ track: 6, start: 131, end: 174, role: 3 }, { track: 9, start: 174, end: 216, role: 3 }]);
});

test("the render gets the picks, keeping each appearance's frames, and leaves out kept people", () => {
  const list = appearances({ frames: 200, tracks: null, people: [track(0, 1, 0, 100, [[0, 90]]), track(1, 2, 0, 100, [[60, 100]])] });
  list[1].pick = 1;
  list[0].pick = 0;
  assert.deepEqual(renderLabels(list), [{ track: 1, start: 0, end: 100, role: 1 }]);
});

test("the montage export loads the tracks Find people saved and takes the picks", () => {
  const source: ApiGraph = JSON.parse(readFileSync(new URL("../workflows/montage.api.json", import.meta.url), "utf8"));
  const settings: AdvancedSettings = { roles: ["the dancer - white polo", "the filmer - bucket hat"], resolution: "480p", motion: 512, hatFix: false, noLipSync: false, margin: "normal", seed: 3, clipSeconds: 6 };
  const labels = [{ track: 0, start: 0, end: 107, role: 2 }];
  const graph = pruneMontage(source, 2, settings, "h3_montage_people_00003_.npz", labels);
  const dangling = Object.entries(graph).flatMap(([id, node]) => Object.entries(node.inputs).filter(([, v]) => isLink(v) && !graph[v[0]]).map(([name]) => `${id}.${name}`));
  assert.deepEqual(dangling, []);
  const plan = graph[nodeByTitle(graph, PLAN)];
  assert.equal(plan.class_type, "H3MontagePlan");
  assert.deepEqual(JSON.parse(String(plan.inputs.labels)), labels);
  assert.equal(plan.inputs.roles, "the dancer - white polo\nthe filmer - bucket hat");
  assert.ok(!("picture_3" in plan.inputs) && isLink(plan.inputs.picture_2));
  const tracks = graph[nodeByTitle(graph, TRACKS)];
  assert.equal(tracks.inputs.file, "h3_montage_people_00003_.npz");
  assert.deepEqual(plan.inputs.track_data, [nodeByTitle(graph, TRACKS), 0]);
  applyModel(graph, { ...DEFAULT_MODEL, steps: 4 });
  assert.equal(plan.inputs.steps, 4);
  const passes = Object.values(graph).filter((node) => node.class_type === "H3MontagePass");
  assert.deepEqual(passes.map((node) => node.inputs.pass_number), [1, 2]);
  assert.ok(passes.every((node) => isLink(node.inputs.picture_2) && !("picture_3" in node.inputs)));
  // no person tracking at render time: the masks are the saved ones
  assert.ok(!Object.values(graph).some((node) => node.class_type === "SAM3_VideoTrack" && /every person/.test(node._meta?.title ?? "")));
  // the hats and faces SAM finds per clip line up with the saved tracks: both at the same 1008 px frames
  const people: ApiGraph = JSON.parse(readFileSync(new URL("../workflows/people.api.json", import.meta.url), "utf8"));
  const find = Object.values(people).find((node) => node.class_type === "SAM3_VideoTrack")!;
  const size = (g: ApiGraph, title: RegExp) => Object.values(g).find((node) => node.class_type === "ImageScaleToMaxDimension" && title.test(node._meta?.title ?? ""))!.inputs.largest_size;
  assert.equal(size(graph, /^SAM video/), people[(find.inputs.images as [string, number])[0]].inputs.largest_size);
});

test("only files Find people saves pass as tracks", () => {
  assert.ok(TRACKS_FILE.test("h3_montage_people_00012_.npz"));
  for (const bad of ["../h3_montage_people_00012_.npz", "h3_montage_people_00012_.json", "x.npz", "h3_montage_people_1_.npz/.."]) assert.ok(!TRACKS_FILE.test(bad), bad);
});

test("Find people gets the roles as the subjects to match", () => {
  const graph: ApiGraph = JSON.parse(readFileSync(new URL("../workflows/people.api.json", import.meta.url), "utf8"));
  assert.equal(graph[PEOPLE_NODES.video].class_type, "VHS_LoadVideo");
  assert.equal(graph[PEOPLE_NODES.crops].class_type, "H3TrackCrops");
  assert.equal(peopleRoles(["the dancer -  white polo", "the filmer - bucket hat"]), "<Subject 1>: the dancer - white polo\n<Subject 2>: the filmer - bucket hat");
});
