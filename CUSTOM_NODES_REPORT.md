# Openjutsu: ComfyUI custom-node installation report

Prepared 24 October 2026 for people installing Openjutsu on their own PCs.

## Result

Openjutsu needs **five custom-node packs for its video swapping modes**, plus **four additional packs for both post-processing features**: nine packs for the complete application. Seven have public repository links in the project. Two Openjutsu-specific packs still have no public installation source documented, so a new user cannot reproduce the complete setup from the README alone.

This report examines all nine shipped API workflows and the code that changes them before submission. They contain 464 node instances and 76 distinct node types; the app can add two more core types at runtime. Across that union, 44 types come from custom packs and 34 come from ComfyUI core. These counts describe the current exported graphs, rather than every internal helper a pack may execute.

## 1. Packs to install

Install packs under the user's own `ComfyUI/custom_nodes/` directory. All paths below are relative to that user's ComfyUI installation; no particular drive letter is required.

| Pack | Needed for | Source / release requirement |
| --- | --- | --- |
| ComfyUI-MiniMaxH3-Context-Loop | Simple, Advanced, one pass per person, Object, Montage; also the masked target in Fix faces | [Public repository](https://github.com/ethanfel/ComfyUI-MiniMaxH3-Context-Loop). Openjutsu declares **0.7.3+**. The Registry/package ID retains the spelling `comfyui-minimaxh3-contex-loop`. |
| ComfyUI-Fantastic-MiniMaxH3-PromptBuilder | Masked H3 edit latent in swapping and Fix faces | [Public repository](https://github.com/Adudeguyman/ComfyUI-Fantastic-MiniMaxH3-PromptBuilder). Must include `MiniMaxH3FantasticVideoEditLatent`; an older prompt-builder-only release is insufficient. |
| ComfyUI-KJNodes | Mask growth in swapping; mask preview | [Public repository](https://github.com/kijai/ComfyUI-KJNodes). Must provide both `GrowMaskWithBlur` and `ImageAndMaskPreview`. |
| ComfyUI-VideoHelperSuite | Video loading in every mode; MP4 export in mask preview, Fix faces and Fix colours | [Public repository](https://github.com/Kosinkadink/ComfyUI-VideoHelperSuite). Must provide the three `VHS_` node IDs listed below. |
| **comfyui-h3-oneclick-swap** | Swap plans, person/role masks, shot processing, Montage analysis and face chunking | **Distribution gap.** README contains a TODO instead of a public pack link. Supply the maintained pack as a repository or versioned archive. Installing unrelated H3 packs will not supply these IDs. |
| ComfyUI-H3-FaceRefine | Fix faces only | [Public repository](https://github.com/Carasibana/ComfyUI-H3-FaceRefine). Requires face detection and identity-matching dependencies and models. |
| ComfyUI-Impact-Pack | Fix faces only: SAM loader | [Public repository](https://github.com/ltdrdata/ComfyUI-Impact-Pack). The Openjutsu graph uses `SAMLoader`. |
| **comfyui-image-detail-contrast** | Fix colours, when Detail contrast is enabled | **Distribution gap.** README contains a TODO instead of a public pack link. Supply the pack that registers `ImageDetailContrast`. |
| Orion4D_FXMax | Fix colours, when Tone mapper is enabled | [Public repository](https://github.com/orion4d/Orion4D_FXMax). Must expose `Orion4D_FXMax_DCTLToneMapper`, embedded `raw_settings`, and the preset-list routes used by Openjutsu. |

The Context Loop upstream [installation instructions](https://github.com/ethanfel/ComfyUI-MiniMaxH3-Context-Loop#install) additionally recommend [ComfyUI-H3-Motion-Context-MultiRef](https://github.com/seitanism/ComfyUI-H3-Motion-Context-MultiRef). This is a provider recommendation from that pack, separate from Openjutsu's nine direct pack dependencies. The inspected Context Loop implementation has an internal continuation fallback when a compatible provider is absent.

## 2. Minimum installation by feature

| Feature / shipped workflow | Required custom packs |
| --- | --- |
| Simple: `simple.api.json` | Context Loop, Fantastic PromptBuilder, KJNodes, VideoHelperSuite, Oneclick Swap |
| Advanced: `advanced.api.json` | Same five |
| One pass per person: `advanced_maxq.api.json` | Same five |
| Object Change / Remove / Background: `object.api.json` | Same five |
| Montage generation: `montage.api.json` | Same five |
| Check mask: `mask.api.json` | KJNodes, VideoHelperSuite, Oneclick Swap |
| Find people: `people.api.json` | VideoHelperSuite, Oneclick Swap |
| Fix faces: `face.api.json` | Context Loop, Fantastic PromptBuilder, VideoHelperSuite, Oneclick Swap, H3-FaceRefine, Impact Pack |
| Fix colours: `color.api.json` | VideoHelperSuite, Image Detail Contrast, Orion4D_FXMax |

Fix colours removes the detail or tone node when its corresponding step is disabled. Both packs are needed for the default colour pipeline. Turning off hat fix or No lip-sync does not eliminate any of the five packs needed for full swapping.

## 3. Exact custom-node IDs

Use these IDs to diagnose a missing-node error or verify a new installation. Display titles can differ.

### Context Loop: 14 types

```text
MiniMaxH3GenerationProfile
MiniMaxH3SourceTimeline
MiniMaxH3ChainPlanModern
MiniMaxH3ChainLoopStart
MiniMaxH3ChainCurrent
MiniMaxH3ChainContext
MiniMaxH3ChainSegmentSave
MiniMaxH3ChainReview
MiniMaxH3ChainLoopEnd
MiniMaxH3ChainAssemble
MiniMaxH3ContexLoopSourceSlice
MiniMaxH3ContexMaskedTarget
MiniMaxH3ContexMaskGridPreview
MiniMaxH3LoopTrim
```

The `Contex` spelling in these IDs is intentional.

### Oneclick Swap: 18 types

```text
H3OneClickSwapPlan
H3AdvancedSwapPlan
H3ObjectSwapPlan
H3PeopleMask
H3GreyMannequins
H3ClipShots
H3FillShots
H3TrackCrops
H3TrackRoles
H3RoleMask
H3SubjectPrompt
H3MontagePeople
H3MontageTracks
H3MontagePicks
H3MontagePlan
H3MontagePass
H3FaceChunks
H3FaceJoin
```

A distributed version must include the Montage nodes and face chunk/join nodes, not just the original Simple swap. It also needs the current `short_edge` custom-resolution inputs, Object plan `keep_outline`, and the track/role input contracts expected by the app.

### Other packs: 12 types

| Pack | Exact IDs |
| --- | --- |
| Fantastic PromptBuilder | `MiniMaxH3FantasticVideoEditLatent` |
| KJNodes | `GrowMaskWithBlur`, `ImageAndMaskPreview` |
| VideoHelperSuite | `VHS_LoadVideo`, `VHS_SelectEveryNthImage`, `VHS_VideoCombine` |
| H3-FaceRefine | `H3FaceTrackCrop`, `H3FaceMaskSAM`, `H3FaceStitch` |
| Impact Pack | `SAMLoader` |
| Image Detail Contrast | `ImageDetailContrast` |
| Orion4D_FXMax | `Orion4D_FXMax_DCTLToneMapper` |

## 4. ComfyUI core and supporting software

Openjutsu's README declares **ComfyUI 0.41.2 or newer**. The inspected reference installation reports 0.42.0; this audit does not establish the earliest working version independently. A new installation must expose native H3, SAM 3.1 and text generation, including `MiniMaxH3ReferenceToVideo`, `MiniMaxH3SigmaShift`, `SAM3_VideoTrack`, `SAM3_TrackToMask` and `TextGenerate`.

The app also uses core sampling, model loaders, audio, image, math and logic nodes. `ComfyMathExpression`, `ComfySwitchNode`, `ModelAttentionBackend`, `AudioAdjustVolume` and `TrimAudioDuration` are core dependencies in these graphs. `ImageScale` and `StringConcatenate` can be inserted by the app for custom sizing and run names. They do not require separate custom-node packs.

Install each pack's requirements into **the Python environment that actually runs ComfyUI**. Openjutsu's `.venv-proxy` is a separate environment for `comfy-api-proxy`; installing node dependencies there will not make ComfyUI import them.

For manual installation, run the equivalent of the following with ComfyUI's Python, for each installed pack that supplies a requirements file:

```text
<ComfyUI-Python> -m pip install -r <ComfyUI>/custom_nodes/<pack>/requirements.txt
```

For Fix faces, the inspected pack declares `ultralytics`, `scipy` and `insightface`. Supply an appropriate ONNX Runtime variant for InsightFace; the [FaceRefine installation notes](https://github.com/Carasibana/ComfyUI-H3-FaceRefine#requirements) explain the CPU/GPU package choice. Node registration alone does not verify these dependencies, because some imports happen only when a job runs.

Video handling requires a working FFmpeg setup. VideoHelperSuite can discover the binary supplied by `imageio-ffmpeg`; Context Loop recommends FFmpeg on `PATH` for assembly and review. Restart ComfyUI after installing the packs and their dependencies.

Openjutsu itself additionally requires Node.js 22.6+ and `comfy-api-proxy`. These are application services, separate from ComfyUI custom nodes.

## 5. Models a fresh installation also needs

Installing custom nodes does not install the model weights referenced by the workflows.

| ComfyUI model folder | Default file / directory | Used for |
| --- | --- | --- |
| `models/diffusion_models/` | `minimax_h3_ref2va_pruned_int8_convrot.safetensors` | H3 generation and Fix faces |
| `models/loras/` | `minimax_h3_DMAD_4step_full_lora_avg_rank_39_bf16.safetensors` | Default speed LoRA |
| `models/text_encoders/` | `qwen3vl_32b_minimax_h3_int4_convrot.safetensors` | H3 text encoder |
| `models/text_encoders/` | `qwen3vl_8b_int8_convrot.safetensors` | Picture, face, shot and role descriptions |
| `models/vae/` | `minimax_h3_video_vae_int8_convrot.safetensors` | Video VAE |
| `models/vae/` | `minimax_h3_audio_vae_fp32.safetensors` | Audio VAE |
| `models/checkpoints/` | `sam3.1_multiplex_fp16.safetensors` | Swapping, tracking and mask preview |
| `models/ultralytics/bbox/` | `face_yolov8m.pt` | Fix faces |
| `models/ultralytics/segm/` | `person_yolov8m-seg.pt` | Fix faces: configured fallback detector |
| `models/sams/` | `sam_vit_b_01ec64.pth` | Fix faces: SAM face mask |
| `models/insightface/models/` | `buffalo_l/` | Fix faces: identity matching |

These are the current workflow/app defaults, not verified model download links. The base model and LoRAs can be changed in the app; the remaining filenames are embedded in the exports. InsightFace may fetch `buffalo_l` on first use if it is missing, so include it explicitly when preparing an offline installation.

The README's tested hardware is an NVIDIA RTX 4060 Ti with 16 GB VRAM and 64 GB system RAM. This is a tested configuration, not a measured minimum or a promise of compatibility with other GPU backends.

## 6. Items to resolve before publishing installation instructions

1. **Publish or bundle Oneclick Swap.** It is required for every swapping mode, Check mask, Find people and Fix faces. The inspected source is a standalone `__init__.py` registering all 18 IDs; no public URL or version metadata is supplied in the project.
2. **Publish or bundle Image Detail Contrast.** It is required by the default Fix colours graph. Its inspected source is also a standalone `__init__.py` without a documented public URL or version.
3. **Pin a reproducible set of pack revisions.** The reference metadata is Context Loop 0.7.3, Fantastic PromptBuilder 1.8.1 (`01b6d8d`), KJNodes 1.5.2, VideoHelperSuite 1.7.9 (`115de7a`), H3-FaceRefine 1.0.0 (`79a97ce`), Impact Pack 8.28.3 and Orion4D_FXMax 1.0.0. These identify the inspected setup; they are not independently proven minimum versions. Version untracked packs or record archive hashes as well.
4. **Provide exact model download sources.** In particular, publish links for the INT8/INT4 ConvRot artifacts and default DMAD LoRA rather than expecting a general H3 model page to contain the exact files.
5. **Validate on a clean PC.** Restart ComfyUI, confirm the required IDs in its `/object_info` registry, then run a short job through each supported feature. Include custom resolution, Montage Find people/review, Fix faces and default Fix colours. Confirm Python dependencies, models and FFmpeg as part of that run.

The colour workflow uses an `Openjutsu` preset label, while `lib/color.ts` supplies the actual settings through `raw_settings`. A separate `Openjutsu.json` preset is not required with the inspected Orion implementation, which accepts embedded settings without a matching preset file. `H3 soft.json` is optional for displaying that saved preset in the picker; the app has built-in defaults.

Openjutsu's exported workflows do not directly require ComfyUI-GGUF, NativeAudioLock, H3 upscalers or the other unrelated packs present in a larger ComfyUI installation. ComfyUI Manager can help install public packs, but it does not replace the two missing distribution sources.

## Evidence and limits

Primary evidence: Openjutsu `README.md`, `workflows/*.api.json`, and the graph preparation code in `lib/comfy.ts`, `lib/simple.ts`, `lib/advanced.ts`, `lib/montage.ts`, `lib/object.ts`, `lib/face.ts`, `lib/color.ts` and `lib/model.ts`; custom-pack registration tables and metadata; and the linked upstream repositories. All 78 directly referenced or app-inserted IDs were present in the reference ComfyUI registry during the audit. Pack ownership was checked against source registration tables because another installed extension mislabels some registry module names.

This was a dependency and distribution audit. No clean-PC installation or end-to-end generation was performed, and availability on the reference machine does not prove that another user's installation is ready.
