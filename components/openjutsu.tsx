"use client";

import { useEffect, useRef, useState, type DragEvent, type ReactNode } from "react";
import type { PublicJob } from "../lib/comfy.ts";
import type { NodeInfo } from "../lib/progress.ts";
import { clipCount, clipStarts } from "../lib/clips.ts";
import { CLIP_SECONDS, MARGINS, MAX_SEED, RESOLUTIONS, type Margin, type Resolution } from "../lib/simple.ts";

type Character = { file: File; url: string; role: string };
type Kind = "simple" | "mask";
type Run = { id: string; kind: Kind; margin: Margin; clips: number; clipSeconds: number; startedAt: number };
type Progress = NodeInfo & { step: number | null; steps: number | null };

const TERMINAL = new Set(["succeeded", "failed", "canceled", "expired"]);
const RUN_KEY = "openjutsu.run";

const MODES = [
  { id: "simple", title: "Simple motion transfer", text: "Swap the main person in a video for your character.", ready: true },
  { id: "advanced", title: "Advanced motion transfer", text: "Several people, pick who becomes who.", ready: false },
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

function MarginPicker({ value, onChange }: { value: Margin; onChange: (margin: Margin) => void }) {
  return (
    <div className="segmented">
      {(Object.keys(MARGINS) as Margin[]).map((m) => (
        <button key={m} className={m === value ? "on" : ""} onClick={() => onChange(m)}>{m[0].toUpperCase() + m.slice(1)}</button>
      ))}
    </div>
  );
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
  const [character, setCharacter] = useState<Character | null>(null);
  const [resolution, setResolution] = useState<Resolution>("736p");
  const [hatFix, setHatFix] = useState(false);
  const [margin, setMargin] = useState<Margin>("normal");
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
    const source = new EventSource(`/api/jobs/${run.id}/events?kind=${run.kind ?? "simple"}`);
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

  function chooseCharacter(files: File[]) {
    const file = files[0];
    if (!file) return;
    if (character) URL.revokeObjectURL(character.url);
    setCharacter({ file, url: URL.createObjectURL(file), role: character?.role ?? "" });
  }

  function removeCharacter() {
    if (character) URL.revokeObjectURL(character.url);
    setCharacter(null);
  }

  const clips = video?.duration ? clipCount(video.duration, clipSeconds) : 0;

  async function submit(kind: Kind) {
    if (!video || (kind === "simple" && !character)) return;
    setSubmitting(true);
    setFormError("");
    const form = new FormData();
    form.set("mode", kind);
    form.set("video", video.file);
    form.set("hat_fix", String(hatFix));
    form.set("margin", margin);
    if (kind === "simple" && character) {
      form.set("picture", character.file);
      form.set("role", character.role);
      form.set("resolution", resolution);
      form.set("seed", String(seed));
      form.set("clip_seconds", String(clipSeconds));
    }
    try {
      const response = await fetch("/api/jobs", { method: "POST", body: form });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Could not start the job.");
      const next: Run = { id: body.id, kind, margin, clips: Math.max(clips, 1), clipSeconds, startedAt: Date.now() };
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
            <p>Swap the person in any video for your own character. Open weights, on your own GPU.</p>
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
          onCancel={cancel} onReset={reset} onGenerate={video && character && !submitting ? () => submit("simple") : null}
          margin={margin} onMargin={setMargin} onRecheck={video && !submitting ? () => submit("mask") : null}
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
              <h2><span>2</span> Character</h2>
              <div className="characters">
                {character ? (
                  <div className="character">
                    <img src={character.url} alt="Character" />
                    <button className="remove" onClick={removeCharacter} aria-label="Remove the character">×</button>
                    <label>
                      <span>Who do they replace? (optional)</span>
                      <input
                        value={character.role}
                        maxLength={200}
                        placeholder="e.g. the singer"
                        onChange={(event) => setCharacter({ ...character, role: event.target.value })}
                      />
                    </label>
                  </div>
                ) : (
                  <DropZone accept="image/*" onFiles={chooseCharacter} className="add">
                    <strong>+</strong>
                    <span>Drop a photo</span>
                  </DropZone>
                )}
              </div>
              <p className="hint">
                The character replaces the main person in the video, the one who fills the most of the frame. Everyone else stays.
                To name them for the prompt, use a role (&ldquo;the singer&rdquo;), not clothes.
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
            <div className="setting">
              <span>Mask margin <small>Room around the person for a differently built character. Check mask shows it.</small></span>
              <MarginPicker value={margin} onChange={setMargin} />
            </div>
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
            <div className="row">
              <button className="secondary" disabled={!video || submitting} onClick={() => submit("mask")}>Check mask</button>
              <button className="primary" disabled={!video || !character || submitting} onClick={() => submit("simple")}>
                {submitting ? "Uploading…" : "Generate"}
              </button>
            </div>
            <small>{clips ? `${clips} clip${clips > 1 ? "s" : ""} at ${resolution}` : "Add a video and a character photo."}</small>
          </div>
        </>
      )}
    </main>
  );
}

function RunView({ run, job, progress, preview, streamError, now, onCancel, onReset, onGenerate, margin, onMargin, onRecheck }: {
  run: Run; job: PublicJob | null; progress: Progress | null; preview: string; streamError: string; now: number;
  onCancel: () => void; onReset: () => void; onGenerate: (() => void) | null;
  margin: Margin; onMargin: (margin: Margin) => void; onRecheck: (() => void) | null;
}) {
  const status = job?.status ?? "queued";
  const clips = Math.max(run.clips, progress?.clip ?? 1);
  const mask = run.kind === "mask";

  if (mask && status === "succeeded" && job?.video) {
    return (
      <MaskCheck
        url={job.video.url} clipSeconds={run.clipSeconds} checked={run.margin ?? "normal"} margin={margin}
        onMargin={onMargin} onRecheck={onRecheck} onGenerate={onGenerate} onBack={onReset}
      />
    );
  }

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
  if (mask) fraction = progress?.classType === "SAM3_VideoTrack" && progress.steps ? (progress.step ?? 0) / progress.steps : 0;
  else if (progress?.classType === "MiniMaxH3ChainAssemble") fraction = 0.99;
  else if (progress?.clip) fraction = (progress.clip - 1 + clipShare(progress)) / clips;

  return (
    <section className="panel progress">
      <div className="row">
        <h2>{status === "queued" ? `Queued${job?.queuePosition ? ` (#${job.queuePosition})` : ""}` : mask ? "Checking the mask" : progress?.clip ? `Clip ${progress.clip} of ${clips}` : "Preparing"}</h2>
        <span className="time">{elapsed(now - run.startedAt)}</span>
      </div>
      <div className="bar"><div style={{ width: `${Math.round(fraction * 100)}%` }} /></div>
      <p className="node">
        {progress ? progress.title : status === "queued" ? "Waiting for ComfyUI…" : "Working…"}
        {progress?.steps ? ` · step ${progress.step ?? 0}/${progress.steps}` : ""}
      </p>
      {preview && <img className="preview" src={preview} alt="Mask preview: white areas are regenerated" />}
      {streamError && <p className="error">{streamError}</p>}
      <p className="hint">{mask ? "SAM tracks the whole video once, about a minute per 3 s of video." : "Each clip is saved as it finishes, so a rerun with the same inputs resumes where it stopped."} You can close this page and come back.</p>
      <button className="secondary" onClick={onCancel}>Cancel</button>
    </section>
  );
}

function MaskCheck({ url, clipSeconds, checked, margin, onMargin, onRecheck, onGenerate, onBack }: {
  url: string; clipSeconds: number; checked: Margin; margin: Margin; onMargin: (margin: Margin) => void;
  onRecheck: (() => void) | null; onGenerate: (() => void) | null; onBack: () => void;
}) {
  const player = useRef<HTMLVideoElement>(null);
  const [frames, setFrames] = useState(0);
  const [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(false);
  const starts = frames ? clipStarts(frames / 24, clipSeconds) : [0];

  function seek(target: number) {
    const v = player.current;
    if (!v || !frames) return;
    v.pause();
    setPlaying(false);
    const next = Math.max(0, Math.min(frames - 1, target));
    setFrame(next);
    v.currentTime = (next + 0.5) / 24;
  }

  function toggle() {
    const v = player.current;
    if (!v) return;
    if (playing) v.pause();
    else v.play();
    setPlaying(!playing);
  }

  return (
    <section className="panel mask-check">
      <h2>Check the mask</h2>
      <video
        ref={player} src={url} muted playsInline preload="auto"
        onLoadedMetadata={(event) => setFrames(Math.round(event.currentTarget.duration * 24))}
        onTimeUpdate={(event) => playing && setFrame(Math.min(frames - 1, Math.floor(event.currentTarget.currentTime * 24)))}
        onEnded={() => setPlaying(false)}
      />
      <input className="scrub" type="range" min={0} max={Math.max(frames - 1, 0)} value={frame} aria-label="Frame" onChange={(event) => seek(Number(event.target.value))} />
      <div className="row">
        <div className="steps">
          <button className="secondary" onClick={() => seek(frame - 1)} aria-label="Previous frame">◀</button>
          <button className="secondary" onClick={toggle}>{playing ? "Pause" : "Play"}</button>
          <button className="secondary" onClick={() => seek(frame + 1)} aria-label="Next frame">▶</button>
        </div>
        <small>Frame {frame + 1} / {frames} · {(frame / 24).toFixed(2)} s · clip {starts.filter((start) => start <= frame).length} of {starts.length}</small>
      </div>
      <p className="hint legend">
        <i className="swatch cyan" /> regenerated <i className="swatch orange" /> tracked person · right: the grey mannequin H3 copies the motion from.
        Anything outside the cyan area stays as it is, so the new character should fit inside it.
      </p>
      <p className="hint">The check tracks the whole video at once and the render tracks each clip, so they can differ slightly.</p>
      <div className="setting">
        <span>Mask margin <small>{margin === checked ? `Showing ${checked}.` : `Showing ${checked}; check again to see ${margin}.`} Tight keeps more background, loose gives a bigger character more room.</small></span>
        <MarginPicker value={margin} onChange={onMargin} />
      </div>
      <div className="row">
        {margin !== checked && <button className="primary" disabled={!onRecheck} onClick={() => onRecheck?.()}>Check again</button>}
        <button className={margin === checked ? "primary" : "secondary"} disabled={!onGenerate} onClick={() => onGenerate?.()}>
          {margin === checked ? "Looks good, generate" : `Generate with ${margin}`}
        </button>
        <button className="secondary" onClick={onBack}>Back to settings</button>
      </div>
      {!onGenerate && <p className="hint">Add a character photo in the settings to generate.</p>}
    </section>
  );
}
