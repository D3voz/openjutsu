# From picture pipelines

These are ComfyUI API-format workflows. Drop a JSON file onto ComfyUI, or use **File → Open**.

The app uses them under **Object swap → From picture**. Choose the video and character picture, then **Generate preview image**. Compare the FLUX image with the raw frame, adjust the prompt or generate another image if needed, and click **Use this image** when ready. Set the video length, video resolution, motion-reference resolution, models, LoRAs, steps and seed, then click **Render video**. Previewing never starts H3 automatically. The video stage loads the saved preview image and does not rerun FLUX. Both stages use `COMFYUI_URL` directly; comfy-api-proxy is not required for this tab. Pending jobs and the selected preview resume when returning to the tab or refreshing the page.

| Workflow | Result |
| --- | --- |
| `from_picture_prepare_flux3.api.json` | FLUX 3 prepares and saves the first-frame picture. |
| `from_picture_motion_flux3.api.json` | FLUX preparation → Metric3D normals → H3 video. |
| `from_picture_solar_flux3.api.json` | FLUX preparation → Metric3D normals → SolarRenderer with its four-step and control LoRAs. |

## SolarRenderer

The app defaults to **SolarRenderer**, four steps and the rank-384 pair. Install the [official SolarRenderer custom nodes](https://github.com/Enderfga/SolarRenderer/tree/main/comfyui) and restart ComfyUI. These nodes run inside ComfyUI's existing Python environment.

Download both [solarrenderer_4step_lora.safetensors](https://huggingface.co/Enderfga/SolarRenderer/blob/main/solarrenderer_4step_lora.safetensors) and [solarrenderer_control_lora.safetensors](https://huggingface.co/Enderfga/SolarRenderer/blob/main/solarrenderer_control_lora.safetensors) from [Enderfga/SolarRenderer](https://huggingface.co/Enderfga/SolarRenderer). For the compressed pair, download the rank-64 four-step and control files from [mdevoz/SolarRendererRank64](https://huggingface.co/mdevoz/SolarRendererRank64).

Put the pair in `ComfyUI/models/loras` or any subfolder, such as `ComfyUI/models/loras/solar`. Reload the app, select **SolarRenderer LoRA rank**, then check the **four-step LoRA** and **control LoRA** file pickers. Both show the full installed relative paths; files can be selected manually, including renamed files. The selection persists across refreshes. The exported SolarRenderer workflow uses root filenames; select subfolder paths in its two loader nodes when importing directly into ComfyUI.

The four-step LoRA feeds the control LoRA, both at strength 1, through the official SolarRenderer loader. The workflow uses frame-aligned normal-map conditioning, held silent audio during sampling, the SolarRenderer four-step schedule and LCM. The output keeps the original source soundtrack. It needs no audio VAE. Both SolarRenderer and native H3 support up to 15 seconds in one clip, without a context loop. SolarRenderer needs at least 22 frames. Clips longer than six seconds can take considerably longer to render, especially at higher resolutions. Existing saved H3 settings keep using H3.

Both rank pairs completed a 141-frame 768×1376 test on an RTX 4060 Ti 16 GB. Rank 64 reduced adapter file size, with essentially unchanged sampling time and peak VRAM in that test.

Longer SolarRenderer clips need its internal silence buffer to extend beyond the released fixed template. If your node pack still reports "the held silence covers 170 frames", apply the included [extended-silence patch](../../patches/solarrenderer-long-clips.patch) to the official SolarRenderer pack and restart ComfyUI:

```sh
git -C /path/to/ComfyUI/custom_nodes/SolarRenderer apply /path/to/openjutsu/patches/solarrenderer-long-clips.patch
```

The patch preserves the silence template's beginning and end and repeats its steady middle, following the causal sampler's existing extension pattern. It does not enable causal sampling or context looping. Node-pack updates may require checking the fix again.

A rank-64 768×1376 single-clip nine-second selection completed with the fix: 209 frames / 8.708 seconds after frame-grid alignment, 34m 23s total and 15,898 MiB peak measured total VRAM. This confirms that selection on the tested installation; longer selections remain hardware-dependent.



Start with a **prepare** workflow. In **Source video**, choose the uploaded video and its `skip_first_frames`; in **Image 1 / character and background**, choose the original character picture. The first selected raw frame becomes image 2. There is no DWPose or skeleton input.

The edit request is editable and defaults to:

```text
change <image 1> character pose follow the  <image 2> pose. keep the final image as same body cut as <image 2> . do not change the background of <image 1> and do not add anything extra in <image 1>.
```

The image-aware prompt upsampler sees both references and expands that request into an editing instruction. Both references also reach FLUX directly, in the same order. The expansion rules use gender-neutral wording. This first version uses FLUX; the Qwen Image trial copied the source setting into the result.

**Relight** (off by default) poses and relights the character in the same FLUX pass; a second edit on top of the prepared picture degrades it. Pick one of nine light looks or write your own. The app then sends the prepare workflow with these changes (`applyRelight` in `lib/picture.ts`): FLUX gets only image 1, resized to 3 MP; image 2 reaches it only through the upsampler's written pose; the canvas is image 2's shape at 3 MP; the request's `{look}` is replaced by the light. The light usually changes the background too, and results vary a lot by seed. Relit pictures save as `relit_frame_*.png`.

**Relight the video's own person** turns the character picture off. FLUX gets only the raw frame at 3 MP, the upsampler sees the same frame, and the request asks for the same person, pose, framing and setting under the chosen light. **Framing** decides how free FLUX is: by default it may recompose the shot (strongest light, but it can zoom out to fit a light above the head); **Keep the frame's crop** starts sampling from the frame at denoise 0.9, which keeps the crop but can leave the old image showing through, such as see-through hair under Cold beam. The relit frame is saved as `relit_video_frame_*` and renders like any prepared picture.

Preparation defaults to a 768×1376 canvas and saves under `ComfyUI/output/openjutsu_picture/flux3/prepared_frame_*.png`. Compare the prepared picture against the raw first-frame preview before using it for video; a successful execution does not guarantee that the requested pose was followed.

The **motion** and **solar** variants wire the decoded prepared picture directly into H3. No manual re-upload is needed. They default to **141 frames / 5.875 seconds at 24 fps**, 480×864, four SolarRenderer steps or six H3/DMAD steps, and the original soundtrack (or silence if absent). Both renderers let you select up to 15 seconds, with no context loop. It rounds down to the H3 17k+5 frame grid: 6 seconds becomes 141 frames / 5.875 seconds; 15 seconds becomes 345 frames / 14.375 seconds. The duration shown in the settings is the actual render length. Models, LoRAs (including individual switches and strengths), H3 text encoder, VAEs, steps and seed can be changed before rendering. These settings persist across refreshes. Change `frame_load_cap` and H3's `length` together to select another valid H3 clip length.

By default normals match the H3 output canvas. The app also offers independent 512, 768 and 1376 px motion-reference sizes, rounded to multiples of 32; native H3 can cap large reference canvases. This is the motion/mask resolution control for this mode; no SAM edit mask is used. If changing that canvas, change both **Normals match the output canvas** and **Prepared picture + normal motion reference**. Normals are soft reference-video conditioning, not a trained normal ControlNet. The VRAM cleanup node runs after the image edit and before Metric3D to make room for its model.

Required installed models are selected in the loader nodes. Defaults match this installation:

- FLUX: `flux3_image_klein_sd_int8_convrot.safetensors`, `qwen3vl_4b_fp8_scaled.safetensors`, `flux2-vae.safetensors`, plus `qwen3.5_9b_flux3_prompt_upsampler_int8_convrot.safetensors`.
- Video: the H3 pruned INT8 ref2va model, H3 text encoder and video VAE. SolarRenderer needs its four-step/control pair; H3 needs the DMAD LoRA and audio VAE used by the existing workflows.
- Custom nodes: VideoHelperSuite; KJNodes for VRAM cleanup; `comfyui_controlnet_aux` for Metric3D; the one-click swap pack for soundless-video handling. Metric3D-small's checkpoint is needed for the motion variants.

Regenerate the files from the repository root:

```powershell
python workflows/build/openjutsu_picture_pipeline.py --video "video.mp4" --picture "character.png"
```

Names refer to files in ComfyUI's `input` directory. The generated defaults use the current Instagram test clip and original café character picture; choose your own files after importing.

Validated locally: image preparation → review → explicit video render completed in the app. The saved preview and H3's picture input were byte-identical. The result contains 141 frames at 480×864 and 24 fps, with audio, and the app supports video seeking. Temporary server outages and page refreshes preserve pending jobs. Automated tests, TypeScript checking and the production build pass. The café stayed consistent; precise pose and framing remain approximate.

H3 video rendering selects Comfy Kitchen INT8 attention, matching the other video tabs. The backend change applies to newly submitted jobs.
