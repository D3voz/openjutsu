# KAFEIN fleet edition

This is the KAFEIN absorption of [Openjutsu](https://github.com/D3voz/openjutsu), pinned at upstream `1ee2997b176bf32dd7b9ac430205cdcd1277b6be` (MIT).

**Status:** source + UI/recipe adaptation, **not deployed**. No GPU run. See `HAL/docs/OPENJUTSU-ABSORPTION.md` in `hal-fleet` for the full absorption dossier.

## What changed for the fleet

Openjutsu's upstream defaults point at weights we do not have. The fleet profile now uses the files actually in `s3://kafein-comfy-models-264990607058/models/`:

| Role | Fleet file | Upstream default replaced |
|---|---|---|
| H3 diffusion | `minimax_h3_ref2va_pruned_int8_convrot.safetensors` | same |
| Speed LoRA | `minimax_h3_ref2v_turbo_8step_v1.0_768p_comfyui_bf16.safetensors` | `minimax_h3_DMAD_4step_full_lora_avg_rank_39_bf16.safetensors` (not in S3) |
| H3 text encoder | `qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors` | `qwen3vl_32b_minimax_h3_int4_convrot.safetensors` |
| Visual describer | `qwen3vl_8b_fp8_scaled.safetensors` | `qwen3vl_8b_int8_convrot.safetensors` |
| Video VAE | `minimax_h3_video_vae_int8_convrot.safetensors` | same |
| Audio VAE | `minimax_h3_audio_vae_fp32.safetensors` | same |
| Person/object mask | `sam3.1_multiplex_fp16.safetensors` | same |

Steps change from 6 (DMAD) to **8** (the fleet turbo 8-step LoRA). The LoRA node title inside the workflow remains `DMAD LoRA` because the exports and `applyModel()` find it by title; only the file name changed.

## UX / recipe changes

- **KAFEIN fleet profile** block in the editor, with **Use fleet defaults**.
- Saved browsers migrate old model names (`DMAD`, INT4 TE, INT8 describer) to the fleet files without losing custom LoRA strengths.
- The visual-describer welcome page lists the fleet's Qwen3-VL 8B FP8 as the default and Qwen3-VL 4B FP8 as the smaller option.
- The steps hint says 8 with the KAFEIN speed LoRA.
- The model components still allow overrides; the profile is a safe reset, not a hidden lock.

## Package update

- `next` `^16.4.2` → `^16.4.3`.
- `npm audit`: **0 vulnerabilities** (all severities, including dev).
- `npm test`: **128/128**.
- `npm run build`: passes.

The app's own source is MIT. Runtime custom nodes and weights keep their licenses; `Fix faces` and `From picture` are **hidden and server-blocked by default**:

- `Fix faces` uses InsightFace `buffalo_l` (non-commercial research) + Ultralytics YOLO (AGPL-3.0).
- `From picture` uses FLUX 3 Klein (non-commercial).

To expose them for internal research, set **both** `KAFEIN_RESEARCH_MODES=1` and `NEXT_PUBLIC_KAFEIN_RESEARCH_MODES=1`; never in a client-facing deployment.

## Not done here

- ComfyUI `>=0.41.2` and the 13 custom packs are not installed in the fleet.
- No GPU QA; no deployment; no public route.
- The actual `qwen3vl_32b` NVFP4 file still needs a hardware smoke on the 4090/pod.
