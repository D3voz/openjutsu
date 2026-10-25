const g = app.graph;
g.clear();
const made = [];
let curGroup = null;
function add(type, title, pos, widgets = {}, mode = 0) {
  const n = LiteGraph.createNode(type);
  if (!n) throw new Error("no node " + type);
  if (title) n.title = title;
  n.pos = pos;
  g.add(n);
  for (const [k, v] of Object.entries(widgets)) {
    const w = /^\d+$/.test(k) ? n.widgets[+k] : n.widgets.find(w => w.name === k);
    if (!w) throw new Error(type + " has no widget " + k);
    w.value = v;
    w.callback?.(v, app.canvas, n);
  }
  n.mode = mode;
  made.push(n);
  curGroup?.members.push(n);
  return n;
}
function link(a, out, b, inp) {
  const o = typeof out === "number" ? out : a.outputs.findIndex(x => x.name === out);
  const i = b.inputs.findIndex(x => x.name === inp);
  if (o < 0 || i < 0) throw new Error(`link ${a.type}.${out} -> ${b.type}.${inp}`);
  a.connect(o, b, i);
}
function group(title, x, y, w, h, color) {
  const gr = new LiteGraph.LGraphGroup(title);
  gr.pos = [x, y]; gr.size = [w, h];
  if (color) gr.color = color;
  g.add(gr);
  gr.members = [];
  curGroup = gr;
  return gr;
}

const PIC = "Describe the person in this picture for a casting sheet, in one sentence of about 40 words: apparent age and gender, hair, facial hair, skin tone, build, and their complete outfit including footwear. No preamble, no background.";
const PEOPLE = "These are frames from one video, in time order. List the people who appear most, up to four, the person with the most screen time first. Write one numbered line per person: first their role in the video in two to four words, without gender, that stays true in every shot, then \" - \" and how they look, like \"1. the guitarist - tall man with a grey beard in a denim jacket\". Each person appears once. Output only the list.";
const GEN_OFF = {sampling_mode: "off"};

// ---------------- 1 · UPLOAD ----------------
const note = add("MarkdownNote", "START HERE", [40, 60], {0:
`# One-click picture swap with ControlNet (H3)

1. **Picture** - drop a photo of your character in the place they should be.
2. **Source video** - upload the video. Its main person (the one on screen most) becomes the person in the picture, and the whole setting becomes the picture's; the framing, camera movement, motion and soundtrack are kept.
3. Press **Run**.

That's it. The graph then:
- describes your picture and the people in the video, and writes a shot list per clip (Qwen3-VL 8B, local),
- splits the video into ~6 s clips that overlap by 39 frames,
- tracks the main person with SAM 3.1 and makes a depth video of only them (Depth Anything V2),
- regenerates the whole frame from the picture, held to that depth by the H3 Fun ControlNet Union 2.0 (DMAD, 6 steps),
- joins the clips with the original audio.

The final MP4 lands in **output/h3_oneclick_swap/**. Each clip is saved as it finishes, so a crash resumes where it stopped when you press Run again with the same inputs.

Everyone else in the video is dropped: the picture's setting and its people replace the whole background.
**New take:** change **seed**. **Faster test:** set **resolution** to 480p.
**Not singing along:** if the soundtrack has vocals but the person does not sing or talk, turn on **OPTIONAL - No lip-sync** so the new person does not lip-sync the song.`});
note.size = [500, 860];

const pics = [], picTexts = [];
const files = [""];
for (let i = 0; i < 1; i++) {
  const x = 580 + i * 380;
  const title = i === 0 ? "Picture 1" : `OPTIONAL - Picture ${i + 1}`;
  group(title, x - 20, 0, 360, 960, i === 0 ? "#3f789e" : "#88a");
  const load = add("LoadImage", `Picture ${i + 1}`, [x, 60], {image: files[i]}, i < 2 ? 0 : 4);
  load.size = [320, 420];
  const scale = add("ImageScaleToMaxDimension", "Shrink for the describer", [x, 520], {upscale_method: "area", largest_size: 768}, i < 2 ? 0 : 4);
  const gen = add("TextGenerate", `Describe picture ${i + 1}`, [x, 640], {prompt: PIC, max_length: 120, ...GEN_OFF}, i < 2 ? 0 : 4);
  gen.size = [320, 260];
  link(load, 0, scale, "image");
  link(scale, 0, gen, "image");
  pics.push(load); picTexts.push(gen);
}

const vx = 2100;
group("Source video", vx - 20, 0, 420, 1580, "#3f789e");
const video = add("VHS_LoadVideo", "Source video (people get replaced)", [vx, 60], {video: "", force_rate: 24, format: "None"});
video.size = [380, 560];
const soundtrack = add("TrimAudioDuration", "Soundtrack (whole video)", [vx, 650], {start_index: 0, duration: 36000});
link(video, "audio", soundtrack, "audio");
const nth = add("VHS_SelectEveryNthImage", "One frame every 2 s", [vx, 700], {select_every_nth: 48, skip_first_images: 24});
const first20 = add("ImageFromBatch", "At most 20 frames", [vx, 800], {batch_index: 0, length: 20});
const vscale = add("ImageScaleToMaxDimension", "Shrink for the describer", [vx, 920], {upscale_method: "area", largest_size: 640});
const people = add("TextGenerate", "Who is in the video", [vx, 1020], {prompt: PEOPLE, max_length: 160, ...GEN_OFF});
people.size = [380, 240];
link(video, "IMAGE", nth, "images");
link(nth, 0, first20, "image");
link(first20, 0, vscale, "image");
link(vscale, 0, people, "image");

// ---------------- 2 · SETTINGS ----------------
const sx = 2560;
group("SETTINGS (optional)", sx - 20, 0, 460, 1300, "#a1309b");
const swapPlan = add("H3PictureSwapPlan", "Swap Plan (roles, seed, size)", [sx, 60], {seed: 0, control_after_generate: "fixed"});
swapPlan.size = [420, 420];
const bypass = add("Fast Groups Bypasser (rgthree)", "ON / OFF SWITCHES", [sx, 560]);
Object.assign(bypass.properties, {matchTitle: "OPTIONAL", sort: "position"});
bypass.size = [420, 160];
const qwen = add("CLIPLoader", "Describer: Qwen3-VL 8B", [sx, 800], {clip_name: "qwen3vl_8b_int8_convrot.safetensors", type: "stable_diffusion"});
qwen.size = [420, 110];
const qwenFree = add("Note", "", [sx, 960], {0: "The describer reads your pictures and the video once (about 40 s), then writes a shot list for every clip (about 20 s each)."});
qwenFree.size = [420, 80];

link(video, "IMAGE", swapPlan, "source_frames");
pics.forEach((p, i) => link(p, 0, swapPlan, `picture_${i + 1}`));
picTexts.forEach((t, i) => link(t, 0, swapPlan, `picture_${i + 1}_text`));
link(people, 0, swapPlan, "video_people");
for (const t of [...picTexts, people]) link(qwen, 0, t, "clip");

// ---------------- 3 · ENGINE ----------------
const ex = 3100;
group("ENGINE - no need to touch", ex - 20, 0, 2900, 1900, "#444");
const unet = add("UNETLoader", "H3 Diffusion Model", [ex, 60], {unet_name: "minimax_h3_ref2va_pruned_int8_convrot.safetensors"});
const lora = add("LoraLoaderModelOnly", "DMAD LoRA", [ex, 200], {lora_name: "minimax_h3_DMAD_4step_full_lora_avg_rank_39_bf16.safetensors", strength_model: 1.0});
const attn = add("ModelAttentionBackend", "Comfy Kitchen Attention", [ex, 340], {0: "comfy kitchen attention"});
const shift = add("MiniMaxH3SigmaShift", "Sigma Shift", [ex, 440], {0: 12, 1: 2});
const te = add("CLIPLoader", "H3 Text Encoder", [ex, 560], {clip_name: "qwen3vl_32b_minimax_h3_int4_convrot.safetensors", type: "minimax"});
const vae = add("VAELoader", "Video VAE", [ex, 700], {vae_name: "minimax_h3_video_vae_int8_convrot.safetensors"});
const avae = add("VAELoader", "Audio VAE", [ex, 800], {vae_name: "minimax_h3_audio_vae_fp32.safetensors"});
const sampler = add("KSamplerSelect", "Sampler", [ex, 900], {sampler_name: "euler"});
const sam = add("CheckpointLoaderSimple", "SAM 3.1", [ex, 1000], {ckpt_name: "sam3.1_multiplex_fp16.safetensors"});
const samText = add("CLIPTextEncode", "SAM: what to replace", [ex, 1140], {text: "person"});
samText.size = [320, 100];
link(unet, 0, lora, "model");
link(lora, 0, attn, "model");
link(attn, 0, shift, "model");
link(sam, 1, samText, "clip");

const lx = ex + 400;
const profile = add("MiniMaxH3GenerationProfile", "Generation Profile", [lx, 60], {scene_continuity: "Hard picture + protected audio", audio_profile: "Generate audio"});
const plan = add("MiniMaxH3ChainPlanModern", "Production Plan (filled by Swap Plan)", [lx, 220], {crop: "center", default_steps: 6, segment_crf: 16, run_name: ""});
plan.size = [360, 500];
const timeline = add("MiniMaxH3SourceTimeline", "Source soundtrack", [lx, 760]);
const start = add("MiniMaxH3ChainLoopStart", "Loop Start", [lx, 960]);
const cur = add("MiniMaxH3ChainCurrent", "Current Clip", [lx, 1160]);
link(profile, 0, plan, "chain_policy");
link(swapPlan, "plan_json", plan, "plan_json_input");
link(swapPlan, "width", plan, "width");
link(swapPlan, "height", plan, "height");
link(swapPlan, "run_name", plan, "run_name");
link(soundtrack, 0, timeline, "source_audio");
link(plan, 0, start, "plan");
link(timeline, 0, start, "source_timeline");
link(start, "state", cur, "state");

const cx = lx + 420;
const ref = add("MiniMaxH3ReferenceToVideo", "Reference Conditioning", [cx, 60], {ref_image_size: "match"});
ref.size = [360, 300];
const src = add("MiniMaxH3ContexLoopSourceSlice", "Source clip (frames + audio)", [cx, 420], {source_fps: 24, crop: "center"});
const motionAll = add("ImageScaleToMaxDimension", "Shot list frames (~512 px)", [vx, 1340], {upscale_method: "area", largest_size: 512});
const clipStart = add("ComfyMathExpression", "Clip start frame", [cx, 640], {0: "round(a * 24)"});
const motion = add("ImageFromBatch", "Shot list frames for this clip", [cx, 740], {batch_index: 0, length: 141});
const samAll = add("ImageScaleToMaxDimension", "SAM video (1008 px, SAM's own size)", [vx, 1460], {upscale_method: "area", largest_size: 1008});
const samClip = add("ImageFromBatch", "SAM frames for this clip", [cx, 820], {batch_index: 0, length: 141});
const noise = add("RandomNoise", "Clip Seed", [cx, 760], {control_after_generate: "fixed"});
const track = add("SAM3_VideoTrack", "SAM 3.1 track every person", [cx, 900], {detection_threshold: 0.35, max_objects: 0, detect_interval: 1});
const body = add("H3PeopleMask", "Main person, no headroom (for the depth)", [cx, 1060], {headroom: 0, hold_frames: 1, max_people: 1});
const bodyImg = add("MaskToImage", "Main person mask as image", [cx, 1160]);
const depth = add("DepthAnythingV2Preprocessor", "Depth of this clip (Depth Anything V2)", [cx, 1260], {ckpt_name: "depth_anything_v2_vitb.pth", resolution: 512});
const personDepth = add("ImageBlend", "Depth of the main person only (control video)", [cx, 1360], {blend_factor: 1.0, blend_mode: "multiply"});
const whole = add("SolidMask", "Whole frame (regenerate everything)", [cx, 1460], {value: 1.0});

link(te, 0, ref, "clip"); link(vae, 0, ref, "vae"); link(avae, 0, ref, "audio_vae");
const shotFrames = add("H3ClipShots", "Find this clip's cuts", [cx, 1500], {cut_threshold: 40});
const shotGen = add("TextGenerate", "Write this clip's shot list (Qwen3-VL)", [cx, 1600], {max_length: 500, ...GEN_OFF});
shotGen.size = [360, 200];
const fill = add("H3FillShots", "Insert shot list into prompt", [cx, 1850]);
const promptPrev = add("PreviewAny", "Clip prompt (what H3 gets)", [cx, 1950]);
link(motion, 0, shotFrames, "images");
link(swapPlan, "shot_prompt", shotFrames, "shot_prompt");
link(shotFrames, 0, shotGen, "image");
link(qwen, 0, shotGen, "clip");
link(shotFrames, 1, shotGen, "prompt");
link(cur, "prompt", fill, "prompt");
link(shotGen, 0, fill, "shots");
link(fill, 0, promptPrev, "source");
link(fill, 0, ref, "prompt"); link(cur, "width", ref, "width"); link(cur, "height", ref, "height"); link(cur, "length", ref, "length");
link(pics[0], 0, ref, "ref_images.ref_image_0");
link(cur, "state", src, "state");
link(ref, 1, src, "latent"); link(avae, 0, src, "audio_vae");
link(video, "IMAGE", src, "source_frames");
link(video, "IMAGE", motionAll, "image");
link(motionAll, 0, motion, "image");
link(cur, "audio_start", clipStart, "values.a");
link(clipStart, 1, motion, "batch_index");
link(cur, "length", motion, "length");
link(cur, "width", whole, "width"); link(cur, "height", whole, "height");

link(cur, "noise_seed", noise, "noise_seed");
link(video, "IMAGE", samAll, "image");
link(samAll, 0, samClip, "image"); link(clipStart, 1, samClip, "batch_index"); link(cur, "length", samClip, "length");
link(samClip, 0, track, "images"); link(sam, 0, track, "model"); link(samText, 0, track, "conditioning");
link(track, 0, body, "track_data");
link(body, 0, bodyImg, "mask");
link(samClip, 0, depth, "image");
link(depth, 0, personDepth, "image1"); link(bodyImg, 0, personDepth, "image2");

const mx = cx + 420;
const funPatch = add("ModelPatchLoader", "H3 Fun ControlNet Union 2.0", [mx, 60], {name: "minimax_h3_fun_controlnet_union_2.0_pruned_int8_convrot.safetensors"});
const fun = add("MiniMaxH3FunControlNetApply", "Apply ControlNet (person depth)", [mx, 180], {strength: 1.0});
const depthPrev = add("PreviewImage", "Control video (person depth)", [mx, 420]);
depthPrev.size = [360, 300];
const edit = add("MiniMaxH3FantasticVideoEditLatent", "Edit latent (source + mask + audio)", [mx, 760], {grow: 0, keep_audio: true, megapixels: 0});
const masked = add("MiniMaxH3ContexMaskedTarget", "Masked target", [mx, 960], {mask_meaning: "white = generate", audio_mode: "preserve source audio"});
const ctx = add("MiniMaxH3ChainContext", "Apply Clip Context", [mx, 1140]);
link(shift, 0, fun, "model"); link(funPatch, 0, fun, "model_patch"); link(vae, 0, fun, "vae"); link(personDepth, 0, fun, "control_video");
link(personDepth, 0, depthPrev, "images");
link(vae, 0, edit, "vae"); link(src, "scene_frames", edit, "images"); link(whole, 0, edit, "mask");
link(avae, 0, edit, "audio_vae"); link(src, "scene_audio", edit, "audio");
link(edit, 0, masked, "target_latent"); link(whole, 0, masked, "mask");
link(cur, "state", ctx, "state"); link(ref, 0, ctx, "conditioning"); link(vae, 0, ctx, "vae");
link(masked, 0, ctx, "latent"); link(avae, 0, ctx, "audio_vae");

const kx = mx + 420;
const guider = add("BasicGuider", "Guider", [kx, 60]);
const sched = add("BasicScheduler", "Schedule", [kx, 160], {scheduler: "simple", denoise: 1});
const sca = add("SamplerCustomAdvanced", "Sample Video + Audio", [kx, 320]);
const dec = add("VAEDecode", "Decode Video", [kx, 520]);
const deca = add("VAEDecodeAudio", "Decode Audio", [kx, 620]);
const trim = add("MiniMaxH3LoopTrim", "Trim Overlap", [kx, 720], {trim_frames: 0, fps: 24, match_tail: true, audio_trim_mode: "sync_with_video"});
// With the ControlNet on, H3 draws the first frame or two as the picture itself; later clips trim them with their overlap.
const frame2 = add("ImageFromBatch", "Frame 2", [kx, 920], {batch_index: 2, length: 1});
const twice = add("RepeatImageBatch", "Frame 2 as frames 0 and 1 (they show the picture)", [kx, 1020], {amount: 2});
const rest = add("ImageFromBatch", "Frame 2 to the end", [kx, 1120], {batch_index: 2, length: 4096});
const held = add("BatchImagesNode", "Clip with frames 0 and 1 replaced", [kx, 1220]);
link(fun, 0, guider, "model"); link(ctx, 0, guider, "conditioning");
link(fun, 0, sched, "model"); link(cur, "steps", sched, "steps");
link(noise, 0, sca, "noise"); link(guider, 0, sca, "guider"); link(sampler, 0, sca, "sampler");
link(sched, 0, sca, "sigmas"); link(ctx, 3, sca, "latent_image");
link(sca, 0, dec, "samples"); link(vae, 0, dec, "vae");
link(sca, 0, deca, "samples"); link(avae, 0, deca, "vae");
link(dec, 0, frame2, "image"); link(frame2, 0, twice, "image"); link(dec, 0, rest, "image");
link(twice, 0, held, "images.image0"); link(rest, 0, held, "images.image1");
link(held, 0, trim, "images"); link(ctx, 1, trim, "trim_frames"); link(deca, 0, trim, "audio"); link(cur, "state", trim, "state");

const ox = kx + 400;
const save = add("MiniMaxH3ChainSegmentSave", "Save Clip + Checkpoint", [ox, 60]);
const review = add("MiniMaxH3ChainReview", "Review (off = no pause)", [ox, 260], {enabled: false});
const end = add("MiniMaxH3ChainLoopEnd", "Loop End", [ox, 600], {between_scene_cleanup: "off", execution_mode: "recursive"});
const asm = add("MiniMaxH3ChainAssemble", "Final Video", [ox, 800], {audio_source: "source", filename: "swap_%date:yyyy-MM-dd%", copy_to_output: true, output_subfolder: "h3_oneclick_swap"});
link(cur, "state", save, "state"); link(trim, 0, save, "images"); link(sca, 0, save, "sampled_latent");
link(trim, 1, save, "audio"); link(trim, 2, save, "images_with_overlap");
link(cur, "state", review, "state"); link(save, 0, review, "segment"); link(trim, 1, review, "audio");
link(start, "flow", end, "flow"); link(cur, "state", end, "state"); link(trim, 0, end, "images");
link(sca, 0, end, "sampled_latent"); link(review, 0, end, "segment");
link(end, 0, asm, "manifest");

// optional pieces added last keep the node ids above stable for the Openjutsu export
group("OPTIONAL - No lip-sync (they don't sing along)", 40, 1000, 460, 560, "#88a");
const noLip = add("PrimitiveBoolean", "No lip-sync in the prompt", [100, 1060], {value: true}, 4);
const muteClip = add("AudioAdjustVolume", "Mute the clip audio H3 hears", [100, 1160], {volume: -100}, 4);
const muteRef = add("AudioAdjustVolume", "Mute the reference audio H3 hears", [100, 1260], {volume: -100}, 4);
link(noLip, 0, swapPlan, "no_lip_sync");
link(soundtrack, 0, muteClip, "audio"); link(muteClip, 0, src, "source_audio");
link(cur, "source_audio_slice", muteRef, "audio"); link(muteRef, 0, ref, "ref_audios.ref_audio_0");

// stack each column by real node height, then fit groups around their nodes
const cols = {};
for (const n of made) (cols[n.pos[0]] ??= []).push(n);
for (const col of Object.values(cols)) {
  col.sort((a, b) => a.pos[1] - b.pos[1]);
  let y = col[0].pos[1];
  for (const n of col) { n.pos[1] = y; y += n.size[1] + LiteGraph.NODE_TITLE_HEIGHT + 30; }
}
for (const gr of g._groups) {
  const inside = gr.members;
  if (!inside.length) continue;
  const bottom = Math.max(...inside.map(n => n.pos[1] + n.size[1]));
  const right = Math.max(...inside.map(n => n.pos[0] + n.size[0]));
  gr.size = [Math.max(gr.size[0], right - gr.pos[0] + 20), bottom - gr.pos[1] + 30];
}
app.graph.setDirtyCanvas(true, true);
JSON.stringify({nodes: g._nodes.length, links: Object.keys(g.links).length ?? g.links.size});
