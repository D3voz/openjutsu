"use client";

import { useEffect, useRef, useState, type DragEvent, type ReactNode } from "react";
import type { PublicJob } from "../lib/comfy.ts";
import type { NodeInfo } from "../lib/progress.ts";
import { clipCount, clipStarts } from "../lib/clips.ts";
import { CLIP_SECONDS, DEFAULT_TARGET, MARGINS, MAX_SEED, MIN_SECTION_SECONDS, MOTION_SIZES, RESOLUTIONS, CUSTOM_SIZE, canvasSize, type Margin, type MotionSize, type Resolution, type Section, type Size } from "../lib/simple.ts";
import { MAX_CHARACTERS } from "../lib/advanced.ts";
import { DEFAULT_MODEL, MAX_LORAS, STEPS, STRENGTH, type Lora } from "../lib/model.ts";
import type { EditMode } from "../lib/object.ts";
import { CHUNK_SECONDS, faceChunkCount, type FaceStyle } from "../lib/face.ts";
import { DEFAULT_PRESET, DEFAULT_TONE, DETAIL, TONE_MODES, TONE_RANGES, toneFromPreset, type ToneSettings, type ToneValue } from "../lib/color.ts";

type Character = { file: File; url: string; role: string };
type Mode = "simple" | "advanced" | "object" | "post";
type Post = "face" | "color";
type Kind = "simple" | "mask" | "advanced" | "advanced_maxq" | "object" | "face" | "color";
type TonePreset = { name: string; settings: Record<string, unknown> };
type Run = { id: string; kind: Kind; margin: Margin; clips: number; clipSeconds: number; startedAt: number };
// pass counts the sampler runs started so far: Fix faces samples its chunks one after another in the same node.
type Progress = NodeInfo & { step: number | null; steps: number | null; pass: number };

const TERMINAL = new Set(["succeeded", "failed", "canceled", "expired"]);
const RUN_KEY = "openjutsu.run";

const MODES = [
  { id: "simple", title: "Simple motion transfer", text: "Swap the main person in a video for your character.", ready: true },
  { id: "advanced", title: "Advanced motion transfer", text: "Several people, pick who becomes who.", ready: true },
  { id: "object", title: "Object swap", text: "Change hair, clothes, a prop or the background, or remove something.", ready: true },
  { id: "post", title: "Post-processing", text: "Fix the faces or the colours of a finished video.", ready: true },
] as const;

const POSTS: { id: Post; label: string }[] = [{ id: "face", label: "Fix faces" }, { id: "color", label: "Fix colours" }];

const FACE_STYLE_TEXT: Record<FaceStyle, { label: string; hint: string }> = {
  photo: { label: "Match the photo", hint: "The face is redrawn from the photo: the closest likeness, but H3 makes up its own expressions and mouth movements." },
  mouth: { label: "Follow the mouth", hint: "The face follows the video's expressions and mouth movements; a little less like the photo." },
};

// "From picture" is the Simple person swap with the picture as the character.
type EditTab = EditMode | "picture";
const EDITS: { id: EditTab; label: string; target: string; what: string; to: string; toHint: string }[] = [
  { id: "change", label: "Change", target: "hair, top", what: "What to change", to: "short bright pink hair and a black leather jacket", toHint: "What it becomes" },
  { id: "remove", label: "Remove", target: "poster", what: "What to remove", to: "a plain wall", toHint: "What shows instead (optional)" },
  { id: "background", label: "Background", target: "person", what: "What stays", to: "a snowy mountain pass at dusk", toHint: "The new place" },
  { id: "picture", label: "From picture", target: "person", what: "Who is replaced", to: "", toHint: "" },
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

const PLACES = ["Whole", "Start", "Middle", "End"] as const;

// Where a part of the given length sits for each place button.
function placeStart(place: (typeof PLACES)[number], duration: number, length: number) {
  return place === "Middle" ? (duration - length) / 2 : place === "End" ? duration - length : 0;
}

function timecode(seconds: number) {
  return `${Math.floor(seconds / 60)}:${(seconds % 60).toFixed(1).padStart(4, "0")}`;
}

function elapsed(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

// Rough share of a clip done at each node: the sampler is most of the time.
function clipShare(progress: Progress) {
  const steps = progress.steps ? (progress.step ?? 0) / progress.steps : 0;
  // one pass per person samples twice per clip
  if (progress.classType === "SamplerCustomAdvanced" && progress.title.startsWith("Pass 1:")) return 0.1 + 0.4 * steps;
  if (progress.classType === "SamplerCustomAdvanced" && progress.title.startsWith("Pass 2:")) return 0.5 + 0.4 * steps;
  if (progress.classType === "SamplerCustomAdvanced") return 0.15 + 0.75 * steps;
  if (["VAEDecode", "VAEDecodeAudio", "MiniMaxH3LoopTrim", "MiniMaxH3ChainSegmentSave", "MiniMaxH3ChainReview"].includes(progress.classType)) return 0.95;
  return 0.05;
}

// Rough share of a colour fix done when each node starts; the tone mapper runs on the CPU and takes longest.
const COLOR_SHARE: Record<string, number> = { ImageDetailContrast: 0.15, Orion4D_FXMax_DCTLToneMapper: 0.3, VHS_VideoCombine: 0.9 };

// A picker over ComfyUI's files, or a text field when the list could not be read.
function FilePicker({ value, options, onChange, label }: { value: string; options: string[]; onChange: (value: string) => void; label: string }) {
  if (!options.length) return <input className="file-name" aria-label={label} value={value} onChange={(event) => onChange(event.target.value)} />;
  return (
    <select className="file-name" aria-label={label} value={value} onChange={(event) => onChange(event.target.value)}>
      {(options.includes(value) ? options : [value, ...options]).map((name) => <option key={name} value={name}>{name}</option>)}
    </select>
  );
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
  const [mode, setMode] = useState<Mode>("simple");
  const [video, setVideo] = useState<{ file: File; url: string; duration: number; width: number; height: number } | null>(null);
  const [part, setPart] = useState<Section>({ start: 0, length: 0 });
  const player = useRef<HTMLVideoElement>(null);
  const [characters, setCharacters] = useState<Character[]>([]);
  const [maxQuality, setMaxQuality] = useState(false);
  const [montage, setMontage] = useState(false);
  const [resolution, setResolution] = useState<Resolution>("736p");
  const [customSize, setCustomSize] = useState<Size>({ width: 1248, height: 736 });
  const [hatFix, setHatFix] = useState(false);
  const [noLipSync, setNoLipSync] = useState(false);
  const [margin, setMargin] = useState<Margin>("normal");
  const [target, setTarget] = useState(DEFAULT_TARGET);
  const [editMode, setEditMode] = useState<EditTab>("change");
  const [editTarget, setEditTarget] = useState(EDITS[0].target);
  const [changeTo, setChangeTo] = useState("");
  const [look, setLook] = useState<{ file: File; url: string } | null>(null);
  const [biggestOnly, setBiggestOnly] = useState(false);
  const [keepOutline, setKeepOutline] = useState(true);
  const [post, setPost] = useState<Post>("face");
  const [detailOn, setDetailOn] = useState(true);
  const [detail, setDetail] = useState(DETAIL.default);
  const [toneOn, setToneOn] = useState(true);
  const [tone, setTone] = useState<ToneSettings>(DEFAULT_TONE);
  // "" once a value is changed by hand
  const [tonePreset, setTonePreset] = useState(DEFAULT_PRESET);
  const [presets, setPresets] = useState<TonePreset[]>([]);
  const [faceStyle, setFaceStyle] = useState<FaceStyle>("photo");
  const [chunkSeconds, setChunkSeconds] = useState(CHUNK_SECONDS.default);
  const [seed, setSeed] = useState(0);
  const [clipSeconds, setClipSeconds] = useState(CLIP_SECONDS.default);
  const [motion, setMotion] = useState<MotionSize>(MOTION_SIZES[0]);
  const [steps, setSteps] = useState(DEFAULT_MODEL.steps);
  const [model, setModel] = useState(DEFAULT_MODEL.model);
  const [loras, setLoras] = useState<Lora[]>(DEFAULT_MODEL.loras);
  const [files, setFiles] = useState<{ models: string[]; loras: string[] }>({ models: [], loras: [] });
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
    fetch("/api/models").then((response) => response.json()).then(setFiles, () => {});
    // Orion's own copy of the default preset wins over the built-in values once it has loaded.
    fetch("/api/presets").then((response) => response.json()).then(({ tone }: { tone: TonePreset[] }) => {
      setPresets(tone);
      const saved = tone.find((p) => p.name === DEFAULT_PRESET);
      if (saved) setTone(toneFromPreset(saved.settings));
    }, () => {});
  }, []);

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
        setProgress((last) => {
          const again = event.node.classType === "SamplerCustomAdvanced" && (last?.classType !== "SamplerCustomAdvanced" || (event.step ?? 0) < (last.step ?? 0));
          return { ...event.node, step: event.step, steps: event.steps, pass: (last?.pass ?? 0) + (again ? 1 : 0) };
        });
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
    setVideo({ file, url, duration: 0, width: 0, height: 0 });
    setPart({ start: 0, length: 0 });
    const probe = document.createElement("video");
    probe.preload = "metadata";
    probe.onloadedmetadata = () => {
      setVideo((current) => (current?.url === url ? { ...current, duration: probe.duration, width: probe.videoWidth, height: probe.videoHeight } : current));
      setPart({ start: 0, length: probe.duration });
    };
    probe.src = url;
  }

  function choosePart(start: number, length: number) {
    const duration = video?.duration ?? 0;
    const next = { start: Math.min(Math.max(0, start), duration - length), length };
    setPart(next);
    if (player.current) player.current.currentTime = next.start;
  }

  const whole = !video?.duration || (part.start === 0 && part.length >= video.duration);
  const place = whole ? "Whole" : PLACES.slice(1).find((p) => Math.abs(placeStart(p, video!.duration, part.length) - part.start) < 0.05);

  const faceFix = mode === "post" && post === "face";
  const colorFix = mode === "post" && post === "color";
  // Orion's saved presets, with the default preset first when Orion does not have it.
  const presetOptions: TonePreset[] = presets.some((p) => p.name === DEFAULT_PRESET) ? presets : [{ name: DEFAULT_PRESET, settings: DEFAULT_TONE }, ...presets];

  function choosePreset(name: string) {
    const preset = presetOptions.find((p) => p.name === name);
    if (!preset) return;
    setTone(toneFromPreset(preset.settings));
    setTonePreset(name);
  }

  // Simple mode and Fix faces use only the first character; the others are kept for switching back.
  const single = mode === "simple" || mode === "post";
  const limit = single ? 1 : MAX_CHARACTERS;
  const shown = characters.slice(0, limit);
  const character = characters[0] ?? null;
  const onePassEach = mode === "advanced" && maxQuality && shown.length === 2;

  function addCharacters(files: File[]) {
    if (!files.length) return;
    if (single && character) {
      URL.revokeObjectURL(character.url);
      setCharacters([{ file: files[0], url: URL.createObjectURL(files[0]), role: character.role }, ...characters.slice(1)]);
      return;
    }
    const added = files.slice(0, limit - characters.length).map((file) => ({ file, url: URL.createObjectURL(file), role: "" }));
    setCharacters([...characters, ...added]);
  }

  function removeCharacter(index: number) {
    URL.revokeObjectURL(characters[index].url);
    setCharacters(characters.filter((_, i) => i !== index));
  }

  function setRole(index: number, role: string) {
    setCharacters(characters.map((c, i) => (i === index ? { ...c, role } : c)));
  }

  const canvas = typeof resolution === "object" ? [resolution.width, resolution.height] : video?.width ? canvasSize(video.width, video.height, resolution) : null;
  const resolutionField = typeof resolution === "object" ? `${resolution.width}x${resolution.height}` : resolution;

  function chooseSize(side: keyof Size, value: number) {
    const snapped = Math.min(CUSTOM_SIZE.max, Math.max(CUSTOM_SIZE.min, Math.round(value / CUSTOM_SIZE.step) * CUSTOM_SIZE.step || customSize[side]));
    const size = { ...customSize, [side]: snapped };
    setCustomSize(size);
    setResolution(size);
    return snapped;
  }

  const clips = !video?.duration ? 0 : faceFix ? faceChunkCount(part.length || video.duration, chunkSeconds) : clipCount(part.length || video.duration, clipSeconds);
  const edit = EDITS.find((e) => e.id === editMode)!;
  const fromPicture = mode === "object" && editMode === "picture";
  const ready = colorFix ? detailOn || toneOn : mode === "object"
    ? editMode === "remove" || (fromPicture ? !!look : !!changeTo.trim() || !!look)
    : !!character;

  function chooseLook(files: File[]) {
    if (!files[0]) return;
    if (look) URL.revokeObjectURL(look.url);
    setLook({ file: files[0], url: URL.createObjectURL(files[0]) });
  }

  async function submit(kind: Kind) {
    if (!video || (kind !== "mask" && !ready)) return;
    setSubmitting(true);
    setFormError("");
    const form = new FormData();
    form.set("mode", kind);
    form.set("video", video.file);
    if (!whole) {
      form.set("start", part.start.toFixed(2));
      form.set("length", part.length.toFixed(2));
    }
    form.set("hat_fix", String(hatFix));
    form.set("no_lip_sync", String(noLipSync));
    form.set("margin", margin);
    form.set("target", fromPicture ? editTarget.trim() || edit.target : target);
    if (kind === "simple" && fromPicture && look) {
      form.set("picture", look.file);
      form.set("role", "");
    } else if (kind === "simple" && character) {
      form.set("picture", character.file);
      form.set("role", character.role);
    }
    if (kind === "simple") {
      form.set("resolution", resolutionField);
      form.set("seed", String(seed));
      form.set("clip_seconds", String(clipSeconds));
    }
    if (kind === "advanced" || kind === "advanced_maxq") {
      form.set("mode", "advanced");
      for (const c of shown) {
        form.append("picture", c.file);
        form.append("role", c.role);
      }
      form.set("max_quality", String(kind === "advanced_maxq"));
      form.set("montage", String(montage));
      form.set("resolution", resolutionField);
      form.set("seed", String(seed));
      form.set("clip_seconds", String(clipSeconds));
    }
    if (kind === "face" && character) {
      form.set("picture", character.file);
      form.set("style", faceStyle);
      form.set("seed", String(seed));
      form.set("clip_seconds", String(chunkSeconds));
    }
    if (kind === "color") {
      if (detailOn) form.set("detail", String(detail));
      if (toneOn) {
        form.set("tone_mode", tone.mode);
        for (const key of Object.keys(TONE_RANGES) as ToneValue[]) form.set(`tone_${key}`, String(tone[key]));
      }
    }
    if (kind === "object") {
      form.set("edit_mode", editMode);
      form.set("target", editTarget.trim() || edit.target);
      form.set("change_to", changeTo);
      if (look && editMode !== "remove") form.set("picture", look.file);
      form.set("biggest_only", String(biggestOnly));
      form.set("keep_outline", String(keepOutline));
      form.set("resolution", resolutionField);
      form.set("seed", String(seed));
      form.set("clip_seconds", String(clipSeconds));
    }
    if (kind !== "mask" && kind !== "color") {
      form.set("motion", String(motion));
      form.set("steps", String(steps));
      form.set("model", model);
      for (const l of loras) {
        form.append("lora", l.name);
        form.append("lora_strength", String(l.strength));
      }
    }
    try {
      const response = await fetch("/api/jobs", { method: "POST", body: form });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Could not start the job.");
      const next: Run = { id: body.id, kind, margin, clips: Math.max(clips, 1), clipSeconds: kind === "face" ? chunkSeconds : clipSeconds, startedAt: Date.now() };
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
            <p>Swap the people or things in any video. Open weights, on your own GPU.</p>
          </div>
        </div>
      </header>

      <nav className="modes" aria-label="Mode">
        {MODES.map((m) => (
          <button
            key={m.id} className={`mode ${m.id === mode ? "active" : ""}`} disabled={!m.ready || !!run} aria-pressed={m.id === mode}
            onClick={() => setMode(m.id)}
          >
            <strong>{m.title}</strong>
            <span>{m.text}</span>
            {!m.ready && <em>Coming soon</em>}
          </button>
        ))}
      </nav>

      {run ? (
        <RunView
          run={run} job={job} progress={progress} preview={preview} streamError={streamError} now={now}
          onCancel={cancel} onReset={reset} onGenerate={video && character && !submitting && mode === "simple" ? () => submit("simple") : null}
          margin={margin} onMargin={setMargin} onRecheck={video && !submitting ? () => submit("mask") : null}
        />
      ) : (
        <>
          <section className="inputs">
            <div className="panel">
              <h2><span>1</span> Source video</h2>
              {video ? (
                <div className="video-pick">
                  <video
                    ref={player} src={video.url} controls muted playsInline
                    onTimeUpdate={(event) => { if (!whole && event.currentTarget.currentTime >= part.start + part.length) event.currentTarget.currentTime = part.start; }}
                  />
                  <div className="row">
                    <small>{video.file.name}{video.duration ? ` · ${video.duration.toFixed(1)} s` : ""}</small>
                    <DropZone accept="video/*,.mkv" onFiles={chooseVideo} className="link">Replace</DropZone>
                  </div>
                  {video.duration > MIN_SECTION_SECONDS && (
                    <>
                      <div className="setting">
                        <span>Part to use <small>{timecode(part.start)}–{timecode(part.start + part.length)} ({part.length.toFixed(1)} s). Only this part is swapped.</small></span>
                        <div className="segmented">
                          {PLACES.map((p) => (
                            <button key={p} className={p === place ? "on" : ""} onClick={() => p === "Whole" ? choosePart(0, video.duration) : choosePart(placeStart(p, video.duration, part.length), part.length)}>{p}</button>
                          ))}
                        </div>
                      </div>
                      <label className="setting">
                        <span>Length <small>{part.length.toFixed(1)} s</small></span>
                        <input type="range" min={MIN_SECTION_SECONDS} max={video.duration} step={0.5} value={part.length} onChange={(event) => choosePart(part.start, Number(event.target.value))} />
                      </label>
                      <label className="setting">
                        <span>Starts at <small>{timecode(part.start)}</small></span>
                        <input type="range" min={0} max={video.duration - part.length} step={0.1} value={part.start} disabled={whole} onChange={(event) => choosePart(Number(event.target.value), part.length)} />
                      </label>
                    </>
                  )}
                </div>
              ) : (
                <DropZone accept="video/*,.mkv" onFiles={chooseVideo} className="big">
                  <strong>Drop a video</strong>
                  <span>or click to browse. Its camera, cuts, motion and soundtrack are kept.</span>
                </DropZone>
              )}
            </div>

            <div className="panel">
              <h2><span>2</span> {mode === "object" ? "What to change" : colorFix ? "Colour fix" : faceFix ? "Whose face" : mode === "simple" ? "Character" : "Characters"}</h2>
              {mode === "post" && (
                <div className="segmented">
                  {POSTS.map((p) => (
                    <button key={p.id} className={p.id === post ? "on" : ""} onClick={() => setPost(p.id)}>{p.label}</button>
                  ))}
                </div>
              )}
              {mode === "advanced" && (<>
                <div className="segmented">
                  <button className={montage ? "" : "on"} onClick={() => setMontage(false)}>Standard</button>
                  <button className={montage ? "on" : ""} onClick={() => setMontage(true)}>Montage</button>
                </div>
                {montage && (
                  <p className="hint">
                    For edited clips where different people take turns within one shot, with no hard cut between them: whip pans,
                    selfie handovers, travel and &ldquo;vibe&rdquo; montages. H3 is told when each person is on screen, so nobody turns
                    into someone else. Use Standard for everything else.
                  </p>
                )}
              </>)}
              {colorFix ? (<>
                <label className="setting toggle">
                  <span>Detail contrast <small>Softens H3&apos;s crunchy fine detail and over-sharpened skin, without blurring edges.</small></span>
                  <input type="checkbox" checked={detailOn} onChange={(event) => setDetailOn(event.target.checked)} />
                  <i aria-hidden />
                </label>
                {detailOn && <label className="setting">
                  <span>Amount <small>{detail.toFixed(2)}: below 0 softens, above 0 sharpens.</small></span>
                  <input type="range" min={DETAIL.min} max={DETAIL.max} step={0.01} value={detail} onChange={(event) => setDetail(Number(event.target.value))} />
                </label>}
                <label className="setting toggle">
                  <span>Tone mapper <small>Orion4D DCTL Tone Mapper, a colour grade over every frame. {DEFAULT_PRESET} softens contrast and highlights and keeps the blacks deep.</small></span>
                  <input type="checkbox" checked={toneOn} onChange={(event) => setToneOn(event.target.checked)} />
                  <i aria-hidden />
                </label>
                {toneOn && <div className="setting">
                  <span>Preset <small>Orion&apos;s saved presets. Change the values under Settings to make your own.</small></span>
                  <select className="file-name" aria-label="Tone mapper preset" value={tonePreset} onChange={(event) => choosePreset(event.target.value)}>
                    {!tonePreset && <option value="">Custom</option>}
                    {presetOptions.map((p) => <option key={p.name} value={p.name}>{p.name}</option>)}
                  </select>
                </div>}
                <p className="hint">No H3 run: the video is only filtered, so it keeps its frames and soundtrack. The detail contrast runs first, then the tone mapper.</p>
              </>) : mode === "object" ? (
                <div className="edit">
                  <div className="segmented">
                    {EDITS.map((e) => (
                      <button key={e.id} className={e.id === editMode ? "on" : ""} onClick={() => {
                        // Each tab's fields mean something else: "top, pants" left over from Change made From picture swap only the top.
                        // The default goes in as a value, not a placeholder, so an untouched box shows what SAM tracks.
                        if (e.id !== editMode) { setEditTarget(e.target); setChangeTo(""); }
                        setEditMode(e.id);
                      }}>{e.label}</button>
                    ))}
                  </div>
                  <label>
                    <span>{edit.what} <small>What SAM tracks, in English.{(editMode === "change" || editMode === "remove") && " Separate several with commas."}</small></span>
                    <input value={editTarget} maxLength={100} placeholder={edit.target} onChange={(event) => setEditTarget(event.target.value)} />
                  </label>
                  {!fromPicture && <label>
                    <span>{edit.toHint}</span>
                    <input value={changeTo} maxLength={300} placeholder={`e.g. ${edit.to}`} onChange={(event) => setChangeTo(event.target.value)} />
                  </label>}
                  {editMode !== "remove" && (look ? (
                    <div className="character look">
                      <img src={look.url} alt="Reference picture" />
                      <button className="remove" onClick={() => { URL.revokeObjectURL(look.url); setLook(null); }} aria-label="Remove picture">×</button>
                    </div>
                  ) : (
                    <DropZone accept="image/*" onFiles={chooseLook} className="add">
                      <strong>+</strong>
                      <span>{fromPicture ? "The picture to copy" : editMode === "background" ? "Picture of the place (optional)" : "Picture of the new look (optional)"}</span>
                    </DropZone>
                  ))}
                  <p className="hint">
                    {editMode === "change" && "Only what SAM tracks is regenerated: hair, a top, a car. A picture of an outfit, hairstyle or product is copied onto it."}
                    {editMode === "remove" && "What SAM tracks is erased and filled with what is around it. The camera, people and sound stay."}
                    {editMode === "background" && "Everything except what SAM tracks becomes the new place; the camera movement stays."}
                    {fromPicture && "The person in the video becomes the person in the picture: face, hair and outfit. The background, motion, camera and sound stay."}
                  </p>
                </div>
              ) : (<>
              <div className="characters">
                {shown.map((c, i) => (
                  <div className="character" key={c.url}>
                    <img src={c.url} alt={`Character ${i + 1}`} />
                    <button className="remove" onClick={() => removeCharacter(i)} aria-label={`Remove character ${i + 1}`}>×</button>
                    {mode !== "post" && <label>
                      <span>Who do they replace? (optional)</span>
                      <input
                        value={c.role}
                        maxLength={200}
                        placeholder={i === 0 ? "e.g. the singer - red dress" : "e.g. the drummer - black cap"}
                        onChange={(event) => setRole(i, event.target.value)}
                      />
                    </label>}
                  </div>
                ))}
                {shown.length < limit && (
                  <DropZone accept="image/*" onFiles={addCharacters} multiple={mode === "advanced"} className="add">
                    <strong>+</strong>
                    <span>Drop a photo</span>
                  </DropZone>
                )}
              </div>
              {faceFix ? (<>
                <div className="segmented">
                  {(Object.keys(FACE_STYLE_TEXT) as FaceStyle[]).map((f) => (
                    <button key={f} className={f === faceStyle ? "on" : ""} onClick={() => setFaceStyle(f)}>{FACE_STYLE_TEXT[f].label}</button>
                  ))}
                </div>
                <p className="hint">
                  {FACE_STYLE_TEXT[faceStyle].hint} Use the photo the video was made with. Only that person&apos;s face changes; faces
                  taller than a fifth of the frame are already sharp and are left alone.
                </p>
              </>) : mode === "simple" ? (
                <p className="hint">
                  The character replaces the main person in the video, the one who fills the most of the frame. Everyone else stays.
                  Mirrors and reflections do not work yet.
                  To name them for the prompt, use a role (&ldquo;the singer&rdquo;), not clothes; their look can go after &ldquo; - &rdquo; (&ldquo;the singer - red dress&rdquo;).
                </p>
              ) : (
                <p className="hint">
                  Up to {MAX_CHARACTERS} characters. In every clip each tracked person is matched to a role; people without a
                  character (extras, passers-by) stay as they are. Mirrors and reflections do not work yet. Name roles (&ldquo;the drummer&rdquo;), not clothes, and add how they look
                  after &ldquo; - &rdquo; to help the matching (&ldquo;the drummer - man in a cap&rdquo;). Blank roles go to the people with the
                  most screen time.
                </p>
              )}
              </>)}
            </div>
          </section>

          {colorFix ? toneOn && (
            <section className="panel settings">
              <h2><span>3</span> Settings <small>{tonePreset || "Custom"}</small></h2>
              <div className="setting">
                <span>Tone mapper mode</span>
                <div className="segmented">
                  {TONE_MODES.map((m) => (
                    <button key={m} className={m === tone.mode ? "on" : ""} onClick={() => { setTone({ ...tone, mode: m }); setTonePreset(""); }}>{m}</button>
                  ))}
                </div>
              </div>
              {(Object.keys(TONE_RANGES) as ToneValue[]).map((key) => (
                <label className="setting" key={key}>
                  <span>{TONE_RANGES[key].label} <small>{tone[key].toFixed(2)}</small></span>
                  <input
                    type="range" min={TONE_RANGES[key].min} max={TONE_RANGES[key].max} step={TONE_RANGES[key].step} value={tone[key]}
                    onChange={(event) => { setTone({ ...tone, [key]: Number(event.target.value) }); setTonePreset(""); }}
                  />
                </label>
              ))}
              <p className="hint">Strength mixes the grade with the original: 0.2 is 20% of it. Pick the preset again to undo your changes.</p>
            </section>
          ) : (
          <section className="panel settings">
            <h2><span>3</span> Settings</h2>
            {mode !== "post" && <div className="setting">
              <span>Resolution <small>{typeof resolution === "object" ? "Width × height. The video is scaled and centre-cropped to this shape." : `${canvas ? `${canvas[0]} × ${canvas[1]} for this video` : "Short edge of the video"}. The shape follows the source.`}</small></span>
              <div className="segmented">
                {RESOLUTIONS.map((r) => (
                  <button key={r} className={r === resolution ? "on" : ""} onClick={() => setResolution(r)}>{r}</button>
                ))}
                <button className={typeof resolution === "object" ? "on" : ""} onClick={() => setResolution(customSize)}>Custom</button>
              </div>
              {typeof resolution === "object" && (
                <div className="custom-size">
                  {(["width", "height"] as const).map((side) => (
                    <label key={side}>
                      {side === "height" && "×"}
                      <input
                        className="steps-input" type="number" aria-label={`Custom ${side} in pixels`} min={CUSTOM_SIZE.min} max={CUSTOM_SIZE.max} step={CUSTOM_SIZE.step}
                        defaultValue={resolution[side]} onBlur={(event) => { event.target.value = String(chooseSize(side, Number(event.target.value))); }}
                        onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }}
                      />
                    </label>
                  ))}
                </div>
              )}
            </div>}
            {mode === "object" && editMode !== "background" && !fromPicture && (
              <label className="setting toggle">
                <span>Only the biggest one <small>Off: every match SAM finds changes (everyone&apos;s hair). On: only the one that fills the most of the frame.</small></span>
                <input type="checkbox" checked={biggestOnly} onChange={(event) => setBiggestOnly(event.target.checked)} />
                <i aria-hidden />
              </label>
            )}
            {mode === "object" && editMode === "change" && (
              <label className="setting toggle">
                <span>Keep original outline <small>On: the face, hands and arms around it stay exact, but the new look keeps the old shape (sleeves, length). Off: the shape can change (long hair to a bob, pants to a skirt), but edges near the face and hands may be lost.</small></span>
                <input type="checkbox" checked={keepOutline} onChange={(event) => setKeepOutline(event.target.checked)} />
                <i aria-hidden />
              </label>
            )}
            {mode === "simple" && (
              <div className="setting">
                <span>What to replace <small>What SAM tracks, in English: person, cat, dog, or a short description such as “black and white cat”. The biggest match is replaced.</small></span>
                <input className="target-input" aria-label="What to replace" placeholder={DEFAULT_TARGET} value={target} onChange={(event) => setTarget(event.target.value)} />
              </div>
            )}
            {(mode === "simple" || mode === "advanced") && <label className="setting toggle">
              <span>Hat fix <small>Also replaces hats{mode === "advanced" ? " worn by the people being replaced" : ""} (about 45 s more per clip).</small></span>
              <input type="checkbox" checked={hatFix} onChange={(event) => setHatFix(event.target.checked)} />
              <i aria-hidden />
            </label>}
            {(mode === "simple" || mode === "advanced") && <label className="setting toggle">
              <span>No lip-sync <small>For songs the people in the video do not sing or talk along to, so the new {mode === "advanced" ? "people" : "person"} do{mode === "advanced" ? "" : "es"} not lip-sync them (about 30 s more per clip).</small></span>
              <input type="checkbox" checked={noLipSync} onChange={(event) => setNoLipSync(event.target.checked)} />
              <i aria-hidden />
            </label>}
            {mode === "advanced" && (
              <label className="setting toggle">
                <span>One pass per person <small>Each character gets their own H3 pass with only their photo, so about twice the generation time.{shown.length === 2 ? "" : " Needs exactly two characters."}</small></span>
                <input type="checkbox" checked={onePassEach} disabled={shown.length !== 2} onChange={(event) => setMaxQuality(event.target.checked)} />
                <i aria-hidden />
              </label>
            )}
            {mode !== "post" && <div className="setting">
              <span>Mask margin <small>{mode === "object"
                ? editMode === "background" ? "How far the new place reaches into the edge of what stays." : "Room around it for a bigger new shape and its shadow."
                : <>Room around the person for a differently built character.{mode === "simple" ? " Check mask shows it." : ""}</>}</small></span>
              <MarginPicker value={margin} onChange={setMargin} />
            </div>}
            <details>
              <summary>Advanced</summary>
              <div className="setting">
                <span>Seed <small>Change it for a new take.</small></span>
                <div className="seed">
                  <input type="number" min={0} max={MAX_SEED} value={seed} onChange={(event) => setSeed(Math.min(MAX_SEED, Math.max(0, Math.floor(Number(event.target.value) || 0))))} />
                  <button onClick={() => setSeed(Math.floor(Math.random() * MAX_SEED))} aria-label="Random seed">🎲</button>
                </div>
              </div>
              {faceFix ? (
                <div className="setting">
                  <span>Chunk length <small>{chunkSeconds.toFixed(1)} s of face per H3 generation; chunks overlap by 1 s and are crossfaded.</small></span>
                  <input type="range" min={CHUNK_SECONDS.min} max={CHUNK_SECONDS.max} step={0.5} value={chunkSeconds} onChange={(event) => setChunkSeconds(Number(event.target.value))} />
                </div>
              ) : (
                <div className="setting">
                  <span>Clip length <small>{clipSeconds.toFixed(1)} s per H3 generation</small></span>
                  <input type="range" min={CLIP_SECONDS.min} max={CLIP_SECONDS.max} step={0.5} value={clipSeconds} onChange={(event) => setClipSeconds(Number(event.target.value))} />
                </div>
              )}
              {mode !== "post" && <div className="setting">
                <span>Motion reference <small>Size of the grey figures H3 copies the motion from. Bigger follows the source poses a bit more closely; sampling takes about a third longer at 768 px and about 2.4× as long at 1376 px.</small></span>
                <div className="segmented">
                  {MOTION_SIZES.map((m) => (
                    <button key={m} className={m === motion ? "on" : ""} onClick={() => setMotion(m)}>{m} px</button>
                  ))}
                </div>
              </div>}
              <div className="setting">
                <span>Steps <small>6 with the DMAD speed LoRA; without a speed LoRA, 20 or more.</small></span>
                <input
                  className="steps-input" type="number" min={STEPS.min} max={STEPS.max} value={steps}
                  onChange={(event) => setSteps(Math.min(STEPS.max, Math.max(STEPS.min, Math.floor(Number(event.target.value) || STEPS.min))))}
                />
              </div>
              <div className="setting">
                <span>Base model <small>The H3 diffusion model in ComfyUI&apos;s models/diffusion_models.</small></span>
                <FilePicker label="Base model" value={model} options={files.models} onChange={setModel} />
              </div>
              <div className="setting loras">
                <span>LoRAs <small>Applied in order to the base model. Remove the DMAD LoRA only together with more steps.</small></span>
                <div className="lora-list">
                  {loras.map((l, i) => (
                    <div className="lora" key={i}>
                      <FilePicker label={`LoRA ${i + 1}`} value={l.name} options={files.loras} onChange={(name) => setLoras(loras.map((x, j) => (j === i ? { ...x, name } : x)))} />
                      <input
                        type="number" aria-label={`LoRA ${i + 1} strength`} min={STRENGTH.min} max={STRENGTH.max} step={0.05} value={l.strength}
                        onChange={(event) => setLoras(loras.map((x, j) => (j === i ? { ...x, strength: Math.min(STRENGTH.max, Math.max(STRENGTH.min, Number(event.target.value) || 0)) } : x)))}
                      />
                      <button className="secondary" onClick={() => setLoras(loras.filter((_, j) => j !== i))} aria-label={`Remove LoRA ${i + 1}`}>×</button>
                    </div>
                  ))}
                  {loras.length < MAX_LORAS && (
                    <button className="secondary" onClick={() => setLoras([...loras, { name: files.loras[0] ?? "", strength: 1 }])}>Add LoRA</button>
                  )}
                </div>
              </div>
            </details>
          </section>
          )}

          <div className="go">
            {formError && <p className="error">{formError}</p>}
            <div className="row">
              {mode === "simple" && <button className="secondary" disabled={!video || submitting} onClick={() => submit("mask")}>Check mask</button>}
              <button className="primary" disabled={!video || !ready || submitting} onClick={() => submit(mode === "object" ? fromPicture ? "simple" : "object" : mode === "post" ? post : mode === "simple" ? "simple" : onePassEach ? "advanced_maxq" : "advanced")}>
                {submitting ? "Uploading…" : "Generate"}
              </button>
            </div>
            <small>{colorFix
              ? !video ? "Add a video." : ready ? `${(part.length || video.duration).toFixed(1)} s of video` : "Turn on detail contrast, the tone mapper or both."
              : clips && ready
              ? faceFix ? `Up to ${clips} chunk${clips > 1 ? "s" : ""} of face` : `${clips} clip${clips > 1 ? "s" : ""} at ${canvas ? `${canvas[0]}×${canvas[1]}` : resolution}`
              : `Add a video and ${mode === "object" ? "say what it becomes" : faceFix ? "the photo of the person" : mode === "simple" ? "a character photo" : "character photos"}.`}</small>
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
          <button className="secondary" onClick={onReset}>{run.kind === "object" ? "New edit" : run.kind === "face" || run.kind === "color" ? "Fix another" : "New swap"}</button>
        </div>
      </section>
    );
  }

  if (TERMINAL.has(status)) {
    return (
      <section className="panel">
        <h2>{status === "canceled" ? "Canceled" : status === "succeeded" ? "Finished without a video" : status === "expired" ? "Job no longer available" : "Something went wrong"}</h2>
        {job?.error && <p className="error">{job.error}</p>}
        {status === "expired" && <p className="hint">ComfyUI no longer knows this job, for example after a restart. Finished videos are in ComfyUI&apos;s output/{run.kind === "object" ? "h3_oneclick_edit" : run.kind === "face" ? "openjutsu_face" : run.kind === "color" ? "openjutsu_color" : "h3_oneclick_swap"} folder.</p>}
        <button className="secondary" onClick={onReset}>Back</button>
      </section>
    );
  }

  const face = run.kind === "face";
  const color = run.kind === "color";
  const sampling = progress?.classType === "SamplerCustomAdvanced";
  const chunk = Math.min(progress?.pass ?? 0, run.clips);
  let fraction = 0;
  if (color) fraction = COLOR_SHARE[progress?.classType ?? ""] ?? 0.05;
  else if (face) fraction = sampling ? 0.1 + 0.85 * (chunk - 1 + (progress!.steps ? (progress!.step ?? 0) / progress!.steps : 0)) / run.clips : chunk ? 0.97 : 0.05;
  else if (mask) fraction = progress?.classType === "SAM3_VideoTrack" && progress.steps ? (progress.step ?? 0) / progress.steps : 0;
  else if (progress?.classType === "MiniMaxH3ChainAssemble") fraction = 0.99;
  else if (progress?.clip) fraction = (progress.clip - 1 + clipShare(progress)) / clips;

  return (
    <section className="panel progress">
      <div className="row">
        <h2>{status === "queued" ? `Queued${job?.queuePosition ? ` (#${job.queuePosition})` : ""}` : mask ? "Checking the mask" : color ? "Fixing the colours"
          : face ? (sampling ? `Chunk ${chunk} of up to ${run.clips}` : chunk ? "Pasting the face back" : "Tracking the face")
          : progress?.clip ? `Clip ${progress.clip} of ${clips}` : "Preparing"}</h2>
        <span className="time">{elapsed(now - run.startedAt)}</span>
      </div>
      <div className="bar"><div style={{ width: `${Math.round(fraction * 100)}%` }} /></div>
      <p className="node">
        {progress ? progress.title : status === "queued" ? "Waiting for ComfyUI…" : "Working…"}
        {progress?.steps ? ` · step ${progress.step ?? 0}/${progress.steps}` : ""}
      </p>
      {preview && <img className="preview" src={preview} alt="Mask preview: white areas are regenerated" />}
      {streamError && <p className="error">{streamError}</p>}
      <p className="hint">{mask ? "SAM tracks the whole video once, about a minute per 3 s of video." : color ? "Every frame goes through the filters, then the video is saved with its soundtrack." : face ? "The face is tracked over the whole video, then each chunk is regenerated; nothing is saved until the end." : "Each clip is saved as it finishes, so a rerun with the same inputs resumes where it stopped."} You can close this page and come back.</p>
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
