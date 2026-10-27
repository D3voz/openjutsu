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

const PIC = "Describe the main subject of this picture in one sentence of about 40 words: what it is (an outfit, a hairstyle, an object or a place), its shape, colours, materials, patterns and details. No preamble, and nothing about anything else in the picture.";
const GEN_OFF = {sampling_mode: "off"};

// ---------------- 1 · UPLOAD ----------------
const note = add("MarkdownNote", "START HERE", [40, 60], {0:
`# One-click object swap (H3)

1. **Source video** - upload the video.
2. **Object Swap Plan** - pick a **mode** and say what:
   - **change**: **target** is what changes (\`hair\`, \`jacket\`, \`car\`, or several: \`hair, top\`), **change_to** what it becomes (\`short bright pink hair\`).
   - **remove**: **target** is what disappears; **change_to** can say what shows instead.
   - **background**: **target** is what stays (\`person\`), **change_to** the new place.
3. **Picture** (optional, change and background) - an outfit, hairstyle, product or place to copy. Bypass the Picture group to go without one.
4. Press **Run**.

Only the tracked area is regenerated (DMAD, 6 steps); everything else, the camera, cuts, motion and soundtrack are kept. The final MP4 lands in **output/h3_oneclick_edit/**.

**change:** with **keep_outline** on (default) the grey shape keeps the real face, hands and arm motion but also the old outline. To let the outline change (long hair to a bob, pants to a skirt), turn it off and delete the two Reference Conditioning ref video inputs (Openjutsu does this for you).
**remove:** delete the two ref video inputs too; the grey shape would come back as a grey object.
**background:** turn on **flip_input** in Grow mask and wire it into the mannequin's mask and size (Openjutsu does this for you).`});
note.size = [500, 860];

const px = 580;
group("Picture 1", px - 20, 0, 360, 960, "#3f789e");
const pic = add("LoadImage", "Picture 1", [px, 60], {image: ""});
pic.size = [320, 420];
const picScale = add("ImageScaleToMaxDimension", "Shrink for the describer", [px, 520], {upscale_method: "area", largest_size: 768});
const picText = add("TextGenerate", "Describe picture 1", [px, 640], {prompt: PIC, max_length: 120, ...GEN_OFF});
picText.size = [320, 260];
link(pic, 0, picScale, "image");
link(picScale, 0, picText, "image");

const vx = 1000;
group("Source video", vx - 20, 0, 420, 1580, "#3f789e");
const video = add("VHS_LoadVideo", "Source video", [vx, 60], {video: "", force_rate: 24, format: "None"});
video.size = [380, 560];
const soundtrack = add("TrimAudioDuration", "Soundtrack (whole video)", [vx, 650], {start_index: 0, duration: 36000});
link(video, "audio", soundtrack, "audio");

// ---------------- 2 · SETTINGS ----------------
const sx = 1460;
group("SETTINGS", sx - 20, 0, 460, 1300, "#a1309b");
const objPlan = add("H3ObjectSwapPlan", "Object Swap Plan (what to change)", [sx, 60], {mode: "change", target: "hair", change_to: "short bright pink hair", seed: 0, control_after_generate: "fixed"});
objPlan.size = [420, 460];
const qwen = add("CLIPLoader", "Describer: Qwen3-VL 8B", [sx, 800], {clip_name: "qwen3vl_8b_int8_convrot.safetensors", type: "stable_diffusion"});
qwen.size = [420, 110];
link(video, "IMAGE", objPlan, "source_frames");
link(pic, 0, objPlan, "picture_1");
link(picText, 0, objPlan, "picture_1_text");
link(qwen, 0, picText, "clip");

// ---------------- 3 · ENGINE ----------------
const ex = 2000;
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
const samText = add("CLIPTextEncode", "SAM: what to change", [ex, 1140], {text: "hair"});
samText.size = [320, 100];
link(unet, 0, lora, "model");
link(lora, 0, attn, "model");
link(attn, 0, shift, "model");
link(sam, 1, samText, "clip");

const lx = ex + 400;
const profile = add("MiniMaxH3GenerationProfile", "Generation Profile", [lx, 60], {scene_continuity: "Hard picture + protected audio", audio_profile: "Generate audio"});
const plan = add("MiniMaxH3ChainPlanModern", "Production Plan (filled by Object Swap Plan)", [lx, 220], {crop: "center", default_steps: 6, segment_crf: 16, run_name: ""});
plan.size = [360, 500];
const timeline = add("MiniMaxH3SourceTimeline", "Source soundtrack", [lx, 760]);
const start = add("MiniMaxH3ChainLoopStart", "Loop Start", [lx, 960]);
const cur = add("MiniMaxH3ChainCurrent", "Current Clip", [lx, 1160]);
link(profile, 0, plan, "chain_policy");
link(objPlan, "plan_json", plan, "plan_json_input");
link(objPlan, "width", plan, "width");
link(objPlan, "height", plan, "height");
link(objPlan, "run_name", plan, "run_name");
link(soundtrack, 0, timeline, "source_audio");
link(plan, 0, start, "plan");
link(timeline, 0, start, "source_timeline");
link(start, "state", cur, "state");

const cx = lx + 420;
const ref = add("MiniMaxH3ReferenceToVideo", "Reference Conditioning", [cx, 60], {ref_image_size: "match"});
ref.size = [360, 300];
const src = add("H3SourceSlice", "Source clip (frames + audio)", [cx, 420], {source_fps: 24, crop: "center"});
const motionAll = add("ImageScaleToMaxDimension", "Motion reference video (~512 px)", [vx, 1340], {upscale_method: "area", largest_size: 512});
const clipStart = add("ComfyMathExpression", "Clip start frame", [cx, 640], {0: "round(a * 24)"});
const motion = add("ImageFromBatch", "Motion reference for this clip", [cx, 740], {batch_index: 0, length: 141});
const samAll = add("ImageScaleToMaxDimension", "SAM video (1008 px, SAM's own size)", [vx, 1460], {upscale_method: "area", largest_size: 1008});
const samClip = add("ImageFromBatch", "SAM frames for this clip", [cx, 820], {batch_index: 0, length: 141});
const noise = add("RandomNoise", "Clip Seed", [cx, 760], {control_after_generate: "fixed"});
const track = add("SAM3_VideoTrack", "SAM 3.1 track it", [cx, 900], {detection_threshold: 0.35, max_objects: 0, detect_interval: 1});
const toMask = add("H3PeopleMask", "Tracked area", [cx, 1060], {headroom: 0, hold_frames: 2, max_people: 0});
const tight = add("H3PeopleMask", "Tracked area, tight (for the grey shape)", [cx, 1260], {headroom: 0, hold_frames: 1, max_people: 0});
const mannequins = add("H3GreyMannequins", "Turn it grey (shape and movement only)", [cx, 1360], {blur: 0.04});
const grow = add("GrowMaskWithBlur", "Grow mask", [cx, 1160], {expand: 20, incremental_expandrate: 0, tapered_corners: true, flip_input: false, blur_radius: 0, lerp_alpha: 1, decay_factor: 1, fill_holes: true});

link(te, 0, ref, "clip"); link(vae, 0, ref, "vae"); link(avae, 0, ref, "audio_vae");
const shotFrames = add("H3ClipShots", "Find this clip's cuts", [cx, 1500], {cut_threshold: 40});
const shotGen = add("TextGenerate", "Write this clip's shot list (Qwen3-VL)", [cx, 1600], {max_length: 500, ...GEN_OFF});
shotGen.size = [360, 200];
const fill = add("H3FillShots", "Insert shot list into prompt", [cx, 1850]);
const promptPrev = add("PreviewAny", "Clip prompt (what H3 gets)", [cx, 1950]);
link(motion, 0, shotFrames, "images");
link(objPlan, "shot_prompt", shotFrames, "shot_prompt");
link(shotFrames, 0, shotGen, "image");
link(qwen, 0, shotGen, "clip");
link(shotFrames, 1, shotGen, "prompt");
link(cur, "prompt", fill, "prompt");
link(shotGen, 0, fill, "shots");
link(fill, 0, promptPrev, "source");
link(fill, 0, ref, "prompt"); link(cur, "width", ref, "width"); link(cur, "height", ref, "height"); link(cur, "length", ref, "length");
link(pic, 0, ref, "ref_images.ref_image_0");
link(cur, "state", src, "state");
link(ref, 1, src, "latent"); link(avae, 0, src, "audio_vae");
link(video, "IMAGE", src, "source_frames"); link(soundtrack, 0, src, "source_audio");
link(video, "IMAGE", motionAll, "image");
link(motionAll, 0, motion, "image");
link(cur, "audio_start", clipStart, "values.a");
link(clipStart, 1, motion, "batch_index");
link(cur, "length", motion, "length");
link(mannequins, 0, ref, "ref_videos.ref_video_0");
link(cur, "source_audio_slice", ref, "ref_video_audios.ref_video_audio_0");
link(cur, "noise_seed", noise, "noise_seed");
link(video, "IMAGE", samAll, "image");
link(samAll, 0, samClip, "image"); link(clipStart, 1, samClip, "batch_index"); link(cur, "length", samClip, "length");
link(samClip, 0, track, "images"); link(sam, 0, track, "model"); link(samText, 0, track, "conditioning");
link(track, 0, toMask, "track_data"); link(track, 0, tight, "track_data");
link(toMask, 0, grow, "mask");
link(motion, 0, mannequins, "images"); link(tight, 0, mannequins, "mask"); link(tight, 1, mannequins, "size");

const mx = cx + 420;
const gridPrev = add("MiniMaxH3ContexMaskGridPreview", "Mask preview", [mx, 60]);
const prevImg = add("PreviewImage", "Mask preview (white = regenerated)", [mx, 420]);
prevImg.size = [360, 300];
const edit = add("MiniMaxH3FantasticVideoEditLatent", "Edit latent (source + mask + audio)", [mx, 760], {grow: 0, keep_audio: true, megapixels: 0});
const masked = add("MiniMaxH3ContexMaskedTarget", "Masked target", [mx, 960], {mask_meaning: "white = generate", audio_mode: "preserve source audio"});
const ctx = add("MiniMaxH3ChainContext", "Apply Clip Context", [mx, 1140]);
link(src, "scene_frames", gridPrev, "image"); link(grow, 0, gridPrev, "mask");
link(gridPrev, "grid_preview", prevImg, "images");
link(vae, 0, edit, "vae"); link(src, "scene_frames", edit, "images"); link(grow, 0, edit, "mask");
link(avae, 0, edit, "audio_vae"); link(src, "scene_audio", edit, "audio");
link(edit, 0, masked, "target_latent"); link(grow, 0, masked, "mask");
link(cur, "state", ctx, "state"); link(ref, 0, ctx, "conditioning"); link(vae, 0, ctx, "vae");
link(masked, 0, ctx, "latent"); link(avae, 0, ctx, "audio_vae");

const kx = mx + 420;
const guider = add("BasicGuider", "Guider", [kx, 60]);
const sched = add("BasicScheduler", "Schedule", [kx, 160], {scheduler: "simple", denoise: 1});
const sca = add("SamplerCustomAdvanced", "Sample Video + Audio", [kx, 320]);
const dec = add("VAEDecode", "Decode Video", [kx, 520]);
const deca = add("VAEDecodeAudio", "Decode Audio", [kx, 620]);
const trim = add("MiniMaxH3LoopTrim", "Trim Overlap", [kx, 720], {trim_frames: 0, fps: 24, match_tail: true, audio_trim_mode: "sync_with_video"});
link(shift, 0, guider, "model"); link(ctx, 0, guider, "conditioning");
link(shift, 0, sched, "model"); link(cur, "steps", sched, "steps");
link(noise, 0, sca, "noise"); link(guider, 0, sca, "guider"); link(sampler, 0, sca, "sampler");
link(sched, 0, sca, "sigmas"); link(ctx, 3, sca, "latent_image");
link(sca, 0, dec, "samples"); link(vae, 0, dec, "vae");
link(sca, 0, deca, "samples"); link(avae, 0, deca, "vae");
link(dec, 0, trim, "images"); link(ctx, 1, trim, "trim_frames"); link(deca, 0, trim, "audio"); link(cur, "state", trim, "state");

const ox = kx + 400;
const save = add("MiniMaxH3ChainSegmentSave", "Save Clip + Checkpoint", [ox, 60]);
const review = add("MiniMaxH3ChainReview", "Review (off = no pause)", [ox, 260], {enabled: false});
const end = add("MiniMaxH3ChainLoopEnd", "Loop End", [ox, 600], {between_scene_cleanup: "off", execution_mode: "recursive"});
const asm = add("MiniMaxH3ChainAssemble", "Final Video", [ox, 800], {audio_source: "source", filename: "edit_%date:yyyy-MM-dd%", copy_to_output: true, output_subfolder: "h3_oneclick_edit"});
link(cur, "state", save, "state"); link(trim, 0, save, "images"); link(sca, 0, save, "sampled_latent");
link(trim, 1, save, "audio"); link(trim, 2, save, "images_with_overlap");
link(cur, "state", review, "state"); link(save, 0, review, "segment"); link(trim, 1, review, "audio");
link(start, "flow", end, "flow"); link(cur, "state", end, "state"); link(trim, 0, end, "images");
link(sca, 0, end, "sampled_latent"); link(review, 0, end, "segment");
link(end, 0, asm, "manifest");

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
