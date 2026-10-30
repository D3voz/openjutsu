"use client";

import { useEffect, useRef, useState } from "react";
import { canvasSize, CUSTOM_SIZE, MAX_SEED, MIN_SECTION_SECONDS, MOTION_SIZES, PLACES, placeStart, RESOLUTIONS, timecode } from "../lib/simple.ts";
import { MAX_LORAS, STEPS, STRENGTH } from "../lib/model.ts";
import { DEFAULT_PICTURE_VIDEO, FRAME_RELIGHT_PROMPT, LIGHT_LOOKS, parsePictureVideoSettings, pictureFrames, RELIGHT_PROMPT, solarLoraFiles, type PictureVideoSettings } from "../lib/picture.ts";

const PROMPT = "change <image 1> character pose follow the  <image 2> pose. keep the final image as same body cut as <image 2> . do not change the background of <image 1> and do not add anything extra in <image 1>.";
const STORAGE = "openjutsu.picture-preview";
const VIDEO_STORAGE = "openjutsu.picture-video-settings";
const DESCRIPTION_STORAGE = "openjutsu.picture-description";
const MAX_SECONDS = 15;
type Job = { id: string; stage: "prepare" | "describe" | "render" };

export function FromPicture({ initialVideo, initialPicture, start: initialStart = 0, describer }: { initialVideo?: File; initialPicture?: File; start?: number; describer: string }) {
  const [video, setVideo] = useState<File | null>(initialVideo ?? null);
  const [picture, setPicture] = useState<File | null>(initialPicture ?? null);
  const [videoUrl, setVideoUrl] = useState("");
  const [pictureUrl, setPictureUrl] = useState("");
  const [size, setSize] = useState<[number, number] | null>(null);
  const [start, setStart] = useState(initialStart);
  const [duration, setDuration] = useState(0);
  const player = useRef<HTMLVideoElement>(null);
  const [seed, setSeed] = useState(0);
  const [prompt, setPrompt] = useState(PROMPT);
  const [look, setLook] = useState(-1);
  const [ownLight, setOwnLight] = useState("Light the new photo with ");
  const [relightPrompt, setRelightPrompt] = useState(RELIGHT_PROMPT);
  const [ownPerson, setOwnPerson] = useState(false);
  const [framePrompt, setFramePrompt] = useState(FRAME_RELIGHT_PROMPT);
  const [keepCrop, setKeepCrop] = useState(false);
  const [denoise, setDenoise] = useState(0.9);
  const [job, setJob] = useState<Job | null>(null);
  const [prepared, setPrepared] = useState("");
  const [preview, setPreview] = useState<{ url: string; frame: string } | null>(null);
  const [approved, setApproved] = useState(false);
  const [description, setDescription] = useState("");
  const [settings, setSettings] = useState<PictureVideoSettings>(() => structuredClone(DEFAULT_PICTURE_VIDEO));
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [files, setFiles] = useState<{ models: string[]; loras: string[]; textEncoders: string[]; vaes: string[] }>({ models: [], loras: [], textEncoders: [], vaes: [] });
  const [modelError, setModelError] = useState("");
  const [result, setResult] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const busy = submitting || !!job;
  const relight = look >= 0;
  const light = look === LIGHT_LOOKS.length ? ownLight : LIGHT_LOOKS[look]?.light ?? "";
  const ready = !!video && (ownPerson || !!picture) && !!size && (relight ? !!light.trim() : !ownPerson);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE) ?? "null");
      if (typeof saved?.prepared === "string") setPrepared(saved.prepared);
      setApproved(saved?.approved === true || saved?.job?.stage === "render");
      setDescription(localStorage.getItem(DESCRIPTION_STORAGE) ?? "");
      if (typeof saved?.job?.id === "string" && ["prepare", "describe", "render"].includes(saved.job.stage)) {
        setJob(saved.job);
        if (saved.job.stage !== "prepare" && saved.prepared) {
          const base = `/api/picture?id=${encodeURIComponent(saved.prepared)}`;
          setPreview({ url: `${base}&media=result`, frame: `${base}&media=frame` });
        }
      }
      else if (typeof saved?.prepared === "string" && saved.prepared) setJob({ id: saved.prepared, stage: "prepare" });
    } catch {}
    try { setSettings(parsePictureVideoSettings(JSON.parse(localStorage.getItem(VIDEO_STORAGE) ?? "{}"))); } catch {}
    setSettingsLoaded(true);
    fetch("/api/models").then(async (response) => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setFiles({ models: data.models ?? [], loras: data.loras ?? [], textEncoders: data.textEncoders ?? [], vaes: data.vaes ?? [] });
      setSettings((current) => {
        const defaults = solarLoraFiles(current.solarRank), installed = solarLoraFiles(current.solarRank, data.loras ?? []);
        return { ...current, solarFourStep: current.solarFourStep === defaults.solarFourStep ? installed.solarFourStep : current.solarFourStep,
          solarControl: current.solarControl === defaults.solarControl ? installed.solarControl : current.solarControl };
      });
    }).catch((error) => setModelError(error.message));
  }, []);
  useEffect(() => {
    if (settingsLoaded) try { localStorage.setItem(VIDEO_STORAGE, JSON.stringify(settings)); } catch {}
  }, [settings, settingsLoaded]);
  useEffect(() => {
    if (!video) return;
    const url = URL.createObjectURL(video); setVideoUrl(url); setSize(null);
    return () => URL.revokeObjectURL(url);
  }, [video]);
  useEffect(() => {
    if (!picture) return;
    const url = URL.createObjectURL(picture); setPictureUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [picture]);

  function remember(next: Job | null, image: string, accepted: boolean) {
    try { localStorage.setItem(STORAGE, JSON.stringify({ job: next, prepared: image, approved: accepted })); } catch {}
  }
  function keepDescription(text: string) {
    setDescription(text);
    try { localStorage.setItem(DESCRIPTION_STORAGE, text); } catch {}
  }
  useEffect(() => {
    if (!job) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const response = await fetch(`/api/picture?id=${encodeURIComponent(job!.id)}`, { signal: controller.signal });
        const data = await response.json();
        if (!response.ok) {
          setError(data.error ?? "Could not read the job.");
          if ([400, 404, 422].includes(response.status)) { setJob(null); remember(null, prepared, job!.stage !== "prepare"); }
          else timer = setTimeout(poll, 5000);
          return;
        }
        setError("");
        if (data.status !== "ready") { timer = setTimeout(poll, 2000); return; }
        if (job!.stage === "prepare") {
          setPrepared(job!.id); setPreview({ url: data.url, frame: data.frame }); setSize([data.width, data.height]); remember(null, job!.id, approved);
        } else if (job!.stage === "describe") { keepDescription(data.text); remember(null, prepared, true); }
        else { setResult(data.url); remember(job, prepared, true); }
        setJob(null);
      } catch {
        if (!controller.signal.aborted) { setError("Connection interrupted. Retrying…"); timer = setTimeout(poll, 5000); }
      }
    }
    void poll();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [job, prepared]);

  // The part is start + the video length; only a new start changes the pose frame.
  function choosePart(nextStart: number, length: number, total = duration) {
    const begin = Math.min(Math.max(0, nextStart), total - length);
    if (begin !== start) { invalidate(); setStart(begin); }
    setSettings((current) => ({ ...current, seconds: length }));
    if (player.current) player.current.currentTime = begin;
  }
  function invalidate() {
    setPrepared(""); setPreview(null); setApproved(false); setResult(""); setError(""); remember(null, "", false); keepDescription("");
  }
  async function prepare(nextSeed: number) {
    if (!ready || !video || !size) return;
    setSubmitting(true); invalidate(); setSeed(nextSeed);
    try {
      const form = new FormData();
      form.set("video", video); form.set("start", String(start)); form.set("seed", String(nextSeed));
      form.set("width", String(size[0])); form.set("height", String(size[1])); form.set("prompt", ownPerson ? framePrompt : relight ? relightPrompt : prompt);
      if (ownPerson) { form.set("relight", "frame"); form.set("denoise", String(keepCrop ? denoise : 1)); } else if (picture) form.set("picture", picture);
      if (relight) form.set("light", light);
      const response = await fetch("/api/picture", { method: "POST", body: form });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      const next: Job = { id: data.id, stage: "prepare" }; remember(next, "", false); setJob(next);
    } catch (error) { setError((error as Error).message); }
    finally { setSubmitting(false); }
  }
  // The describer watches the part, then rewrites what happens for the prepared picture; H3 gets the result as text.
  async function describe() {
    setSubmitting(true); setError("");
    try {
      const response = await fetch("/api/picture", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prepared, describe: true, seconds: settings.seconds, describer }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      const next: Job = { id: data.id, stage: "describe" }; remember(next, prepared, true); setJob(next);
    } catch (error) { setError((error as Error).message); }
    finally { setSubmitting(false); }
  }
  async function render() {
    if (!prepared || !preview || !approved) return;
    setSubmitting(true); setError(""); setResult("");
    try {
      const response = await fetch("/api/picture", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prepared, settings, description }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      const next: Job = { id: data.id, stage: "render" }; remember(next, prepared, true); setJob(next);
    } catch (error) { setError((error as Error).message); }
    finally { setSubmitting(false); }
  }

  function picker(label: string, value: string, options: string[], onChange: (value: string) => void) {
    return <label><span>{label}</span>{options.length
      ? <select className="file-name" aria-label={label} value={value} onChange={(event) => onChange(event.target.value)}>{[...new Set([value, ...options])].map((name) => <option key={name} value={name}>{name || "Choose a file"}</option>)}</select>
      : <input className="file-name" aria-label={label} value={value} onChange={(event) => onChange(event.target.value)} />}</label>;
  }
  const canvas = typeof settings.resolution === "string" ? canvasSize(size?.[0] ?? 768, size?.[1] ?? 1376, settings.resolution) : [settings.resolution.width, settings.resolution.height];
  const frames = pictureFrames(settings.seconds);
  const whole = duration <= MAX_SECONDS && start === 0 && settings.seconds >= duration;
  const place = whole ? "Whole" : PLACES.slice(1).find((p) => Math.abs(placeStart(p, duration, settings.seconds) - start) < 0.05);

  return <div className="picture-pipeline">
    <p className="hint">Prepare the character in the video's starting pose with FLUX. Review the image first, then render its motion while keeping the picture's background.</p>
    {!approved && <div className="inputs">
      <section className="panel">
        <h2><span>1</span> Character and source video</h2>
        <label>Source video<input type="file" accept="video/*,.mkv" disabled={busy} onChange={(event) => { const file = event.target.files?.[0]; if (file) { invalidate(); setVideo(file); setStart(0); setDuration(0); } }} /></label>
        {videoUrl && <video ref={player} src={videoUrl} controls preload="metadata"
          onLoadedMetadata={(event) => { const { videoWidth, videoHeight, duration: total } = event.currentTarget; setSize([videoWidth, videoHeight]); setDuration(total); choosePart(start, Math.min(settings.seconds, total, MAX_SECONDS), total); }}
          onTimeUpdate={(event) => { if (event.currentTarget.currentTime >= start + settings.seconds) event.currentTarget.currentTime = start; }} />}
        {duration > MIN_SECTION_SECONDS && <>
          <div className="setting">
            <span>Part to use <small>{timecode(start)}–{timecode(start + settings.seconds)} ({settings.seconds.toFixed(1)} s). Its first frame sets the pose; up to {MAX_SECONDS} s.</small></span>
            <div className="segmented">
              {PLACES.filter((p) => p !== "Whole" || duration <= MAX_SECONDS).map((p) => (
                <button key={p} className={p === place ? "on" : ""} disabled={busy} onClick={() => p === "Whole" ? choosePart(0, duration) : choosePart(placeStart(p, duration, settings.seconds), settings.seconds)}>{p}</button>
              ))}
            </div>
          </div>
          <label className="setting">
            <span>Length <small>{settings.seconds.toFixed(1)} s</small></span>
            <input type="range" min={MIN_SECTION_SECONDS} max={Math.min(duration, MAX_SECONDS)} step={0.5} value={settings.seconds} disabled={busy} onChange={(event) => choosePart(start, Number(event.target.value))} />
          </label>
          <label className="setting">
            <span>Starts at <small>{timecode(start)}</small></span>
            <input type="range" min={0} max={duration - settings.seconds} step={0.1} value={start} disabled={busy || whole} onChange={(event) => choosePart(Number(event.target.value), settings.seconds)} />
          </label>
        </>}
        <label className="setting toggle"><span>Relight the video's own person <small>No new character: only the light changes.</small></span><input type="checkbox" checked={ownPerson} disabled={busy} onChange={(event) => { invalidate(); setOwnPerson(event.target.checked); if (event.target.checked && look < 0) setLook(0); }} /><i /></label>
        {!ownPerson && <>
          <label>Character picture · image 1<input type="file" accept="image/png,image/jpeg,image/webp" disabled={busy} onChange={(event) => { const file = event.target.files?.[0]; if (file) { invalidate(); setPicture(file); } }} /></label>
          {pictureUrl && <img className="picture-reference" src={pictureUrl} alt="Character and background reference" />}
        </>}
        <small>The part's first frame is {ownPerson ? "the picture FLUX relights" : "image 2"}. Choose the render settings after reviewing the prepared image.</small>
      </section>
      <section className="panel">
        <h2><span>2</span> Prepare the first frame</h2>
        <p className="hint">{ownPerson ? "FLUX relights the frame itself: the same person, pose, framing and setting under a new light." : "Image 1 supplies the character and background. Image 2 supplies the pose and body cut."}</p>
        <p className="hint">Missing the FLUX model files? <a href="https://huggingface.co/black-forest-labs/flux-3-image-klein-comfy" target="_blank" rel="noopener noreferrer">Download FLUX 3 Image Klein files</a>.</p>
        <p className="hint"><strong>Prompt upsampler required.</strong> This workflow needs the <a href="https://huggingface.co/black-forest-labs/flux-3-image-klein-comfy/blob/main/text_encoders/qwen3.5_9b_flux3_prompt_upsampler_int8_convrot.safetensors" target="_blank" rel="noopener noreferrer">Qwen3.5 9B FLUX prompt upsampler</a> to expand the edit prompt before image generation. Download it into <code>ComfyUI/models/text_encoders</code>.</p>
        <label>Relight<select className="file-name" value={look} disabled={busy} onChange={(event) => { invalidate(); setLook(Number(event.target.value)); }}>
          {!ownPerson && <option value={-1}>Off · keep the picture's light</option>}
          {LIGHT_LOOKS.map((item, index) => <option key={item.name} value={index}>{item.name}</option>)}
          <option value={LIGHT_LOOKS.length}>My own light</option>
        </select></label>
        {LIGHT_LOOKS[look] && <figure style={{ margin: 0, display: "grid", gap: 6 }}><img className="picture-reference" src={LIGHT_LOOKS[look].image} alt={`${LIGHT_LOOKS[look].name} example`} style={{ width: 200 }} /><small>Example on one portrait. Your picture and seed will differ.</small></figure>}
        {relight && !ownPerson && <p className="hint">Poses and relights the character in one FLUX pass at 3 MP, about 2 minutes. FLUX sees only image 1; image 2 reaches it as a written pose, so nothing of the video's person leaks in. The light usually changes the background too. Results vary a lot by seed; try two or three.</p>}
        {look === LIGHT_LOOKS.length && <label>Your light<textarea className="report" rows={3} value={ownLight} disabled={busy} onChange={(event) => { invalidate(); setOwnLight(event.target.value); }} /></label>}
        {ownPerson && <label>Framing<select className="file-name" value={keepCrop ? "keep" : "free"} disabled={busy} onChange={(event) => { invalidate(); setKeepCrop(event.target.value === "keep"); }}>
          <option value="free">FLUX may recompose · strongest light, may zoom out</option>
          <option value="keep">Keep the frame's crop · starts from the frame</option>
        </select></label>}
        {ownPerson && keepCrop && <label className="setting">
          <span>Denoise <small>{denoise.toFixed(2)}. Lower keeps more of the frame; near 1 FLUX may zoom out again.</small></span>
          <input type="range" min={0.8} max={0.99} step={0.01} value={denoise} disabled={busy} onChange={(event) => { invalidate(); setDenoise(Number(event.target.value)); }} />
        </label>}
        {ownPerson
          ? <label>FLUX relight prompt · {"{look}"} is the light<textarea className="report" rows={4} value={framePrompt} disabled={busy} onChange={(event) => { invalidate(); setFramePrompt(event.target.value); }} /></label>
          : relight
          ? <label>FLUX relight prompt · {"{look}"} is the light<textarea className="report" rows={6} value={relightPrompt} disabled={busy} onChange={(event) => { invalidate(); setRelightPrompt(event.target.value); }} /></label>
          : <label>FLUX edit prompt<textarea className="report" rows={6} value={prompt} disabled={busy} onChange={(event) => { invalidate(); setPrompt(event.target.value); }} /></label>}
        <label>Seed<input className="target-input" type="number" min={0} max={MAX_SEED} step={1} value={seed} disabled={busy} onChange={(event) => { invalidate(); setSeed(Number(event.target.value)); }} /></label>
        <button className="primary" disabled={busy || !ready} onClick={() => prepare(seed)}>Generate preview image</button>
        <p className="hint">This step only generates an image. After reviewing it, choose the video settings and press Render video.</p>
      </section>
    </div>}
    {busy && <p role="status">{submitting ? "Submitting…" : job?.stage === "prepare" ? "FLUX is preparing the image…" : job?.stage === "describe" ? "Describing the video…" : "Generating normals and rendering the video…"}</p>}
    {error && <p className="error" role="alert">{error}</p>}
    {preview && !approved && <section className="panel">
      <h2><span>3</span> Review before rendering</h2>
      <div className="inputs picture-comparison">
        <figure><figcaption>Source frame{ownPerson ? "" : " · image 2"}</figcaption><img src={preview.frame} alt="Raw source video frame used for pose and body cut" /></figure>
        <figure><figcaption>FLUX prepared image</figcaption><img src={preview.url} alt="FLUX generated character in the source pose" /></figure>
      </div>
      <p className="hint">Check the pose, framing, character and background. The video will use this exact prepared image.</p>
      <div className="row">
        <a href={preview.url} download="prepared-frame.png">Download image</a>
        <button className="secondary" disabled={busy || !ready} onClick={() => prepare((seed + 1) % (MAX_SEED + 1))}>Generate another image</button>
        <button className="primary" disabled={busy} onClick={() => { setApproved(true); remember(null, prepared, true); if (!description) void describe(); }}>Use this image</button>
      </div>
    </section>}
    {preview && approved && <section className="panel">
      <h2><span>4</span> Video render settings</h2>
      <div className="row"><img className="picture-reference" src={preview.url} alt="Approved FLUX image for the video" style={{ width: 120, maxHeight: 180 }} /><button className="secondary" disabled={busy} onClick={() => { setApproved(false); remember(null, prepared, false); }}>Back to image review</button></div>
      <p className="hint">The approved image is reused without running FLUX again. Native H3 and SolarRenderer render one clip, up to 15 seconds, without a context loop.</p>
      <label>Video description · H3 reads it with the normal-map video<textarea className="report" rows={6} value={description} disabled={busy} onChange={(event) => keepDescription(event.target.value)} /></label>
      <small>The visual describer (<code>{describer}</code>) watches the part, two frames a second, and writes its actions, held objects and expressions; with a character picture it then rewrites them for the prepared image. Remove anything about the video person's looks, clothes or setting. Leave it empty to render without it.</small>
      <div className="row"><button className="secondary" disabled={busy} onClick={describe}>Describe again</button><small>Describe again after changing the video length.</small></div>
      {modelError && <p className="error" role="alert">{modelError}</p>}
      <fieldset disabled={busy} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
        <div className="inputs">
          <div className="panel">
            <label>Video renderer<select className="file-name" value={settings.renderer} onChange={(event) => setSettings({ ...settings, renderer: event.target.value as PictureVideoSettings["renderer"], steps: event.target.value === "solar" ? 4 : 6 })}><option value="solar">SolarRenderer</option><option value="h3">H3 · native</option></select></label>
            <label>Video length (seconds)<input className="steps-input" type="number" min={(settings.renderer === "solar" ? 22 : 5) / 24} max={duration ? Math.min(MAX_SECONDS, duration - start) : MAX_SECONDS} step={0.1} value={settings.seconds} onChange={(event) => setSettings({ ...settings, seconds: Number(event.target.value) })} /></label>
            <small>H3 rounds down to a valid clip length: {frames} frames / {(frames / 24).toFixed(3)} s at 24 fps.</small>
            {settings.renderer === "solar" && settings.seconds > 6 && <p className="hint" role="note"><strong>Longer render time:</strong> SolarRenderer clips longer than 6 seconds can take considerably longer to render, especially at higher resolutions.</p>}
            <label>Video resolution<select className="file-name" value={typeof settings.resolution === "string" ? settings.resolution : "custom"} onChange={(event) => setSettings({ ...settings, resolution: event.target.value === "custom" ? { width: canvas[0], height: canvas[1] } : event.target.value as PictureVideoSettings["resolution"] })}>{RESOLUTIONS.map((value) => <option key={value}>{value}</option>)}<option value="custom">Custom</option></select></label>
            {typeof settings.resolution === "object" && <div className="row">{(["width", "height"] as const).map((side) => <label key={side}>Custom {side}<input className="steps-input" type="number" min={CUSTOM_SIZE.min} max={CUSTOM_SIZE.max} step={CUSTOM_SIZE.step} value={typeof settings.resolution === "object" ? settings.resolution[side] : 0} onChange={(event) => setSettings({ ...settings, resolution: { width: canvas[0], height: canvas[1], [side]: Number(event.target.value) } })} /></label>)}</div>}
            <small>Video canvas: {canvas[0]}×{canvas[1]}.</small>
            <label>Motion reference resolution<select className="file-name" value={settings.motion} onChange={(event) => setSettings({ ...settings, motion: Number(event.target.value) as PictureVideoSettings["motion"] })}><option value={0}>Match video</option>{MOTION_SIZES.map((value) => <option key={value} value={value}>{value} px</option>)}</select></label>
            <small>The motion/mask resolution control uses a normal-map guide here. Its size is separate from the output video.</small>
            <label>Video seed<input className="steps-input" type="number" min={0} max={MAX_SEED} step={1} value={settings.seed} onChange={(event) => setSettings({ ...settings, seed: Number(event.target.value) })} /></label>
            <label>Steps<input className="steps-input" type="number" min={STEPS.min} max={settings.renderer === "solar" ? 50 : STEPS.max} value={settings.steps} onChange={(event) => setSettings({ ...settings, steps: Number(event.target.value) })} /></label>
            <small>{settings.renderer === "solar" ? "Use 4 with the SolarRenderer four-step and control LoRAs." : "Use 6 with DMAD; without a speed LoRA, use 20 or more."}</small>
          </div>
          <div className="panel">
            <p className="hint">Choose models and VAEs compatible with MiniMax H3.</p>
            {picker("Base model", settings.model, files.models, (model) => setSettings({ ...settings, model }))}
            {picker("H3 text encoder", settings.textEncoder, files.textEncoders, (textEncoder) => setSettings({ ...settings, textEncoder }))}
            {picker("Video VAE", settings.videoVae, files.vaes, (videoVae) => setSettings({ ...settings, videoVae }))}
            {settings.renderer === "h3" && picker("Audio VAE", settings.audioVae, files.vaes, (audioVae) => setSettings({ ...settings, audioVae }))}
            {settings.renderer === "solar" ? <>
              <label>SolarRenderer LoRA rank<select className="file-name" value={settings.solarRank} onChange={(event) => { const solarRank = Number(event.target.value) as 384 | 64; setSettings({ ...settings, solarRank, ...solarLoraFiles(solarRank, files.loras) }); }}><option value={384}>Rank 384 · original</option><option value={64}>Rank 64 · compressed</option></select></label>
              {picker("SolarRenderer four-step LoRA", settings.solarFourStep, files.loras, (solarFourStep) => setSettings({ ...settings, solarFourStep }))}
              {picker("SolarRenderer control LoRA", settings.solarControl, files.loras, (solarControl) => setSettings({ ...settings, solarControl }))}
              <p className="hint">Both LoRAs are required and run at strength 1. Select their paths inside <code>ComfyUI/models/loras</code>; subfolders such as <code>solar/</code> are supported.</p>
              <p className="hint">Rank 384: from <a href="https://huggingface.co/Enderfga/SolarRenderer" target="_blank" rel="noopener noreferrer">SolarRenderer</a>, download <a href="https://huggingface.co/Enderfga/SolarRenderer/blob/main/solarrenderer_4step_lora.safetensors" target="_blank" rel="noopener noreferrer">solarrenderer_4step_lora.safetensors</a> and <a href="https://huggingface.co/Enderfga/SolarRenderer/blob/main/solarrenderer_control_lora.safetensors" target="_blank" rel="noopener noreferrer">solarrenderer_control_lora.safetensors</a>.</p>
              <p className="hint">For rank 64, download the four-step and control files from <a href="https://huggingface.co/mdevoz/SolarRendererRank64" target="_blank" rel="noopener noreferrer">SolarRendererRank64</a>, then select them above.</p>
              <p className="hint">Requires the <a href="https://github.com/Enderfga/SolarRenderer/tree/main/comfyui" target="_blank" rel="noopener noreferrer">SolarRenderer custom nodes</a>. Restart ComfyUI after installing them, and reload this page after adding LoRA files.</p>
            </> : <>
            <label className="setting toggle"><span>Use LoRAs</span><input type="checkbox" checked={settings.useLoras} onChange={(event) => setSettings({ ...settings, useLoras: event.target.checked })} /><i /></label>
            {settings.useLoras && <>{settings.loras.map((lora, index) => <div className="panel" key={index}>
              {picker(`LoRA ${index + 1}`, lora.name, files.loras, (name) => setSettings({ ...settings, loras: settings.loras.map((item, i) => i === index ? { ...item, name } : item) }))}
              <label>LoRA {index + 1} strength<input className="steps-input" type="number" min={STRENGTH.min} max={STRENGTH.max} step={0.05} value={lora.strength} onChange={(event) => setSettings({ ...settings, loras: settings.loras.map((item, i) => i === index ? { ...item, strength: Number(event.target.value) } : item) })} /></label>
              <label className="setting toggle"><span>Use LoRA {index + 1}</span><input type="checkbox" checked={lora.enabled} onChange={(event) => setSettings({ ...settings, loras: settings.loras.map((item, i) => i === index ? { ...item, enabled: event.target.checked } : item) })} /><i /></label>
              <button className="secondary" onClick={() => setSettings({ ...settings, loras: settings.loras.filter((_, i) => i !== index) })}>Remove LoRA {index + 1}</button>
            </div>)}<button className="secondary" disabled={settings.loras.length >= MAX_LORAS} onClick={() => setSettings({ ...settings, loras: [...settings.loras, { name: files.loras[0] ?? "", strength: 1, enabled: true }] })}>Add LoRA</button></>}
            </>}
          </div>
        </div>
      </fieldset>
      <button className="primary" disabled={busy} onClick={render}>Render video</button>
    </section>}
    {result && <section className="panel"><h2>Video result</h2><video src={result} controls /><a href={result} download="picture-motion.mp4">Download video</a></section>}
  </div>;
}
