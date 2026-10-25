# Openjutsu: ComfyUI custom-node installation notes

Updated 25 October 2026. The README lists the packs, their links and the model files; this file adds what it leaves out: which workflow needs which pack, the Python and core requirements, and what to check when a pack does not load. The exact node IDs per pack are in `PACKS` in `lib/setup.ts`, which the setup check uses before every job.

## 1. Packs by workflow

Openjutsu uses ten custom-node packs: the ten in the README's Custom nodes table, `comfyui_controlnet_aux` included. Install them under `ComfyUI/custom_nodes/`.

| Feature / shipped workflow | Required custom packs |
| --- | --- |
| Simple: `simple.api.json` (also Object swap From picture) | Context Loop, Fantastic PromptBuilder, KJNodes, VideoHelperSuite, Oneclick Swap |
| Advanced: `advanced.api.json` | Same five |
| One pass per person: `advanced_maxq.api.json` | Same five |
| Object Change / Remove / Background / Add: `object.api.json` | Same five |
| Montage generation: `montage.api.json` | Same five |
| Object swap ControlNet: `control.api.json` | Context Loop, Fantastic PromptBuilder, VideoHelperSuite, Oneclick Swap, comfyui_controlnet_aux |
| Check mask: `mask.api.json` | KJNodes, VideoHelperSuite, Oneclick Swap |
| Find people: `people.api.json` | VideoHelperSuite, Oneclick Swap |
| Fix faces: `face.api.json` | Context Loop, Fantastic PromptBuilder, VideoHelperSuite, Oneclick Swap, H3-FaceRefine, Impact Pack |
| Fix colours: `color.api.json` | VideoHelperSuite, Image Detail Contrast, Orion4D_FXMax |

Fix colours removes the detail or tone node when that step is off, so each of its two packs is needed only for its own step. Turning off hat fix or No lip-sync does not remove any pack from swapping.

Release notes worth knowing:

- Context Loop must be **0.7.3+**. Its Registry ID keeps the spelling `comfyui-minimaxh3-contex-loop`, and the `Contex` in its node IDs is intentional.
- Fantastic PromptBuilder must include `MiniMaxH3FantasticVideoEditLatent`; an older prompt-builder-only release does not.
- Oneclick Swap must be current: Montage, Fix faces, custom resolution (`short_edge`), Object `keep_outline` and Add (`H3ObjectPlacementMask`) all need nodes or inputs from recent versions. Unrelated H3 packs do not supply these IDs.
- Orion4D_FXMax must expose `Orion4D_FXMax_DCTLToneMapper` with embedded `raw_settings` and the preset-list routes. The workflow's `Openjutsu` preset label needs no matching preset file, because `lib/color.ts` sends the settings with the job.
- Context Loop's own install notes recommend [ComfyUI-H3-Motion-Context-MultiRef](https://github.com/seitanism/ComfyUI-H3-Motion-Context-MultiRef). Openjutsu does not use it directly; Context Loop falls back without it.

## 2. ComfyUI core and Python

Openjutsu needs **ComfyUI 0.41.2 or newer**, for native H3, SAM 3.1 and text generation (`MiniMaxH3ReferenceToVideo`, `MiniMaxH3SigmaShift`, `MiniMaxH3FunControlNetApply`, `SAM3_VideoTrack`, `SAM3_TrackToMask`, `TextGenerate`). The setup check lists missing core nodes as "ComfyUI (update required)". The app can also insert the core nodes `ImageScale` and `StringConcatenate`.

Install each pack's requirements into **the Python environment that runs ComfyUI**, not into Openjutsu's `.venv-proxy` (that one only runs `comfy-api-proxy`):

```text
<ComfyUI-Python> -m pip install -r <ComfyUI>/custom_nodes/<pack>/requirements.txt
```

For Fix faces, H3-FaceRefine needs `ultralytics`, `scipy` and `insightface`, plus an ONNX Runtime build for InsightFace (see its [requirements](https://github.com/Carasibana/ComfyUI-H3-FaceRefine#requirements) for the CPU/GPU choice). Some of these imports only happen when a job runs, so a registered node does not prove its dependencies are installed. InsightFace downloads `buffalo_l` on first use, and comfyui_controlnet_aux downloads `depth_anything_v2_vitb.pth`; fetch both in advance for an offline install.

Video handling needs FFmpeg: VideoHelperSuite can use the binary from `imageio-ffmpeg`, and Context Loop wants FFmpeg on `PATH` for assembly and review. Restart ComfyUI after installing packs or dependencies.

## 3. When the setup check lists an installed pack

The check reads ComfyUI's `/object_info`, so a pack that is installed but failed to import looks the same as a missing one. Common causes:

- **ComfyUI is too old.** comfyui-h3-oneclick-swap uses ComfyUI's SAM 3 code, so on a ComfyUI older than 0.41.2 it can fail to load and all its nodes disappear. Update ComfyUI first.
- **A Python dependency is missing** from ComfyUI's environment (see section 2).
- **The pack is an old release** that does not have the nodes listed (see the release notes in section 1).

ComfyUI's console shows the import error for each pack that did not load, and marks it `(IMPORT FAILED)` in the start-up list.

## 4. Still open

1. **Pin pack revisions.** The tested setup used Context Loop 0.7.3, Fantastic PromptBuilder 1.8.1 (`01b6d8d`), KJNodes 1.5.2, VideoHelperSuite 1.7.9 (`115de7a`), H3-FaceRefine 1.0.0 (`79a97ce`), Impact Pack 8.28.3 and Orion4D_FXMax 1.0.0. These are known to work, not proven minimums. The two D3voz packs and comfyui_controlnet_aux have no recorded revision yet.
2. **Link exact model downloads.** The README links the YOLO and ControlNet files; the INT8/INT4 ConvRot H3 and Qwen files and the DMAD LoRA still have no direct links.
3. **Validate on a clean PC.** Install from the README alone, restart ComfyUI, and run a short job in every mode, including custom resolution, Montage with Find people, ControlNet, Fix faces and the default Fix colours.

Openjutsu does not need ComfyUI-GGUF, NativeAudioLock, H3 upscalers or other packs that a larger ComfyUI install may have.
