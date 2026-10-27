"use client";

import { useEffect, useState } from "react";
import { MAX_SEED } from "../lib/simple.ts";

const PROMPT = "change <image 1> character pose follow the  <image 2> pose. keep the final image as same body cut as <image 2> . do not change the background of <image 1> and do not add anything extra in <image 1>.";
const STORAGE = "openjutsu.picture-preview";
type Job = { id: string; stage: "prepare" | "render" };

export function FromPicture({ initialVideo, initialPicture, start: initialStart = 0 }: { initialVideo?: File; initialPicture?: File; start?: number }) {
  const [video, setVideo] = useState<File | null>(initialVideo ?? null);
  const [picture, setPicture] = useState<File | null>(initialPicture ?? null);
  const [videoUrl, setVideoUrl] = useState("");
  const [pictureUrl, setPictureUrl] = useState("");
  const [size, setSize] = useState<[number, number] | null>(null);
  const [start, setStart] = useState(initialStart);
  const [seed, setSeed] = useState(0);
  const [prompt, setPrompt] = useState(PROMPT);
  const [job, setJob] = useState<Job | null>(null);
  const [prepared, setPrepared] = useState("");
  const [preview, setPreview] = useState<{ url: string; frame: string } | null>(null);
  const [result, setResult] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const busy = submitting || !!job;

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE) ?? "null");
      if (typeof saved?.prepared === "string") setPrepared(saved.prepared);
      if (typeof saved?.job?.id === "string" && ["prepare", "render"].includes(saved.job.stage)) {
        setJob(saved.job);
        if (saved.job.stage === "render" && saved.prepared) {
          const base = `/api/picture?id=${encodeURIComponent(saved.prepared)}`;
          setPreview({ url: `${base}&media=result`, frame: `${base}&media=frame` });
        }
      }
      else if (typeof saved?.prepared === "string" && saved.prepared) setJob({ id: saved.prepared, stage: "prepare" });
    } catch {}
  }, []);
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

  function remember(next: Job | null, image: string) {
    try { localStorage.setItem(STORAGE, JSON.stringify({ job: next, prepared: image })); } catch {}
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
          if ([400, 404, 422].includes(response.status)) { setJob(null); remember(null, prepared); }
          else timer = setTimeout(poll, 5000);
          return;
        }
        setError("");
        if (data.status !== "ready") { timer = setTimeout(poll, 2000); return; }
        if (job!.stage === "prepare") {
          setPrepared(job!.id); setPreview({ url: data.url, frame: data.frame }); remember(null, job!.id);
        } else { setResult(data.url); remember(job, prepared); }
        setJob(null);
      } catch {
        if (!controller.signal.aborted) { setError("Connection interrupted. Retrying…"); timer = setTimeout(poll, 5000); }
      }
    }
    void poll();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [job, prepared]);

  function invalidate() {
    setPrepared(""); setPreview(null); setResult(""); setError(""); remember(null, "");
  }
  async function prepare(nextSeed: number) {
    if (!video || !picture || !size) return;
    setSubmitting(true); invalidate(); setSeed(nextSeed);
    try {
      const form = new FormData();
      form.set("video", video); form.set("picture", picture); form.set("start", String(start)); form.set("seed", String(nextSeed));
      form.set("width", String(size[0])); form.set("height", String(size[1])); form.set("prompt", prompt);
      const response = await fetch("/api/picture", { method: "POST", body: form });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      const next: Job = { id: data.id, stage: "prepare" }; remember(next, ""); setJob(next);
    } catch (error) { setError((error as Error).message); }
    finally { setSubmitting(false); }
  }
  async function render() {
    if (!prepared || !preview) return;
    setSubmitting(true); setError(""); setResult("");
    try {
      const response = await fetch("/api/picture", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prepared }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      const next: Job = { id: data.id, stage: "render" }; remember(next, prepared); setJob(next);
    } catch (error) { setError((error as Error).message); }
    finally { setSubmitting(false); }
  }

  return <div className="picture-pipeline">
    <p className="hint">Prepare the character in the video's starting pose with FLUX. Review the image first, then render its motion while keeping the picture's background.</p>
    <div className="inputs">
      <section className="panel">
        <h2><span>1</span> Character and source video</h2>
        <label>Source video<input type="file" accept="video/*,.mkv" disabled={busy} onChange={(event) => { const file = event.target.files?.[0]; if (file) { invalidate(); setVideo(file); setStart(0); } }} /></label>
        {videoUrl && <video src={videoUrl} controls preload="metadata" onLoadedMetadata={(event) => setSize([event.currentTarget.videoWidth, event.currentTarget.videoHeight])} />}
        <label>Character picture · image 1<input type="file" accept="image/png,image/jpeg,image/webp" disabled={busy} onChange={(event) => { const file = event.target.files?.[0]; if (file) { invalidate(); setPicture(file); } }} /></label>
        {pictureUrl && <img className="picture-reference" src={pictureUrl} alt="Character and background reference" />}
        <label>Start at (seconds)<input className="target-input" type="number" min={0} step={0.1} value={start} disabled={busy} onChange={(event) => { invalidate(); setStart(Number(event.target.value)); }} /></label>
        <small>The raw frame at this time is image 2. Video test: one 5.875-second clip from here, at a 480 px short edge.</small>
      </section>
      <section className="panel">
        <h2><span>2</span> Prepare the first frame</h2>
        <p className="hint">Image 1 supplies the character and background. Image 2 supplies the pose and body cut.</p>
        <label>FLUX edit prompt<textarea className="report" rows={6} value={prompt} disabled={busy} onChange={(event) => { invalidate(); setPrompt(event.target.value); }} /></label>
        <label>Seed<input className="target-input" type="number" min={0} max={MAX_SEED} step={1} value={seed} disabled={busy} onChange={(event) => { invalidate(); setSeed(Number(event.target.value)); }} /></label>
        <button className="primary" disabled={busy || !video || !picture || !size} onClick={() => prepare(seed)}>Generate preview image</button>
        <p className="hint">This step only generates an image. Video rendering starts when you choose to use the preview.</p>
      </section>
    </div>
    {busy && <p role="status">{submitting ? "Submitting…" : job?.stage === "prepare" ? "FLUX is preparing the image…" : "Generating normals and rendering the video…"}</p>}
    {error && <p className="error" role="alert">{error}</p>}
    {preview && <section className="panel">
      <h2><span>3</span> Review before rendering</h2>
      <div className="inputs picture-comparison">
        <figure><figcaption>Source frame · image 2</figcaption><img src={preview.frame} alt="Raw source video frame used for pose and body cut" /></figure>
        <figure><figcaption>FLUX prepared image</figcaption><img src={preview.url} alt="FLUX generated character in the source pose" /></figure>
      </div>
      <p className="hint">Check the pose, framing, character and background. The video will use this exact prepared image.</p>
      <div className="row">
        <a href={preview.url} download="prepared-frame.png">Download image</a>
        <button className="secondary" disabled={busy || !video || !picture || !size} onClick={() => prepare((seed + 1) % (MAX_SEED + 1))}>Generate another image</button>
        <button className="primary" disabled={busy} onClick={render}>Use this image · render video</button>
      </div>
    </section>}
    {result && <section className="panel"><h2>Video result</h2><video src={result} controls /><a href={result} download="picture-motion.mp4">Download video</a></section>}
  </div>;
}
