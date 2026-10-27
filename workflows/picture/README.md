# From picture pipelines

These are ComfyUI API-format workflows. Drop a JSON file onto ComfyUI, or use **File → Open**.

The app uses them under **Object swap → From picture**. Choose the video and character picture, then **Generate preview image**. Compare the FLUX image with the raw frame, adjust the prompt or generate another image if needed, and click **Use this image** when ready. Set the video length, video resolution, motion-reference resolution, models, LoRAs, steps and seed, then click **Render video**. Previewing never starts H3 automatically. The video stage loads the saved preview image and does not rerun FLUX. Both stages use `COMFYUI_URL` directly; comfy-api-proxy is not required for this tab. Pending jobs and the selected preview resume when returning to the tab or refreshing the page.

| Workflow | Result |
| --- | --- |
| `from_picture_prepare_flux3.api.json` | FLUX 3 prepares and saves the first-frame picture. |
| `from_picture_motion_flux3.api.json` | FLUX preparation → Metric3D normals → H3 video. |

Start with a **prepare** workflow. In **Source video**, choose the uploaded video and its `skip_first_frames`; in **Image 1 / character and background**, choose the original character picture. The first selected raw frame becomes image 2. There is no DWPose or skeleton input.

The edit request is editable and defaults to:

```text
change <image 1> character pose follow the  <image 2> pose. keep the final image as same body cut as <image 2> . do not change the background of <image 1> and do not add anything extra in <image 1>.
```

The image-aware prompt upsampler sees both references and expands that request into an editing instruction. Both references also reach FLUX directly, in the same order. The expansion rules use gender-neutral wording. This first version uses FLUX; the Qwen Image trial copied the source setting into the result.

Preparation defaults to a 768×1376 canvas and saves under `ComfyUI/output/openjutsu_picture/flux3/prepared_frame_*.png`. Compare the prepared picture against the raw first-frame preview before using it for video; a successful execution does not guarantee that the requested pose was followed.

The **motion** variants wire the decoded prepared picture directly into H3. No manual re-upload is needed. They default to **141 frames / 5.875 seconds at 24 fps**, 480×864, six DMAD steps, and the original soundtrack (or silence if absent). The app lets you select up to 15 seconds, with no context loop. It rounds down to the H3 17k+5 frame grid: 6 seconds becomes 141 frames / 5.875 seconds; 15 seconds becomes 345 frames / 14.375 seconds. The duration shown in the settings is the actual render length. Models, LoRAs (including individual switches and strengths), H3 text encoder, VAEs, steps and seed can be changed before rendering. These settings persist across refreshes. Change `frame_load_cap` and H3's `length` together to select another valid H3 clip length.

By default normals match the H3 output canvas. The app also offers independent 512, 768 and 1376 px motion-reference sizes, rounded to multiples of 32; native H3 can cap large reference canvases. This is the motion/mask resolution control for this mode; no SAM edit mask is used. If changing that canvas, change both **Normals match the output canvas** and **Prepared picture + normal motion reference**. Normals are soft reference-video conditioning, not a trained normal ControlNet. The VRAM cleanup node runs after the image edit and before Metric3D to make room for its model.

Required installed models are selected in the loader nodes. Defaults match this installation:

- FLUX: `flux3_image_klein_sd_int8_convrot.safetensors`, `qwen3vl_4b_fp8_scaled.safetensors`, `flux2-vae.safetensors`, plus `qwen3.5_9b_flux3_prompt_upsampler_int8_convrot.safetensors`.
- Video: the H3 pruned INT8 ref2va model, DMAD LoRA, H3 text encoder and VAEs used by the existing workflows.
- Custom nodes: VideoHelperSuite; KJNodes for VRAM cleanup; `comfyui_controlnet_aux` for Metric3D; the one-click swap pack for soundless-video handling. Metric3D-small's checkpoint is needed for the motion variants.

Regenerate the files from the repository root:

```powershell
python workflows/build/openjutsu_picture_pipeline.py --video "video.mp4" --picture "character.png"
```

Names refer to files in ComfyUI's `input` directory. The generated defaults use the current Instagram test clip and original café character picture; choose your own files after importing.

Validated locally: image preparation → review → explicit video render completed in the app. The saved preview and H3's picture input were byte-identical. The result contains 141 frames at 480×864 and 24 fps, with audio, and the app supports video seeking. Temporary server outages and page refreshes preserve pending jobs. Automated tests, TypeScript checking and the production build pass. The café stayed consistent; precise pose and framing remain approximate.
