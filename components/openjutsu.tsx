"use client";

import { useEffect, useState, type DragEvent, type ReactNode } from "react";
import type { PublicJob } from "../lib/comfy.ts";
import type { NodeInfo } from "../lib/progress.ts";
import { clipCount } from "../lib/clips.ts";
import { CLIP_SECONDS, MAX_PICTURES, MAX_SEED, RESOLUTIONS, type Resolution } from "../lib/simple.ts";

type Character = { file: File; url: string; role: string };
type Run = { id: string; clips: number; startedAt: number };
type Progress = NodeInfo & { step: number | null; steps: number | null };

const TERMINAL = new Set(["succeeded", "failed", "canceled", "expired"]);
const RUN_KEY = "openjutsu.run";

const MODES = [
  { id: "simple", title: "Simple motion transfer", text: "Swap everyone in a video for your characters.", ready: true },
  { id: "advanced", title: "Advanced motion transfer", text: "Pick who becomes who by colour-coded tracks.", ready: false },
  { id: "object", title: "Object swap", text: "Replace a prop or product instead of a person.", ready: false },
];

function readRun(): Run | null {
  try {
    return JSON.parse(localStorage.getItem(RUN_KEY) ?? "null");
  } catch {
    return null;
  }
}

function writeRun(run: Run | null) {
  try {
    if (run) localStorage.setItem(RUN_KEY, JSON.stringify(run));
    else localStorage.removeItem(RUN_KEY);
  } catch {}
}

function droppedFiles(event: DragEvent, kind: "video" | "image") {
  event.preventDefault();
  return [...event.dataTransfer.files].filter((file) => file.type.startsWith(`${kind}/`) || (kind === "video" && /\.(mkv|mov|avi)$/i.test(file.name)));
}

function elapsed(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

// Rough share of a clip done at each node: the sampler is most of the time.
function clipShare(progress: Progress) {
  if (progress.classType === "SamplerCustomAdvanced") return 0.15 + 0.75 * (progress.steps ? (progress.step ?? 0) / progress.steps : 0);
  if (["VAEDecode", "VAEDecodeAudio", "MiniMaxH3LoopTrim", "MiniMaxH3ChainSegmentSave", "MiniMaxH3ChainReview"].includes(progress.classType)) return 0.95;
  return 0.05;
}

function DropZone({ accept, onFiles, multiple, children, className }: {
  accept: string; onFiles: (files: File[]) => void; multiple?: boolean; children: ReactNode; className?: string;
}) {
  const [over, setOver] = useState(false);
  const kind = accept.startsWith("video") ? "video" : "image";
  return (
    <label
      className={`drop ${over ? "over" : ""} ${className ?? ""}`}
      onDragOver={(event) => { event.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(event) => { setOver(false); onFiles(droppedFiles(event, kind)); }}
    >
      <input type="file" accept={accept} multiple={multiple} hidden onChange={(event) => { onFiles([...(event.target.files ?? [])]); event.target.value = ""; }} />
      {children}
    </label>
  );
}

export function Openjutsu() {
  const [video, setVideo] = useState<{ file: File; url: string; duration: number } | null>(null);
  const [characters, setCharacters] = useState<Character[]>([]);
  const [resolution, setResolution] = useState<Resolution>("736p");
  const [hatFix, setHatFix] = useState(false);
  const [seed, setSeed] = useState(0);
  const [clipSeconds, setClipSeconds] = useState(CLIP_SECONDS.default);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");

  const [run, setRun] = useState<Run | null>(null);
  const [job, setJob] = useState<PublicJob | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [preview, setPreview] = useState("");
  const [streamError, setStreamError] = useState("");
  const [now, setNow] = useState(Date.now());

  useEffect(() => setRun(readRun()), []);

  useEffect(() => {
    if (!run) return;
    const source = new EventSource(`/api/jobs/${run.id}/events`);
    source.onmessage = (message) => {
      const event = JSON.parse(message.data);
      if (event.type === "job") {
        setJob(event.job);
        setStreamError("");
        if (TERMINAL.has(event.job.status)) source.close();
      } else if (event.type === "status") {
        setJob((current) => current && { ...current, status: event.status, queuePosition: event.queuePosition });
      } else if (event.type === "progress" && event.node) {
        setProgress({ ...event.node, step: event.step, steps: event.steps });
      } else if (event.type === "preview") {
        setPreview(event.url);
      } else if (event.type === "error") {
        setStreamError(event.message);
      }
    };
    return () => source.close();
  }, [run]);

  const running = !!run && !(job && TERMINAL.has(job.status));
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [running]);

  function chooseVideo(files: File[]) {
    const file = files[0];
    if (!file) return;
    if (video) URL.revokeObjectURL(video.url);
    const url = URL.createObjectURL(file);
    setVideo({ file, url, duration: 0 });
    const probe = document.createElement("video");
    probe.preload = "metadata";
    probe.onloadedmetadata = () => setVideo((current) => (current?.url === url ? { ...current, duration: probe.duration } : current));
    probe.src = url;
  }

  function addCharacters(files: File[]) {
    setCharacters((current) => [
      ...current,
      ...files.slice(0, MAX_PICTURES - current.length).map((file) => ({ file, url: URL.createObjectURL(file), role: "" })),
    ]);
  }

  function removeCharacter(index: number) {
    URL.revokeObjectURL(characters[index].url);
    setCharacters(characters.filter((_, i) => i !== index));
  }

  const clips = video?.duration ? clipCount(video.duration, clipSeconds) : 0;

  async function generate() {
    if (!video || !characters.length) return;
    setSubmitting(true);
    setFormError("");
    const form = new FormData();
    form.set("mode", "simple");
    form.set("video", video.file);
    characters.forEach((character, i) => {
      form.set(`picture_${i + 1}`, character.file);
      form.set(`role_${i + 1}`, character.role);
    });
    form.set("resolution", resolution);
    form.set("hat_fix", String(hatFix));
    form.set("seed", String(seed));
    form.set("clip_seconds", String(clipSeconds));
    try {
      const response = await fetch("/api/jobs", { method: "POST", body: form });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Could not start the job.");
      const next = { id: body.id, clips: Math.max(clips, 1), startedAt: Date.now() };
      writeRun(next);
      setJob(body);
      setProgress(null);
      setPreview("");
      setStreamError("");
      setRun(next);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Could not start the job.");
    } finally {
      setSubmitting(false);
    }
  }

  async function cancel() {
    if (!run) return;
    const response = await fetch(`/api/jobs/${run.id}`, { method: "DELETE" });
    if (response.ok) setJob(await response.json());
  }

  function reset() {
    writeRun(null);
    setRun(null);
    setJob(null);
    setProgress(null);
    setPreview("");
    setStreamError("");
  }

  return (
    <main className="shell">
      <header className="top">
        <div className="brand">
          <span className="mark" aria-hidden>忍</span>
          <div>
            <h1>Openjutsu</h1>
            <p>Swap the people in any video for your own characters. Open weights, on your own GPU.</p>
          </div>
        </div>
      </header>

      <nav className="modes" aria-label="Mode">
        {MODES.map((mode) => (
          <button key={mode.id} className={`mode ${mode.ready ? "active" : ""}`} disabled={!mode.ready} aria-pressed={mode.ready}>
            <strong>{mode.title}</strong>
            <span>{mode.text}</span>
            {!mode.ready && <em>Coming soon</em>}
          </button>
        ))}
      </nav>

      {run ? (
        <RunView
          run={run} job={job} progress={progress} preview={preview} streamError={streamError} now={now}
          onCancel={cancel} onReset={reset}
        />
      ) : (
        <>
          <section className="inputs">
            <div className="panel">
              <h2><span>1</span> Source video</h2>
              {video ? (
                <div className="video-pick">
                  <video src={video.url} controls muted playsInline />
                  <div className="row">
                    <small>{video.file.name}{video.duration ? ` · ${video.duration.toFixed(1)} s` : ""}</small>
                    <DropZone accept="video/*,.mkv" onFiles={chooseVideo} className="link">Replace</DropZone>
                  </div>
                </div>
              ) : (
                <DropZone accept="video/*,.mkv" onFiles={chooseVideo} className="big">
                  <strong>Drop a video</strong>
                  <span>or click to browse. Its camera, cuts, motion and soundtrack are kept.</span>
                </DropZone>
              )}
            </div>

            <div className="panel">
              <h2><span>2</span> Characters <small>{characters.length}/{MAX_PICTURES}</small></h2>
              <div className="characters">
                {characters.map((character, i) => (
                  <div className="character" key={character.url}>
                    <img src={character.url} alt={`Character ${i + 1}`} />
                    <button className="remove" onClick={() => removeCharacter(i)} aria-label={`Remove character ${i + 1}`}>×</button>
                    <label>
                      <span>Replaces who?</span>
                      <input
                        value={character.role}
                        maxLength={200}
                        placeholder={i === 0 ? "e.g. the singer" : "e.g. the drummer"}
                        onChange={(event) => setCharacters(characters.map((c, j) => (j === i ? { ...c, role: event.target.value } : c)))}
                      />
                    </label>
                  </div>
                ))}
                {characters.length < MAX_PICTURES && (
                  <DropZone accept="image/*" multiple onFiles={addCharacters} className="add">
                    <strong>+</strong>
                    <span>{characters.length ? "Add another" : "Drop 1-4 photos"}</span>
                  </DropZone>
                )}
              </div>
              <p className="hint">
                One photo per person in the video. Leave &ldquo;replaces who?&rdquo; blank to match by screen time. Name a role or position
                (&ldquo;the drummer&rdquo;, &ldquo;the person on the left&rdquo;), not clothes.
              </p>
            </div>
          </section>

          <section className="panel settings">
            <h2><span>3</span> Settings</h2>
            <div className="setting">
              <span>Resolution</span>
              <div className="segmented">
                {RESOLUTIONS.map((r) => (
                  <button key={r} className={r === resolution ? "on" : ""} onClick={() => setResolution(r)}>{r}</button>
                ))}
              </div>
            </div>
            <label className="setting toggle">
              <span>Hat fix <small>Also replaces hats (about 45 s more per clip).</small></span>
              <input type="checkbox" checked={hatFix} onChange={(event) => setHatFix(event.target.checked)} />
              <i aria-hidden />
            </label>
            <details>
              <summary>Advanced</summary>
              <div className="setting">
                <span>Seed <small>Change it for a new take.</small></span>
                <div className="seed">
                  <input type="number" min={0} max={MAX_SEED} value={seed} onChange={(event) => setSeed(Math.min(MAX_SEED, Math.max(0, Math.floor(Number(event.target.value) || 0))))} />
                  <button onClick={() => setSeed(Math.floor(Math.random() * MAX_SEED))} aria-label="Random seed">🎲</button>
                </div>
              </div>
              <div className="setting">
                <span>Clip length <small>{clipSeconds.toFixed(1)} s per H3 generation</small></span>
                <input type="range" min={CLIP_SECONDS.min} max={CLIP_SECONDS.max} step={0.5} value={clipSeconds} onChange={(event) => setClipSeconds(Number(event.target.value))} />
              </div>
            </details>
          </section>

          <div className="go">
            {formError && <p className="error">{formError}</p>}
            <button className="primary" disabled={!video || !characters.length || submitting} onClick={generate}>
              {submitting ? "Uploading…" : "Generate"}
            </button>
            <small>{clips ? `${clips} clip${clips > 1 ? "s" : ""} at ${resolution}` : "Add a video and at least one character."}</small>
          </div>
        </>
      )}
    </main>
  );
}

function RunView({ run, job, progress, preview, streamError, now, onCancel, onReset }: {
  run: Run; job: PublicJob | null; progress: Progress | null; preview: string; streamError: string; now: number;
  onCancel: () => void; onReset: () => void;
}) {
  const status = job?.status ?? "queued";
  const clips = Math.max(run.clips, progress?.clip ?? 1);

  if (status === "succeeded" && job?.video) {
    return (
      <section className="panel result">
        <video src={job.video.url} controls autoPlay playsInline />
        <div className="row">
          <a className="primary" href={`${job.video.url}?download`} download={job.video.name}>Download MP4</a>
          <button className="secondary" onClick={onReset}>New swap</button>
        </div>
      </section>
    );
  }

  if (TERMINAL.has(status)) {
    return (
      <section className="panel">
        <h2>{status === "canceled" ? "Canceled" : status === "succeeded" ? "Finished without a video" : status === "expired" ? "Job no longer available" : "Something went wrong"}</h2>
        {job?.error && <p className="error">{job.error}</p>}
        {status === "expired" && <p className="hint">ComfyUI no longer knows this job, for example after a restart. Finished videos are in ComfyUI&apos;s output/h3_oneclick_swap folder.</p>}
        <button className="secondary" onClick={onReset}>Back</button>
      </section>
    );
  }

  let fraction = 0;
  if (progress?.classType === "MiniMaxH3ChainAssemble") fraction = 0.99;
  else if (progress?.clip) fraction = (progress.clip - 1 + clipShare(progress)) / clips;

  return (
    <section className="panel progress">
      <div className="row">
        <h2>{status === "queued" ? `Queued${job?.queuePosition ? ` (#${job.queuePosition})` : ""}` : progress?.clip ? `Clip ${progress.clip} of ${clips}` : "Preparing"}</h2>
        <span className="time">{elapsed(now - run.startedAt)}</span>
      </div>
      <div className="bar"><div style={{ width: `${Math.round(fraction * 100)}%` }} /></div>
      <p className="node">
        {progress ? progress.title : status === "queued" ? "Waiting for ComfyUI…" : "Working…"}
        {progress?.steps ? ` · step ${progress.step ?? 0}/${progress.steps}` : ""}
      </p>
      {preview && <img className="preview" src={preview} alt="Mask preview: white areas are regenerated" />}
      {streamError && <p className="error">{streamError}</p>}
      <p className="hint">Each clip is saved as it finishes, so a rerun with the same inputs resumes where it stopped. You can close this page and come back.</p>
      <button className="secondary" onClick={onCancel}>Cancel</button>
    </section>
  );
}
