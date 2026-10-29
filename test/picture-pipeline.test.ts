import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { isLink, type ApiGraph } from "../lib/simple.ts";
import { applyFrameRelight, applyRelight, FRAME_RELIGHT_PROMPT, LIGHT_LOOKS, RELIGHT_PROMPT } from "../lib/picture.ts";

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
  applyFrameRelight(graph, LIGHT_LOOKS[7].light);
  assert.ok(String(graph["6"].inputs.value).endsWith(LIGHT_LOOKS[7].light));
  assert.equal(graph["4"], undefined);
  assert.deepEqual(graph["8"].inputs.image, ["2", 0]);
  assert.deepEqual(graph["15"].inputs["images.image0"], ["2", 0]);
  assert.equal(graph["15"].inputs["images.image1"], undefined);
  assert.equal(graph["15"].inputs["resolution.megapixels"], 3);
  assert.deepEqual(graph["19"].inputs.latent_image, ["15", 2]);
});

test("picture pipelines have valid links and no disconnected processing nodes", () => {
  const relit = load("prepare"), frame = load("prepare");
  applyRelight(relit, LIGHT_LOOKS[0].light);
  applyFrameRelight(frame, LIGHT_LOOKS[0].light);
  for (const [stage, graph] of [...["prepare", "motion", "solar"].map((stage) => [stage, load(stage)] as const), ["relight", relit] as const, ["frame relight", frame] as const]) {
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
