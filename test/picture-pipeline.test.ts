import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { isLink, type ApiGraph } from "../lib/simple.ts";
import { applyDescription, applyFrameRelight, applyRelight, FRAME_RELIGHT_PROMPT, LIGHT_LOOKS, RELIGHT_PROMPT } from "../lib/picture.ts";

const load = (stage: string): ApiGraph => JSON.parse(readFileSync(new URL(`../workflows/picture/from_picture_${stage}_flux3.api.json`, import.meta.url), "utf8"));
const prompt = "change <image 1> character pose follow the  <image 2> pose. keep the final image as same body cut as <image 2> . do not change the background of <image 1> and do not add anything extra in <image 1>.";

test("the first-frame editor receives the character first and the raw video frame second, without pose preprocessors", () => {
  const graph = load("prepare");
  assert.equal(graph["1"].inputs.frame_load_cap, 1);
  assert.deepEqual(graph["2"].inputs, { image: ["1", 0], batch_index: 0, length: 1 });
  assert.deepEqual(graph["5"].inputs.image, ["4", 0]);
  assert.deepEqual(graph["3"].inputs.image, ["2", 0]);
  const references = graph["15"];
  const keys = ["images.image0", "images.image1"];
  assert.deepEqual(references.inputs[keys[0]], ["5", 0]);
  assert.deepEqual(references.inputs[keys[1]], ["3", 0]);
  assert.equal(graph["6"].inputs.value, prompt);
  assert.deepEqual(graph["23"].inputs.prompt, ["6", 0]);
  assert.deepEqual(graph["13"].inputs.text, ["23", 0]);
  assert.deepEqual(graph["7"].inputs, { image1: ["5", 0], image2: ["3", 0] });
  assert.deepEqual(graph["21"].inputs.images, ["20", 0]);
  assert.ok(!Object.values(graph).some((node) => /DW|Pose|Metric3D|MiniMax/.test(node.class_type)));
});

test("the motion workflow consumes the prepared picture directly and resizes normals to the H3 canvas", () => {
  const graph = load("motion");
  assert.equal(graph["1"].inputs.frame_load_cap, 141);
  assert.deepEqual(graph["56"].inputs["ref_images.ref_image_0"], ["20", 0]);
  assert.deepEqual(graph["56"].inputs["ref_videos.ref_video_0"], ["33", 0]);
  assert.equal(graph["32"].class_type, "Metric3D-NormalMapPreprocessor");
  assert.equal(graph["33"].inputs.width, graph["56"].inputs.width);
  assert.equal(graph["33"].inputs.height, graph["56"].inputs.height);
  assert.equal(graph["56"].inputs.length, graph["1"].inputs.frame_load_cap);
  assert.deepEqual(graph["30"].inputs.any_input, ["20", 0]);
  assert.deepEqual(graph["30"].inputs.image_pass, ["1", 0]);
  assert.equal(graph["30"].inputs.unload_all_models, true);
  assert.deepEqual(graph["31"].inputs.image, ["30", 1]);
  assert.deepEqual(graph["63"].inputs.audio, ["36", 0]);
  assert.ok(!Object.values(graph).some((node) => /ControlNet|DWPreprocessor|ChainLoop/.test(node.class_type)));
});

test("relight gives FLUX only the character picture at 3 MP on the frame's shape and writes the light into the request", () => {
  const graph = load("prepare");
  graph["6"].inputs.value = RELIGHT_PROMPT;
  applyRelight(graph, LIGHT_LOOKS[1].light);
  assert.ok(String(graph["6"].inputs.value).endsWith(LIGHT_LOOKS[1].light)); assert.ok(!String(graph["6"].inputs.value).includes("{look}"));
  assert.equal(graph["15"].inputs["images.image1"], undefined);
  assert.deepEqual(graph["15"].inputs["images.image0"], ["4", 0]);
  assert.equal(graph["15"].inputs["resolution.megapixels"], 3);
  assert.deepEqual(graph["7"].inputs, { "images.image0": ["4", 0], "images.image1": ["3", 0] });
  assert.deepEqual(graph["19"].inputs.latent_image, ["relight_latent", 0]);
  assert.deepEqual(graph["relight_canvas"].inputs.image, ["3", 0]);
  const custom = load("prepare");
  applyRelight(custom, "Light the new photo with candles.");
  assert.ok(String(custom["6"].inputs.value).endsWith(" Light the new photo with candles."));
});

test("relighting the video's own person gives FLUX and the upsampler only the raw frame", () => {
  const graph = load("prepare");
  graph["6"].inputs.value = FRAME_RELIGHT_PROMPT;
  applyFrameRelight(graph, LIGHT_LOOKS[7].light, 1);
  assert.ok(String(graph["6"].inputs.value).endsWith(LIGHT_LOOKS[7].light));
  assert.equal(graph["4"], undefined);
  assert.deepEqual(graph["8"].inputs.image, ["2", 0]);
  assert.deepEqual(graph["15"].inputs["images.image0"], ["2", 0]);
  assert.equal(graph["15"].inputs["images.image1"], undefined);
  assert.equal(graph["15"].inputs["resolution.megapixels"], 3);
  assert.deepEqual(graph["19"].inputs.latent_image, ["15", 2]);
  const kept = load("prepare");
  applyFrameRelight(kept, LIGHT_LOOKS[0].light, 0.9);
  assert.equal(kept["19"].inputs.denoise, 0.9);
  assert.deepEqual(kept["19"].inputs.latent_image, ["relight_start", 0]);
  assert.deepEqual(kept["relight_frame"].inputs.image, ["2", 0]);
});

test("the describer watches the source part, then rewrites its text against the prepared picture's description", () => {
  const graph = load("describe");
  assert.deepEqual(graph["70"].inputs.images, ["1", 0]); assert.equal(graph["70"].inputs.select_every_nth, 12);
  assert.deepEqual(graph["73"].inputs.image, ["71", 0]); assert.deepEqual(graph["73"].inputs.clip, ["72", 0]);
  assert.deepEqual(graph["80"].inputs.image, ["75", 0]); assert.deepEqual(graph["75"].inputs.image, ["74", 0]);
  assert.deepEqual(graph["82"].inputs.string_a, ["81", 0]); assert.deepEqual(graph["82"].inputs.string_b, ["76", 0]);
  assert.deepEqual(graph["81"].inputs.string_b, ["80", 0]); assert.deepEqual(graph["76"].inputs.string_b, ["73", 0]);
  assert.equal(graph["78"].inputs.image, undefined); assert.deepEqual(graph["78"].inputs.prompt, ["82", 0]);
  assert.deepEqual(graph["79"].inputs.source, ["78", 0]);
  assert.ok(!Object.values(graph).some((node) => /MiniMax|Metric3D|Solar|KSampler/.test(node.class_type)));
});

test("the description opens the detailed description of both renderers", () => {
  for (const stage of ["motion", "solar"]) {
    const graph = load(stage);
    applyDescription(graph, "  The character lifts a white cup\nand smiles.  ");
    const prompt = String(graph["56"].inputs.prompt);
    assert.ok(prompt.includes(stage === "solar" ? "[Shot 1] The shot begins from <Video 2>. The character lifts a white cup and smiles. The same character"
      : "detailed_description:\nThe character lifts a white cup and smiles. Follow the motion guide"), stage);
    const empty = load(stage), before = empty["56"].inputs.prompt;
    applyDescription(empty, " \n ");
    assert.equal(empty["56"].inputs.prompt, before);
  }
});

test("picture pipelines have valid links and no disconnected processing nodes", () => {
  const relit = load("prepare"), frame = load("prepare");
  applyRelight(relit, LIGHT_LOOKS[0].light);
  applyFrameRelight(frame, LIGHT_LOOKS[0].light, 0.9);
  for (const [stage, graph] of [...["prepare", "motion", "solar", "describe"].map((stage) => [stage, load(stage)] as const), ["relight", relit] as const, ["frame relight", frame] as const]) {
    const reached = new Set<string>();
    function visit(id: string) {
      if (reached.has(id)) return;
      reached.add(id);
      for (const value of Object.values(graph[id].inputs)) if (isLink(value)) {
        assert.ok(graph[value[0]], `${stage}: missing ${value[0]}`);
        visit(value[0]);
      }
    }
    for (const [id, node] of Object.entries(graph)) if (["SaveImage", "PreviewImage", "PreviewAny", "VHS_VideoCombine"].includes(node.class_type)) visit(id);
    assert.deepEqual([...reached].sort(), Object.keys(graph).sort(), `${stage}: disconnected node`);
  }
});
