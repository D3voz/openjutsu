"""Build raw-frame image editing and normal-guided H3 workflows."""
import argparse
import copy
import json
from pathlib import Path


EDIT_PROMPT = "change <image 1> character pose follow the  <image 2> pose. keep the final image as same body cut as <image 2> . do not change the background of <image 1> and do not add anything extra in <image 1>."
EDIT_SYSTEM = """You are an image-editing prompt upsampler. The attached images are ordered: image 1 is the character image and image 2 is the raw first frame from a video. Expand the user's request into one precise editing instruction. Keep every requested constraint. Use gender-neutral wording such as 'the character'; do not add a fixed gender.

Image 1 supplies the identity, hairstyle, complete outfit, background and lighting. Image 2 supplies only the starting body pose, head orientation, arm positions, hand positions, leg positions, camera perspective, relative character size, position within the frame and body cut. Describe those pose and framing changes concretely from image 2. Replace the original pose of image 1 instead of retaining it. Keep the character and the background of image 1; do not copy the identity, hairstyle, clothes, props, setting or colors of image 2, and do not add extra objects. Describe the intended still image, not later video movements. Output only one English editing instruction, without Markdown or explanation."""
VIDEO_PROMPT = """subject_definitions:
<Picture 1> defines the character, outfit, background, colors, materials and lighting throughout the output.
<Video 1> is a false-color surface-normal motion guide at 24 fps. Its colors describe surface orientation, not the appearance of the final video. Use the moving character's geometry, body pose, arm and leg movements, head direction, framing and timing as the motion reference.
<Audio 1> is the original synchronized soundtrack.

summary:
[video editing + reference generation + audio reuse] Animate the character from <Picture 1> with the performance and framing of the character in <Video 1>. Keep the identity, outfit, background and lighting of <Picture 1>. The picture is the appearance reference; the normal-map video is the motion reference.

detailed_description:
Follow the motion guide's poses and gestures at the corresponding moments, through the last frame. Match its relative character size, camera perspective and any camera movement. Keep the picture's environment coherent throughout the performance. Do not copy the normal-map colors or replace the picture's setting with the source video's setting. Do not hold the reference picture's starting pose as the guide moves. Keep lighting and contact shadows consistent with the picture. Match visible speech to <Audio 1> when present.

overall_soundscape:
Reuse <Audio 1> unchanged. Add no new voices, music or sound effects."""


SOLAR_PROMPT = """subject_definitions:
<Video 1> is a false-color surface-normal motion guide at 24 fps. It supplies the moving subject's body geometry, poses, gestures, head direction and timing.
<Video 2> is the first frame of the target shot, held still. It supplies the character, outfit, background, materials, colors and lighting.

summary:
[keyframe completion + reference generation] Begin from <Video 2> and animate its character with the frame-by-frame poses and motion of <Video 1>. Keep the identity, clothing and environment of <Video 2> throughout.

retention_analysis:
<Video 1> (frame-by-frame subject pose, motion and framing): attribute_transfer - follow the subject's body position, size, gestures and head direction. Its false colors, source appearance, labels and graphics are not shown.
<Video 2> (first frame): fully_preserved - preserve its character, outfit, background, colors, materials and lighting as the character moves.

detailed_description:
[Shot 1] The shot begins from <Video 2>. The same character performs the changing poses, hand gestures and head movements from <Video 1>, through the final frame. Match the reference performance's timing, framing and camera motion. Keep the character's face, hair and complete outfit consistent, with coherent arms, hands and fingers. Preserve the setting and lighting from <Video 2>, including natural contact shadows. Do not hold the initial pose as the motion guide changes. Do not copy the normal-map colors, source outfit or source setting. Do not add text, comparison dividers, labels or slider graphics.

overall_soundscape:
N/A

non_diegetic_music:
N/A"""


DESCRIBE_VIDEO = "These are frames from one video clip, in time order, two per second. Describe what happens, for a video model that redoes the clip with a new person. Write one paragraph of 80 to 180 words in the present tense, calling the main person \"the person\". Go through the frames in order and name every change: what they do with their body, hands, head and mouth, such as blowing, eating, drinking, speaking, singing or laughing; every object they hold, use or touch, with its shape, colour and material, and what happens to it, such as candles going out or a lid opening; their facial expression and when it changes; where they look; what any other people do; and how the camera moves or cuts. Do not describe the person's hair, face, body or clothing, except a movement of hair or clothing, such as hair swinging or a hand fixing a collar. Say nothing about the light, its colours or the colour grade. No preamble, lists or Markdown."
DESCRIBE_PICTURE = "Describe this picture for a casting sheet in two sentences: first the person's hair, outfit and accessories, then the setting behind them. Say nothing about their pose, hands, expression or the light. No preamble."
REWRITE_SYSTEM = """You rewrite a video description for a new character. The user gives the new character and setting, then a description of what happens in the original video. The new video keeps the new character's looks and setting and the original video's actions. Rewrite the description as one paragraph of 60 to 160 words in the present tense, in the same time order, calling the main person "the character".

Keep every action, gesture, head turn, gaze direction, expression change, mouth action, speech or singing, and camera movement. Keep every object the person holds, uses or touches, with its shape, colour and material and what happens to it.
Fit everything tied to looks to the new character: never repeat the original person's hair, face, body or clothing; drop movements of hair, clothing or accessories the new character does not have, and describe the ones they do have as the new character's description gives them. Do not otherwise describe the new character's looks.
Move the action into the new setting: drop or replace furniture, walls, rooms, stages, landscapes and places from the description that the new setting does not have, and never describe the original setting. Keep objects the person uses.
Refer to other people only by what they do, such as "a second person", without their age, gender, hair, skin or clothing.
Never mention lighting, light colours, colour grading, pictures, frames or the original video. Output only the paragraph."""


def node(kind, title, **inputs):
    return {"class_type": kind, "inputs": inputs, "_meta": {"title": title}}


def prepare(video, picture, edit_width=768, edit_height=1376):
    graph = {
        "1": node("VHS_LoadVideo", "1 · Source video — first selected frame", video=video, force_rate=24.0,
                  custom_width=0, custom_height=0, frame_load_cap=1, skip_first_frames=0, select_every_nth=1, format="None"),
        "2": node("ImageFromBatch", "Raw first frame", image=["1", 0], batch_index=0, length=1),
        "3": node("ImageScale", "Image 2 · First frame / pose and body cut", image=["2", 0], upscale_method="lanczos",
                  width=edit_width, height=edit_height, crop="center"),
        "4": node("LoadImage", "2 · Image 1 / character and background", image=picture),
        "5": node("ImageScale", "Image 1 · Character / editor canvas", image=["4", 0], upscale_method="lanczos",
                  width=edit_width, height=edit_height, crop="center"),
        "20": node("VAEDecode", "Prepared first frame", samples=["19", 0], vae=["12", 0]),
        "21": node("SaveImage", "3 · Save prepared first frame", images=["20", 0], filename_prefix="openjutsu_picture/flux3/prepared_frame"),
        "22": node("PreviewImage", "Raw first frame — compare composition", images=["3", 0]),
        "6": node("PrimitiveStringMultiline", "Edit request · image 1 character / image 2 raw frame", value=EDIT_PROMPT),
        "7": node("ImageBatch", "Character first, raw frame second", image1=["5", 0], image2=["3", 0]),
        "8": node("ImageScaleToMaxDimension", "Images for the prompt upsampler", image=["7", 0], largest_size=768, upscale_method="area"),
        "9": node("CLIPLoader", "FLUX 3 image-edit prompt upsampler", clip_name="qwen3.5_9b_flux3_prompt_upsampler_int8_convrot.safetensors", type="flux3", device="default"),
        "23": node("TextGenerate", "Describe the raw frame's pose for the edit", clip=["9", 0], image=["8", 0], prompt=["6", 0],
                   system_prompt=["25", 0], max_length=700, sampling_mode="off", thinking=False, use_default_template=True, mtp="off"),
        "24": node("PreviewAny", "Expanded editing instruction", source=["23", 0]),
        "25": node("PrimitiveStringMultiline", "Image-edit prompt expansion rules", value=EDIT_SYSTEM),
    }
    graph.update({
        "10": node("UNETLoader", "FLUX 3 Image Klein SD", unet_name="flux3_image_klein_sd_int8_convrot.safetensors", weight_dtype="default"),
        "11": node("CLIPLoader", "FLUX 3 text encoder", clip_name="qwen3vl_4b_fp8_scaled.safetensors", type="flux3", device="default"),
        "12": node("VAELoader", "FLUX VAE", vae_name="flux2-vae.safetensors"),
        "13": node("CLIPTextEncode", "Expanded FLUX editing instruction", clip=["11", 0], text=["23", 0]),
        "14": node("ConditioningZeroOut", "Empty negative", conditioning=["13", 0]),
        "15": node("ReferenceMultiLatent", "Both raw image references reach FLUX", positive=["13", 0], negative=["14", 0], vae=["12", 0],
                   resolution="keep resolution", **{"images.image0": ["5", 0], "images.image1": ["3", 0]}),
        "19": node("KSampler", "Prepare pose · FLUX 3", model=["10", 0], seed=0, steps=16, cfg=1.0,
                   sampler_name="euler", scheduler="simple", denoise=1.0, positive=["15", 0], negative=["15", 1], latent_image=["15", 2]),
    })
    return graph


def motion(prepared, width=480, height=864, frames=141):
    graph = copy.deepcopy(prepared)
    graph["1"]["inputs"]["frame_load_cap"] = frames
    graph["1"]["_meta"]["title"] = "1 · Source video — selected motion clip"
    graph.update({
        "30": node("VRAM_Debug", "Release editor VRAM before Metric3D", empty_cache=True, gc_collect=True, unload_all_models=True,
                   any_input=["20", 0], image_pass=["1", 0]),
        "31": node("ImageScaleToMaxDimension", "Metric3D input video", image=["30", 1], largest_size=768, upscale_method="area"),
        "32": node("Metric3D-NormalMapPreprocessor", "4 · Source motion normals", image=["31", 0], backbone="vit-small", fx=1000, fy=1000, resolution=512),
        "33": node("ImageScale", "Normals match the output canvas", image=["32", 0], width=width, height=height, upscale_method="lanczos", crop="disabled"),
        "34": node("ImageFromBatch", "First normal-map frame", image=["33", 0], batch_index=0, length=1),
        "35": node("PreviewImage", "Normal-map preview", images=["34", 0]),
        "36": node("H3SoundtrackOrSilence", "Original soundtrack / silence when absent", audio=["1", 2], video_info=["1", 3]),
        "50": node("UNETLoader", "H3 Diffusion Model", unet_name="minimax_h3_ref2va_pruned_int8_convrot.safetensors", weight_dtype="default"),
        "51": node("LoraLoaderModelOnly", "DMAD LoRA", model=["50", 0], lora_name="minimax_h3_DMAD_4step_full_lora_avg_rank_39_bf16.safetensors", strength_model=1.0),
        "49": node("ModelAttentionBackend", "Comfy Kitchen Attention", model=["51", 0], attention="comfy kitchen attention"),
        "52": node("MiniMaxH3SigmaShift", "H3 Sigma Shift", model=["49", 0], shift_video=12.0, shift_audio=2.0),
        "53": node("CLIPLoader", "H3 Text Encoder", clip_name="qwen3vl_32b_minimax_h3_int4_convrot.safetensors", type="minimax", device="default"),
        "54": node("VAELoader", "H3 Video VAE", vae_name="minimax_h3_video_vae_int8_convrot.safetensors"),
        "55": node("VAELoader", "H3 Audio VAE", vae_name="minimax_h3_audio_vae_fp32.safetensors"),
        "56": node("MiniMaxH3ReferenceToVideo", "5 · Prepared picture + normal motion reference", clip=["53", 0], vae=["54", 0], audio_vae=["55", 0],
                   prompt=VIDEO_PROMPT, width=width, height=height, length=frames, ref_image_size="match",
                   **{"ref_images.ref_image_0": ["20", 0], "ref_videos.ref_video_0": ["33", 0], "ref_video_audios.ref_video_audio_0": ["36", 0]}),
        "57": node("BasicGuider", "H3 Guider", model=["52", 0], conditioning=["56", 0]),
        "58": node("RandomNoise", "Video seed", noise_seed=2577489884),
        "59": node("KSamplerSelect", "Video sampler", sampler_name="euler"),
        "60": node("BasicScheduler", "H3 · 6 steps", model=["52", 0], scheduler="simple", steps=6, denoise=1.0),
        "61": node("SamplerCustomAdvanced", "Generate motion", noise=["58", 0], guider=["57", 0], sampler=["59", 0], sigmas=["60", 0], latent_image=["56", 1]),
        "62": node("VAEDecode", "Decode video", samples=["61", 0], vae=["54", 0]),
        "63": node("VHS_VideoCombine", "6 · Result with original soundtrack", images=["62", 0], audio=["36", 0], frame_rate=24.0, loop_count=0,
                   filename_prefix="openjutsu_picture/flux3/normal_motion", format="video/h264-mp4", pix_fmt="yuv420p", crf=16,
                   save_metadata=False, trim_to_audio=False, pingpong=False, save_output=True),
    })
    return graph


def solar(prepared, width=480, height=864, frames=141):
    graph = motion(prepared, width, height, frames)
    del graph["55"]
    graph["51"] = node("SolarRendererLoraLoader", "SolarRenderer four-step LoRA", model=["50", 0],
                       lora_name="solarrenderer_4step_lora.safetensors", strength=1.0)
    graph["64"] = node("SolarRendererLoraLoader", "SolarRenderer control LoRA", model=["51", 0],
                       lora_name="solarrenderer_control_lora.safetensors", strength=1.0)
    graph["49"]["inputs"]["model"] = ["64", 0]
    graph["52"]["inputs"]["shift_audio"] = 3.0
    graph["65"] = node("SolarRendererModel", "SolarRenderer silent sampling", model=["52", 0], seed=2577489884)
    graph["56"] = node("SolarRendererConditioning", "Prepared picture + frame-aligned normal motion", clip=["53", 0],
                       vae=["54", 0], structure=["33", 0], first_frame=["20", 0], prompt=SOLAR_PROMPT,
                       width=width, height=height, length=frames)
    graph["57"]["inputs"]["model"] = ["65", 0]
    graph["59"]["inputs"]["sampler_name"] = "lcm"
    graph["60"] = node("SolarRendererSigmas", "SolarRenderer four-step schedule", steps=4)
    graph["66"] = node("LTXVSeparateAVLatent", "Separate sampled video", av_latent=["61", 0])
    graph["62"]["inputs"]["samples"] = ["66", 0]
    graph["63"]["inputs"]["filename_prefix"] = "openjutsu_picture/solar/normal_motion"
    return graph


def describe(video, picture, frames=141):
    """Pass 1 describes the source part; pass 2 rewrites it for the prepared picture.

    The rewrite reads the picture as text: shown the image, Qwen3-VL 8B describes its pose instead of the video's actions."""
    return {
        "1": node("VHS_LoadVideo", "1 · Source video — selected motion clip", video=video, force_rate=24.0,
                  custom_width=0, custom_height=0, frame_load_cap=frames, skip_first_frames=0, select_every_nth=1, format="None"),
        "70": node("VHS_SelectEveryNthImage", "Two frames per second", images=["1", 0], select_every_nth=12, skip_first_images=0),
        "71": node("ImageScaleToMaxDimension", "Shrink for the describer", image=["70", 0], largest_size=512, upscale_method="area"),
        "72": node("CLIPLoader", "Describer: Qwen3-VL 8B", clip_name="qwen3vl_8b_int8_convrot.safetensors", type="stable_diffusion", device="default"),
        "73": node("TextGenerate", "Pass 1 · describe the source video", clip=["72", 0], image=["71", 0], prompt=DESCRIBE_VIDEO,
                   max_length=600, sampling_mode="off", thinking=False, use_default_template=True, mtp="off"),
        "74": node("LoadImage", "Prepared picture", image=picture),
        "75": node("ImageScaleToMaxDimension", "Prepared picture for the describer", image=["74", 0], largest_size=768, upscale_method="area"),
        "80": node("TextGenerate", "Pass 2 · describe the prepared picture", clip=["72", 0], image=["75", 0], prompt=DESCRIBE_PICTURE,
                   max_length=160, sampling_mode="off", thinking=False, use_default_template=True, mtp="off"),
        "81": node("StringConcatenate", "New character and setting", string_a="New character and setting:", string_b=["80", 0], delimiter="\n"),
        "76": node("StringConcatenate", "Pass 1 text for the rewrite", string_a="Original video:", string_b=["73", 0], delimiter="\n"),
        "82": node("StringConcatenate", "Rewrite request", string_a=["81", 0], string_b=["76", 0], delimiter="\n\n"),
        "77": node("PrimitiveStringMultiline", "Rewrite rules", value=REWRITE_SYSTEM),
        "78": node("TextGenerate", "Pass 2 · rewrite for the prepared picture", clip=["72", 0], prompt=["82", 0],
                   system_prompt=["77", 0], max_length=500, sampling_mode="off", thinking=False, use_default_template=True, mtp="off"),
        "79": node("PreviewAny", "Video description for H3", source=["78", 0]),
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--video", default="instagram1_normal_source_20261027.mp4", help="Filename in ComfyUI input/")
    parser.add_argument("--picture", default="Stylish%20Blonde%20in%20a%20Warm%20Cafe.png", help="Original character image in ComfyUI input/")
    parser.add_argument("--output-dir", type=Path, default=Path(__file__).resolve().parents[1]/"picture")
    args = parser.parse_args()
    args.output_dir.mkdir(parents=True, exist_ok=True)
    first = prepare(args.video, args.picture)
    for name, graph in [("prepare", first), ("motion", motion(first)), ("solar", solar(first)), ("describe", describe(args.video, args.picture))]:
        path = args.output_dir/f"from_picture_{name}_flux3.api.json"
        path.write_text(json.dumps(dict(sorted(graph.items(), key=lambda item: int(item[0]))), indent=2, ensure_ascii=False)+"\n", encoding="utf-8")
        print(path)
