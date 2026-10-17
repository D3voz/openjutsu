# Openjutsu

An open-source, Genjutsu-style character swap for video. Drop a video and 1–4 character photos, press **Generate**, and every person in the video is replaced by your characters. The camera, cuts, motion and soundtrack stay. Everything runs on open weights on your own GPU: MiniMax H3 for the video, SAM 3.1 to track people, and Qwen3-VL 8B to describe the pictures and shots.

The app is a small Next.js front end over a ComfyUI workflow. It uses [`@comfyorg/sdk`](https://www.npmjs.com/package/@comfyorg/sdk), following Comfy's [comfy-reshoot](https://github.com/Comfy-Org/comfy-reshoot) reference app.

## Modes

- **Simple motion transfer**: available. Runs `workflows/simple.api.json`.
- **Advanced motion transfer** (pick who becomes who with role-coloured tracks) and **Object swap**: coming soon, as separate workflow files.

## Requirements

- An NVIDIA GPU. Tested on an RTX 4060 Ti 16 GB with 64 GB of system RAM; the H3 int8 models stream from RAM.
- [ComfyUI](https://github.com/comfyanonymous/ComfyUI) 0.41.2 or newer. Core provides MiniMax H3, SAM 3.1 and TextGenerate.
- Node.js 22.6 or newer, and Python for `comfy-api-proxy`.

### Custom nodes

Install these into `ComfyUI/custom_nodes` (ComfyUI Manager finds the first three by name):

| Pack | Used for |
| --- | --- |
| [ComfyUI-MiniMaxH3-Context-Loop](https://github.com/ethanfel/ComfyUI-MiniMaxH3-Context-Loop) 0.7.3+ | clip loop, checkpoints, final assembly |
| [ComfyUI-Fantastic-MiniMaxH3-PromptBuilder](https://github.com/Adudeguyman/ComfyUI-Fantastic-MiniMaxH3-PromptBuilder) | masked video-edit latent |
| [ComfyUI-KJNodes](https://github.com/kijai/ComfyUI-KJNodes) | Grow Mask With Blur |
| [ComfyUI-VideoHelperSuite](https://github.com/Kosinkadink/ComfyUI-VideoHelperSuite) | video loading |
| `comfyui-h3-oneclick-swap` | swap plan, people mask, grey mannequins, cut finder, shot list (TODO: link the published pack) |

Restart ComfyUI after installing them.

### Models

| Folder in `ComfyUI/models` | File |
| --- | --- |
| `diffusion_models` | `minimax_h3_ref2va_pruned_int8_convrot.safetensors` |
| `loras` | `minimax_h3_DMAD_4step_full_lora_avg_rank_39_bf16.safetensors` |
| `text_encoders` | `qwen3vl_32b_minimax_h3_int4_convrot.safetensors` (H3 text encoder) |
| `text_encoders` | `qwen3vl_8b_int8_convrot.safetensors` (describer) |
| `vae` | `minimax_h3_video_vae_int8_convrot.safetensors`, `minimax_h3_audio_vae_fp32.safetensors` |
| `checkpoints` | `sam3.1_multiplex_fp16.safetensors` |

## Run it locally

1. Start ComfyUI on `127.0.0.1:8188`. On Windows, set `AIOHTTP_NOSENDFILE=1` first (PowerShell: `$env:AIOHTTP_NOSENDFILE = "1"`). Without it, the first partial-file request (the video player sends one when you seek) can stall ComfyUI's `/view`, and every later file download hangs until ComfyUI restarts.
2. Install and start the proxy, which serves the Comfy API v2 on `127.0.0.1:8189`. Raise the upload cap for longer videos (the default is 100 MB):

   ```sh
   pip install comfy-api-proxy
   comfy-api-proxy run --max-upload-mb 500
   ```

3. Install and start the app:

   ```sh
   git clone <this repo> openjutsu
   cd openjutsu
   cp .env.example .env.local
   npm ci
   npm run dev
   ```

4. Open <http://127.0.0.1:3000>.

`.env.local` sets `COMFY_BASE_URL=http://127.0.0.1:8189`. Leave `COMFY_API_KEY` empty for a local proxy.

A 6 s clip at 480p takes about 6–13 minutes on a 4060 Ti, most of it in H3 sampling. 736p is the default; 1080p is about 2.5× slower than 736p and needs much more memory.

## Tips

- One photo per person in the video. Every person SAM finds is regenerated.
- **Replaces who?** names a role or position (`the singer`, `the drummer`, `the person on the left`), never clothes: clothing words leak into the result. Leave all of them blank to match pictures to people by screen time.
- **Hat fix** also masks hats, so they are replaced too (about 45 s more per clip).
- Change the **seed** (under Advanced) for a new take. Running the same inputs again resumes from the last finished clip.

## How it works

`workflows/simple.api.json` is one API export of the ComfyUI workflow with all four picture branches and the hat fix enabled. For each request, `lib/simple.ts`:

- removes the picture branches (Load Image → Shrink → Describe) for unused pictures, and their links into the Swap Plan (`picture_k`, `picture_k_text`) and Reference Conditioning (`ref_images.ref_image_k`);
- without the hat fix, removes the hat nodes and connects Grow Mask to the People Mask output;
- sets the Swap Plan's resolution, seed, clip length and roles (one line per picture).

`lib/comfy.ts` binds the uploaded video to `VHS_LoadVideo` and the photos to the `LoadImage` nodes, then submits with the SDK. `/api/jobs/[id]/events` streams `job.events()` to the page as server-sent events. Node ids are turned into node titles and clip numbers there: each clip after the first is a graph expansion whose node ids carry a prefix per clip (`64`, `70.0.0.64`, `70.0.0.Recurse.0.0.64`). The final MP4 is the output of the Final Video node (`MiniMaxH3ChainAssemble`, node `71`).

To change the workflow, open it in ComfyUI, enable every picture group and the hat-fix group, export **Workflow (API)**, and replace `workflows/simple.api.json`. If node ids change, update `NODES` in `lib/simple.ts`. `npm test` checks the pruning against the export.

## Deploy on the Comfy Developer Platform

Not tested yet. The app code does not change, only `.env.local`:

1. Package the prepared ComfyUI install (with the custom nodes and models above) as a Build, and deploy it:

   ```sh
   pip install comfy-cli
   comfy setup --where cloud
   cd /path/to/ComfyUI
   comfy build init --name openjutsu --models-dir ./models --custom-nodes-dir ./custom_nodes
   comfy build status
   comfy build push --release --target linux/nvidia
   comfy deploy refs compute
   ```

2. Create a deployment from the released Build on the Developer Platform. The workflow has only been run on a 16 GB card with 64 GB of system RAM, so choose at least that.
3. Set `COMFY_BASE_URL` to the deployment URL and `COMFY_API_KEY` to a key from the workspace that owns it. The key stays on the server; never put it in a `NEXT_PUBLIC_` variable.
4. Host the Next.js app anywhere that runs Node (`npm run build && npm start`). Streaming progress needs a host that keeps long responses open.

Notes:

- Resuming relies on clip checkpoints in ComfyUI's `output/` folder, which a fresh serverless worker does not have.
- A job runs for many minutes; check the deployment's request time limit.
- Stop or delete the deployment when you finish, to end GPU charges.

## License

MIT, see [`LICENSE`](LICENSE). Model licences are separate.
