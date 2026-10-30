"use client";

import { useEffect, useRef, useState, type CSSProperties, type DragEvent, type PointerEvent, type ReactNode } from "react";
import type { PublicJob } from "../lib/comfy.ts";
import type { SetupRequest, SetupResult } from "../lib/setup.ts";
import type { NodeInfo } from "../lib/progress.ts";
import { clipCount, clipStarts } from "../lib/clips.ts";
import { CLIP_SECONDS, DEFAULT_TARGET, MARGINS, MAX_SEED, MIN_SECTION_SECONDS, MOTION_SIZES, PLACES, placeStart, RESOLUTIONS, CUSTOM_SIZE, canvasSize, timecode, type Margin, type MotionSize, type Resolution, type Section, type Size } from "../lib/simple.ts";
import { MAX_CHARACTERS } from "../lib/advanced.ts";
import { ACCELERATIONS, DEFAULT_DESCRIBER, DEFAULT_MODEL, hasSpeedLora, isSpeedLora, MAX_LORAS, STEPS, STRENGTH, type Acceleration, type Lora, type ModelFiles } from "../lib/model.ts";
import type { EditMode, FitSummary, PaintKeyframe, PlacementKeyframe } from "../lib/object.ts";
import { Welcome } from "./welcome.tsx";
import { ObjectPlacement } from "./object-placement.tsx";
import { FromPicture } from "./from-picture.tsx";
import { CHUNK_SECONDS, FACE_STYLES, faceChunkCount, type FaceStyle } from "../lib/face.ts";
import { DEFAULT_PRESET, DEFAULT_TONE, DETAIL, TONE_MODES, TONE_RANGES, toneFromPreset, type ToneSettings, type ToneValue } from "../lib/color.ts";
import { appearances, renderLabels, type Appearance, type Kept, type Label, type People, type Review } from "../lib/montage.ts";

type Character = { file: File; url: string; role: string };
type Mode = "simple" | "advanced" | "object" | "post";
type Post = "face" | "color";
type Kind = "simple" | "mask" | "advanced" | "advanced_maxq" | "object" | "fit" | "face" | "color" | "people" | "montage";
type TonePreset = { name: string; settings: Record<string, unknown> };
// frames: the video, part and crop SAM saw
type Run = { id: string; kind: Kind; margin: Margin; clips: number; clipSeconds: number; startedAt: number; frames: string };
type PastRun = Run & { status?: string; result?: string };
// pass counts the sampler runs started so far: Fix faces samples its chunks one after another in the same node.
type Progress = NodeInfo & { step: number | null; steps: number | null; pass: number };

const TERMINAL = new Set(["succeeded", "failed", "canceled", "expired"]);
const RUN_KEY = "openjutsu.run";
const SETTINGS_KEY = "openjutsu.settings";
const WELCOME_KEY = "openjutsu.welcome";
const HISTORY_KEY = "openjutsu.history";
const HISTORY_LENGTH = 20;

const KIND_LABELS: Record<Kind, string> = {
  simple: "Person swap", mask: "Mask check", advanced: "Advanced swap", advanced_maxq: "Advanced swap", object: "Object swap", fit: "Fit check",
  face: "Fix faces", color: "Fix colours", people: "Find people", montage: "Montage",
};
const STATUS_LABELS: Record<string, string> = { succeeded: "Done", failed: "Failed", canceled: "Canceled", expired: "Expired" };

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

type EditTab = EditMode | "picture";
const EDITS: { id: EditTab; label: string; target: string; what: string; to: string; toHint: string }[] = [
  { id: "change", label: "Change", target: "hair, top", what: "What to change", to: "short bright pink hair and a black leather jacket", toHint: "What it becomes" },
  { id: "add", label: "Add", target: "on the table", what: "Where it goes", to: "a chocolate cake on a plate", toHint: "Object to add" },
  { id: "remove", label: "Remove", target: "poster", what: "What to remove", to: "a plain wall", toHint: "What shows instead (optional)" },
  { id: "background", label: "Background", target: "person", what: "What stays", to: "a snowy mountain pass at dusk", toHint: "The new place" },
  { id: "picture", label: "From picture", target: "person", what: "Who is replaced", to: "", toHint: "" },
];

const isRun = (run: Run | null) => typeof run?.id === "string" && Object.hasOwn(KIND_LABELS, run.kind);

function readRun(): Run | null {
  try {
    const run = JSON.parse(localStorage.getItem(RUN_KEY) ?? "null");
    return isRun(run) ? run : null;
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

function readHistory(): PastRun[] {
  try {
    const list = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? "[]");
    return Array.isArray(list) ? list.filter(isRun) : [];
  } catch {
    return [];
  }
}

type Settings = {
  mode: Mode; maxQuality: boolean; montage: boolean; resolution: Resolution; customSize: Size; hatFix: boolean; noLipSync: boolean;
  margin: Margin; target: string; editMode: EditTab; editTarget: string; biggestOnly: boolean; keepOutline: boolean; post: Post;
  detailOn: boolean; detail: number; toneOn: boolean; tone: ToneSettings; tonePreset: string; faceStyle: FaceStyle;
  chunkSeconds: number; seed: number; clipSeconds: number; motion: MotionSize; steps: number; model: string; loras: Lora[];
  useLoras: boolean; describer: string; textEncoder: string; videoVae: string; audioVae: string; acceleration: Acceleration;
};

const isBoolean = (value: unknown) => typeof value === "boolean";
const isString = (value: unknown) => typeof value === "string";
const oneOf = (list: readonly unknown[]) => (value: unknown) => list.includes(value);
const inRange = ({ min, max }: { min: number; max: number }) => (value: unknown) => typeof value === "number" && value >= min && value <= max;
const isSize = (value: unknown) => !!value && typeof value === "object" && [(value as Size).width, (value as Size).height].every(inRange(CUSTOM_SIZE));

// A saved value that fails its check, say from an older version, is dropped and the field keeps its default.
const SETTING_CHECKS: Record<keyof Settings, (value: unknown) => boolean> = {
  mode: oneOf(MODES.map((m) => m.id)), maxQuality: isBoolean, montage: isBoolean,
  resolution: (value) => oneOf(RESOLUTIONS)(value) || isSize(value), customSize: isSize,
  hatFix: isBoolean, noLipSync: isBoolean, margin: oneOf(Object.keys(MARGINS)), target: isString,
  editMode: oneOf(EDITS.map((e) => e.id)), editTarget: isString, biggestOnly: isBoolean, keepOutline: isBoolean,
  post: oneOf(POSTS.map((p) => p.id)), detailOn: isBoolean, detail: inRange(DETAIL), toneOn: isBoolean,
  tone: (value) => !!value && typeof value === "object" && oneOf(TONE_MODES)((value as ToneSettings).mode)
    && Object.entries(TONE_RANGES).every(([key, range]) => inRange(range)((value as ToneSettings)[key as ToneValue])),
  tonePreset: isString, faceStyle: oneOf(FACE_STYLES), chunkSeconds: inRange(CHUNK_SECONDS),
  seed: (value) => Number.isInteger(value) && inRange({ min: 0, max: MAX_SEED })(value), clipSeconds: inRange(CLIP_SECONDS),
  motion: oneOf(MOTION_SIZES), steps: (value) => Number.isInteger(value) && inRange(STEPS)(value), model: isString,
  loras: (value) => Array.isArray(value) && value.length <= MAX_LORAS && value.every((l) => !!l && isString(l.name) && inRange(STRENGTH)(l.strength) && (l.speed === undefined || isBoolean(l.speed)) && (l.enabled === undefined || isBoolean(l.enabled))),
  useLoras: isBoolean, describer: isString, textEncoder: isString, videoVae: isString, audioVae: isString, acceleration: oneOf(ACCELERATIONS),
};

function readSettings(defaults: Settings): Settings {
  try {
    const saved = Object.entries(JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "{}"));
    return { ...defaults, ...Object.fromEntries(saved.filter(([key, value]) => Object.hasOwn(SETTING_CHECKS, key) && SETTING_CHECKS[key as keyof Settings](value))) };
  } catch {
    return defaults;
  }
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

function jobLine(run: Run, job: PublicJob | null) {
  return `Job: ${run.kind} ${run.id}, status ${job?.status ?? "unknown"}`;
}

// A plain-text report for a GitHub issue or Discord: nothing about the uploads, prompts or saved settings.
function CopyDetails({ lines }: { lines: string[] }) {
  const [copied, setCopied] = useState(false);
  const [manual, setManual] = useState("");
  const box = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);
  useEffect(() => box.current?.select(), [manual]);

  async function copy() {
    const text = ["Openjutsu", ...lines.filter(Boolean), `Browser: ${navigator.userAgent}`, `Time: ${new Date().toISOString()}`].join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setManual("");
      setCopied(true);
    } catch {
      // No clipboard over plain HTTP: select the text so it can be copied by hand.
      setManual(text);
    }
  }

  return (<>
    <button className="secondary" onClick={copy}>{copied ? "Copied" : "Copy error details"}</button>
    {manual && <textarea ref={box} className="report" readOnly rows={manual.split("\n").length} value={manual} aria-label="Error details" onFocus={(event) => event.currentTarget.select()} />}
  </>);
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
  const [action, setAction] = useState("");
  const [look, setLook] = useState<{ file: File; url: string } | null>(null);
  const [biggestOnly, setBiggestOnly] = useState(false);
  const [keepOutline, setKeepOutline] = useState(true);
  const [placement, setPlacement] = useState<PlacementKeyframe[]>([]);
  const [paint, setPaint] = useState<PaintKeyframe[]>([]);
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
  const [useLoras, setUseLoras] = useState(true);
  const [describer, setDescriber] = useState(DEFAULT_DESCRIBER);
  const [welcome, setWelcome] = useState(false);
  const [modelsLoading, setModelsLoading] = useState(true);
  const [modelsError, setModelsError] = useState("");
  const [textEncoder, setTextEncoder] = useState(DEFAULT_MODEL.textEncoder);
  const [videoVae, setVideoVae] = useState(DEFAULT_MODEL.videoVae);
  const [audioVae, setAudioVae] = useState(DEFAULT_MODEL.audioVae);
  const [acceleration, setAcceleration] = useState<Acceleration>(DEFAULT_MODEL.acceleration);
  const enabledLoras = useLoras ? loras.filter((lora) => lora.enabled !== false) : [];
  const speedLora = hasSpeedLora(enabledLoras);
  const selectedAcceleration = speedLora ? "none" : acceleration;
  const [files, setFiles] = useState<ModelFiles>({ models: [], loras: [], textEncoders: [], vaes: [] });
  const [submitting, setSubmitting] = useState(false);
  const [checkingSetup, setCheckingSetup] = useState(false);
  const [setup, setSetup] = useState<SetupResult | null>(null);
  const [formError, setFormError] = useState("");

  const [run, setRun] = useState<Run | null>(null);
  const [history, setHistory] = useState<PastRun[]>([]);
  const [job, setJob] = useState<PublicJob | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [preview, setPreview] = useState("");
  const [streamError, setStreamError] = useState("");
  const [now, setNow] = useState(Date.now());
  const [restored, setRestored] = useState(false);

  useEffect(() => {
    setRun(readRun());
    setHistory(readHistory());
  }, []);

  const settings: Settings = {
    mode, maxQuality, montage, resolution, customSize, hatFix, noLipSync, margin, target, editMode, editTarget, biggestOnly, keepOutline, post,
    detailOn, detail, toneOn, tone, tonePreset, faceStyle, chunkSeconds, seed, clipSeconds, motion, steps, model, loras,
    useLoras, describer, textEncoder, videoVae, audioVae, acceleration,
  };
  const savedSettings = JSON.stringify(settings);

  useEffect(() => {
    const s = readSettings(settings);
    setMode(s.mode); setMaxQuality(s.maxQuality); setMontage(s.montage); setResolution(s.resolution); setCustomSize(s.customSize);
    setHatFix(s.hatFix); setNoLipSync(s.noLipSync); setMargin(s.margin); setTarget(s.target); setEditMode(s.editMode); setEditTarget(s.editTarget);
    setBiggestOnly(s.biggestOnly); setKeepOutline(s.keepOutline); setPost(s.post); setDetailOn(s.detailOn); setDetail(s.detail); setToneOn(s.toneOn);
    setTone(s.tone); setTonePreset(s.tonePreset); setFaceStyle(s.faceStyle); setChunkSeconds(s.chunkSeconds); setSeed(s.seed);
    setClipSeconds(s.clipSeconds); setMotion(s.motion); setSteps(s.steps); setModel(s.model); setLoras(s.loras);
    try { setWelcome(localStorage.getItem(WELCOME_KEY) !== "1"); } catch { setWelcome(true); }
    setDescriber(s.describer);
    setUseLoras(s.useLoras); setTextEncoder(s.textEncoder); setVideoVae(s.videoVae); setAudioVae(s.audioVae); setAcceleration(s.acceleration);
    setRestored(true);
  }, []);

  useEffect(() => {
    if (!restored) return;
    try {
      localStorage.setItem(SETTINGS_KEY, savedSettings);
    } catch {}
  }, [restored, savedSettings]);

  useEffect(() => {
    if (!restored) return;
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
    } catch {}
  }, [restored, history]);

  // A finished job that ComfyUI later forgets keeps its finished status and file name.
  useEffect(() => {
    if (!job || !TERMINAL.has(job.status)) return;
    setHistory((list) => list.map((p) => p.id !== job.id || (p.status && job.status === "expired") ? p : { ...p, status: job.status, result: job.video?.name }));
  }, [job?.id, job?.status]);

  useEffect(() => setSetup(null), [mode, post, montage, maxQuality, resolution, motion, hatFix, noLipSync, model, loras, useLoras, describer, textEncoder, videoVae, audioVae, acceleration, detailOn, toneOn, faceStyle, editMode, characters.length, !!look]);

  async function refreshModels() {
    setModelsLoading(true);
    setModelsError("");
    try {
      const response = await fetch("/api/models");
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Could not read models from ComfyUI.");
      setFiles(result);
    } catch (error) {
      setModelsError(error instanceof Error ? error.message : "Could not read models from ComfyUI.");
    } finally {
      setModelsLoading(false);
    }
  }

  function finishWelcome() {
    try { localStorage.setItem(WELCOME_KEY, "1"); } catch {}
    setWelcome(false);
  }

  useEffect(() => {
    void refreshModels();
    fetch("/api/presets").then((response) => response.json()).then(({ tone }: { tone: TonePreset[] }) => setPresets(tone), () => {});
  }, []);

  // Orion's own copy of the chosen preset wins over the built-in or saved values once it has loaded.
  useEffect(() => {
    const saved = presets.find((p) => p.name === tonePreset);
    if (saved) setTone(toneFromPreset(saved.settings));
  }, [presets]);

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
    // An answer other than an event stream (401, 403, 500) ends the stream for good; a dropped connection is retried.
    source.onerror = () => {
      if (source.readyState === EventSource.CLOSED) setStreamError("Lost the connection to this job. Reload the page to try again, or go Back: the job keeps running in ComfyUI.");
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
      const duration = Number.isFinite(probe.duration) ? probe.duration : 0;
      setVideo((current) => (current?.url === url ? { ...current, duration, width: probe.videoWidth, height: probe.videoHeight } : current));
      setPart({ start: 0, length: duration });
    };
    probe.src = url;
  }

  function choosePart(start: number, length: number) {
    const duration = video?.duration ?? 0;
    const next = { start: Math.min(Math.max(0, start), duration - length), length };
    if (next.start !== part.start || next.length !== part.length) setPlacement([]);
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
  useEffect(() => { setPlacement([]); setPaint([]); }, [video?.url, resolutionField, whole, part.start, part.length]);
  useEffect(() => setPaint([]), [editTarget]);
  // A montage render masks with the tracks Find people saved, so it must use the frames Find people saw.
  const frames = video ? `${video.file.name}:${video.file.size} ${whole ? "whole" : `${part.start.toFixed(2)}+${part.length.toFixed(2)}`} ${typeof resolution === "object" ? resolutionField : ""}` : "";
  // A job reopened from Recent jobs may have used another video, part or size than the one loaded now.
  const same = run?.frames === frames;

  function chooseSize(side: keyof Size, value: number) {
    const snapped = Math.min(CUSTOM_SIZE.max, Math.max(CUSTOM_SIZE.min, Math.round(value / CUSTOM_SIZE.step) * CUSTOM_SIZE.step || customSize[side]));
    const size = { ...customSize, [side]: snapped };
    setCustomSize(size);
    setResolution(size);
    return snapped;
  }

  const edit = EDITS.find((e) => e.id === editMode)!;
  const clips = !video?.duration ? 0 : faceFix ? faceChunkCount(part.length || video.duration, chunkSeconds) : clipCount(part.length || video.duration, clipSeconds);
  const ready = colorFix ? detailOn || toneOn : mode === "object"
    ? editMode === "remove" || (editMode !== "add" || placement.length > 0) && (!!changeTo.trim() || !!look)
    : !!character;
  const generateKind: Kind = mode === "object" ? "object"
    : mode === "post" ? post : mode === "simple" ? "simple" : montage ? "montage" : onePassEach ? "advanced_maxq" : "advanced";
  const tab = `Tab: ${mode === "post" ? `post/${post}` : mode === "object" ? `object/${editMode}` : mode === "advanced" && montage ? "advanced/montage" : mode}`;

  function chooseLook(files: File[]) {
    if (!files[0]) return;
    if (look) URL.revokeObjectURL(look.url);
    setLook({ file: files[0], url: URL.createObjectURL(files[0]) });
  }

  async function submit(kind: Kind, review?: Review) {
    if (!video || (kind === "fit" ? !placement.length : kind !== "mask" && kind !== "people" && !ready)) return;
    setSubmitting(true);
    setCheckingSetup(true);
    setSetup(null);
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
    form.set("target", target);
    if (kind === "simple" && character) {
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
      form.set("resolution", resolutionField);
      form.set("seed", String(seed));
      form.set("clip_seconds", String(clipSeconds));
    }
    if (kind === "fit") {
      form.set("action", action);
      form.set("placement", JSON.stringify(placement.map((p) => ({ ...p, frame: p.frame - Math.round((whole ? 0 : part.start) * 24) }))));
      form.set("resolution", resolutionField);
    }
    if (kind === "people") {
      for (const c of shown) form.append("role", c.role);
      form.set("resolution", resolutionField);
    }
    if (kind === "montage") {
      for (const c of shown) {
        form.append("picture", c.file);
        form.append("role", c.role);
      }
      if (review) {
        form.set("tracks", review.tracks);
        form.set("labels", JSON.stringify(review.labels));
      }
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
      if (editMode === "change" && paint.length) form.set("paint", JSON.stringify(paint.map((p) => ({ ...p, frame: p.frame - Math.round((whole ? 0 : part.start) * 24) }))));
      if (editMode === "add") {
        form.set("placement", JSON.stringify(placement.map((p) => ({ ...p, frame: p.frame - Math.round((whole ? 0 : part.start) * 24) }))));
        form.set("action", action);
      }
      form.set("resolution", resolutionField);
      form.set("seed", String(seed));
      form.set("clip_seconds", String(clipSeconds));
    }
    if (kind !== "mask" && kind !== "color" && kind !== "people" && kind !== "fit") {
      form.set("motion", String(motion));
      form.set("steps", String(steps));
      form.set("model", model);
      form.set("text_encoder", textEncoder);
      form.set("video_vae", videoVae);
      form.set("audio_vae", audioVae);
      form.set("acceleration", selectedAcceleration);
      for (const l of enabledLoras) {
        form.append("lora", l.name);
        form.append("lora_strength", String(l.strength));
        form.append("lora_speed", String(isSpeedLora(l)));
      }
    }
    if (kind !== "mask" && kind !== "color" && kind !== "fit") form.set("describer", describer);
    const shared = { resolution, motion, hatFix, noLipSync, margin, seed, clipSeconds };
    const selectedModel = { model, loras: enabledLoras, steps, describer, textEncoder, videoVae, audioVae, acceleration: selectedAcceleration };
    let selection: SetupRequest;
    if (kind === "simple") selection = { kind, settings: { ...shared, role: character?.role ?? "", target: String(form.get("target")) }, model: selectedModel };
    else if (kind === "advanced" || kind === "advanced_maxq") selection = { kind, settings: { ...shared, roles: shown.map((c) => c.role) }, pictures: shown.length, model: selectedModel };
    else if (kind === "montage") selection = { kind, settings: { ...shared, roles: shown.map((c) => c.role) }, pictures: shown.length, review: review ?? null, model: selectedModel };
    else if (kind === "object") selection = { kind, settings: { ...shared, mode: editMode as EditMode, target: String(form.get("target")), changeTo, biggestOnly, keepOutline,
      ...(editMode === "change" ? { paint: paint.map((p) => ({ ...p, frame: p.frame - Math.round((whole ? 0 : part.start) * 24) })) } : {}),
      ...(editMode === "add" ? { placement: placement.map((p) => ({ ...p, frame: p.frame - Math.round((whole ? 0 : part.start) * 24) })) } : {}) }, picture: !!look && editMode !== "remove", model: selectedModel };
    else if (kind === "face") selection = { kind, settings: { style: faceStyle, seed, chunkSeconds }, model: selectedModel };
    else if (kind === "color") selection = { kind, settings: { detail: detailOn ? detail : null, tone: toneOn ? tone : null } };
    else if (kind === "mask") selection = { kind, hatFix, margin, target: String(form.get("target")) };
    else selection = kind === "people" ? { kind, resolution, describer } : { kind, resolution };

    try {
      const checked = await fetch("/api/setup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(selection) });
      const result = await checked.json();
      if (!checked.ok) throw new Error(result.error ?? "Could not check setup.");
      setSetup(result);
      if (!result.ok) return;
      setCheckingSetup(false);
      const response = await fetch("/api/jobs", { method: "POST", body: form });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Could not start the job.");
      const next: Run = { id: body.id, kind, margin, clips: Math.max(clips, 1), clipSeconds: kind === "face" ? chunkSeconds : clipSeconds, startedAt: Date.now(), frames };
      writeRun(next);
      setHistory((list) => [next, ...list.filter((p) => p.id !== next.id)].slice(0, HISTORY_LENGTH));
      setJob(body);
      setProgress(null);
      setPreview("");
      setStreamError("");
      setRun(next);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Could not start the job.");
    } finally {
      setCheckingSetup(false);
      setSubmitting(false);
    }
  }

  async function cancel() {
    if (!run) return;
    setFormError("");
    try {
      const response = await fetch(`/api/jobs/${run.id}`, { method: "DELETE" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Could not cancel the job.");
      setJob(body);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Could not cancel the job.");
    }
  }

  function reset() {
    setFormError("");
    setSetup(null);
    writeRun(null);
    setRun(null);
    setJob(null);
    setProgress(null);
    setPreview("");
    setStreamError("");
  }

  function reopen(past: PastRun) {
    setFormError("");
    setSetup(null);
    writeRun(past);
    setRun(past);
  }

  async function fixResult(next: Post) {
    if (!job?.video) return;
    setFormError("");
    try {
      const response = await fetch(job.video.url);
      if (!response.ok) throw new Error();
      const blob = await response.blob();
      chooseVideo([new File([blob], job.video.name, { type: blob.type || "video/mp4" })]);
    } catch {
      setFormError("Could not load the result video. Download it and choose it in Post-processing.");
      return;
    }
    reset();
    setMode("post");
    setPost(next);
  }

  if (!restored) return <main className="shell"><p className="hint" role="status">Loading Openjutsu…</p></main>;
  if (welcome && !run) return <Welcome value={describer} options={files.textEncoders} onChange={setDescriber}
    loading={modelsLoading} error={modelsError} onRefresh={refreshModels} onContinue={finishWelcome} />;

  return (
    <main className="shell">
      <header className="top row">
        <div className="brand">
          <span className="mark" aria-hidden>忍</span>
          <div>
            <h1>Openjutsu</h1>
            <p>Swap the people or things in any video. Open weights, on your own GPU.</p>
          </div>
        </div>
        <button className="secondary" disabled={!!run || submitting} onClick={() => setWelcome(true)}>Welcome &amp; models</button>
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

      {mode === "object" && !run && <nav className="segmented" aria-label="Object swap tools">
        {EDITS.map((e) => <button key={e.id} className={e.id === editMode ? "on" : ""} aria-pressed={e.id === editMode} onClick={() => {
          if (e.id !== editMode) { setEditTarget(e.target); setChangeTo(""); setAction(""); }
          setEditMode(e.id);
        }}>{e.label}</button>)}
      </nav>}

      {formError && <div className="row">
        <p className="error" role="alert">{formError}</p>
        <CopyDetails lines={[tab, run ? jobLine(run, job) : "", `Error: ${formError}`]} />
      </div>}
      {checkingSetup && <p className="hint" role="status">Checking required nodes and models…</p>}
      {setup && !setup.ok && (
        <section className="panel setup" role="alert">
          <h2>Setup needs attention</h2>
          {setup.error && <p className="error">{setup.error}</p>}
          {setup.packs.length > 0 && <>
            <p className="hint">Install or update each custom node pack in the <code>custom_nodes</code> folder of the ComfyUI installation Openjutsu connects to, with one subfolder per pack (for example, <code>ComfyUI/custom_nodes/ComfyUI-KJNodes</code>).</p>
            <p className="hint">Use ComfyUI Manager or follow the links below for installation and Python dependency instructions. If ComfyUI itself is listed, update ComfyUI. Then restart ComfyUI and try again.</p>
            <ul>{setup.packs.map((pack) => <li key={pack.url}>
              <a href={pack.url} target="_blank" rel="noopener noreferrer">{pack.name} ↗</a>
              {pack.nodes.length > 0 && <small>Missing nodes: {pack.nodes.join(", ")}</small>}
            </li>)}</ul>
          </>}
          {setup.models.length > 0 && <>
            <p className="hint">Add these models to ComfyUI, or choose an installed base model or LoRA, then try again.</p>
            <ul>{setup.models.map((item) => <li key={`${item.folder}/${item.name}`}>
              <code>{item.name}</code><small>ComfyUI/models/{item.folder}</small>
            </li>)}</ul>
          </>}
          <CopyDetails lines={[tab, "Setup check failed", setup.error ? `Error: ${setup.error}` : "",
            ...setup.packs.map((pack) => `Missing pack: ${pack.name} ${pack.url}${pack.nodes.length ? ` (nodes: ${pack.nodes.join(", ")})` : ""}`),
            ...setup.models.map((item) => `Missing model: ComfyUI/models/${item.folder}/${item.name}`)]} />
        </section>
      )}
      {run ? (
        <RunView
          run={run} job={job} progress={progress} preview={preview} streamError={streamError} now={now}
          before={video && same ? { url: video.url, start: whole ? 0 : part.start } : null}
          onCancel={cancel} onReset={reset} onFix={fixResult} onGenerate={!video || !same || submitting ? null : mode === "simple" && character ? () => submit("simple") : run.kind === "fit" && ready ? () => submit("object") : null}
          onUseBox={video && same ? (box) => { setPlacement([{ frame: Math.round((whole ? 0 : part.start) * 24), ...box }]); reset(); } : null}
          margin={margin} onMargin={setMargin} onRecheck={video && !submitting ? () => submit("mask") : null}
          photos={shown.map((c) => c.url)}
          onMontage={video && character && !submitting ? (tracks, labels) => submit("montage", { tracks, labels }) : null} frames={frames}
          onRetry={video && same && ready && !submitting && run.kind === generateKind && generateKind !== "montage" ? () => { reset(); submit(generateKind); } : null}
        />
      ) : mode === "object" && editMode === "picture" ? <FromPicture initialVideo={video?.file} initialPicture={look?.file} start={whole ? 0 : part.start} describer={describer} /> : (
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
                    selfie handovers, travel and &ldquo;vibe&rdquo; montages. Generate tracks everyone over the whole video, matches them to the
                    photos and makes the video in one go. To check who becomes which photo first, use Find people. Give every photo a role with a look after
                    &ldquo; - &rdquo; (&ldquo;the dancer - white polo, jeans&rdquo;) so the people can be told apart. Use Standard for everything else.
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
                  <label>
                    <span>{edit.what} <small>{editMode === "add" ? "Describe the placement, for example on the table in front of the person." : "What SAM tracks, in English."}{(editMode === "change" || editMode === "remove") && " Separate several with commas."}</small></span>
                    <input value={editTarget} maxLength={100} placeholder={edit.target} onChange={(event) => setEditTarget(event.target.value)} />
                  </label>
                  <label>
                    <span>{edit.toHint}</span>
                    <input value={changeTo} maxLength={300} placeholder={`e.g. ${edit.to}`} onChange={(event) => setChangeTo(event.target.value)} />
                  </label>
                  {editMode === "add" && <label>
                    <span>What happens with it <small>Optional. Leave empty for a still object.</small></span>
                    <input value={action} maxLength={300} placeholder="e.g. she dances the same routine in sync with the others" onChange={(event) => setAction(event.target.value)} />
                  </label>}
                  {editMode !== "remove" && (look ? (
                    <div className="character look">
                      <img src={look.url} alt="Reference picture" />
                      <button className="remove" onClick={() => { URL.revokeObjectURL(look.url); setLook(null); }} aria-label="Remove picture">×</button>
                    </div>
                  ) : (
                    <DropZone accept="image/*" onFiles={chooseLook} className="add">
                      <strong>+</strong>
                      <span>{editMode === "add" ? "Picture of the object (optional)" : editMode === "background" ? "Picture of the place (optional)" : "Picture of the new look (optional)"}</span>
                    </DropZone>
                  ))}
                  <p className="hint">
                    {editMode === "change" && "Only what SAM tracks is regenerated: hair, a top, a car. A picture of an outfit, hairstyle or product is copied onto it."}
                    {editMode === "add" && "A new object is generated inside your placement area while the scene continues. Keep the supporting surface visible and describe where the object rests."}
                    {editMode === "remove" && "What SAM tracks is erased and filled with what is around it. The camera, people and sound stay."}
                    {editMode === "background" && "Everything except what SAM tracks becomes the new place; the camera movement stays."}
                  </p>
                  {editMode === "change" && video && canvas && <details>
                    <summary>Paint edit area (optional)</summary>
                    <ObjectPlacement key={`${video.url}:${resolutionField}:paint`} src={video.url}
                      start={whole ? 0 : part.start} end={whole ? video.duration : part.start + part.length}
                      width={canvas[0]} height={canvas[1]} mode="paint" points={paint} onChange={setPaint} />
                  </details>}
                  {editMode === "add" && video && canvas && <ObjectPlacement key={`${video.url}:${resolutionField}`} src={video.url}
                    start={whole ? 0 : part.start} end={whole ? video.duration : part.start + part.length} width={canvas[0]} height={canvas[1]} points={placement} onChange={setPlacement} />}
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
            {mode === "object" && (editMode === "change" || editMode === "remove") && (
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
            {mode === "advanced" && !montage && (
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
              <div className="setting">
                <span>Visual describer <small>Reads pictures and video frames to write prompts. Use a vision-language model in models/text_encoders.</small></span>
                <FilePicker label="Visual describer" value={describer} options={files.textEncoders} onChange={setDescriber} />
              </div>
              <div className="setting">
                <span>H3 text encoder <small>Choose your MiniMax H3 Qwen3-VL 32B quantization from models/text_encoders.</small></span>
                <FilePicker label="H3 text encoder" value={textEncoder} options={files.textEncoders} onChange={setTextEncoder} />
              </div>
              <div className="setting">
                <span>Video VAE <small>Choose a MiniMax H3 video VAE from models/vae.</small></span>
                <FilePicker label="Video VAE" value={videoVae} options={files.vaes} onChange={setVideoVae} />
              </div>
              <div className="setting">
                <span>Audio VAE <small>Choose a MiniMax H3 audio VAE from models/vae.</small></span>
                <FilePicker label="Audio VAE" value={audioVae} options={files.vaes} onChange={setAudioVae} />
              </div>
              <label className="setting toggle">
                <span>Use LoRAs <small>Turn off to use the base model alone. Without a speed LoRA, use 20 or more steps.</small></span>
                <input type="checkbox" checked={useLoras} onChange={(event) => setUseLoras(event.target.checked)} />
                <i />
              </label>
              {useLoras && <div className="setting loras">
                <span>LoRAs <small>Applied in order to the base model.</small></span>
                <div className="lora-list">
                  {loras.map((l, i) => (
                    <div className="lora-entry" key={i}>
                      <div className="lora">
                        <FilePicker label={`LoRA ${i + 1}`} value={l.name} options={files.loras} onChange={(name) => setLoras(loras.map((x, j) => (j === i ? { ...x, name } : x)))} />
                        <input
                          type="number" aria-label={`LoRA ${i + 1} strength`} min={STRENGTH.min} max={STRENGTH.max} step={0.05} value={l.strength}
                          onChange={(event) => setLoras(loras.map((x, j) => (j === i ? { ...x, strength: Math.min(STRENGTH.max, Math.max(STRENGTH.min, Number(event.target.value) || 0)) } : x)))}
                        />
                        <button className="secondary" onClick={() => setLoras(loras.filter((_, j) => j !== i))} aria-label={`Remove LoRA ${i + 1}`}>×</button>
                      </div>
                      <label className="setting toggle">
                        <span>{isSpeedLora(l) ? "Use speed LoRA" : "Use this LoRA"}<small>Turn off to skip this LoRA and keep its settings.</small></span>
                        <input type="checkbox" aria-label={`Use LoRA ${i + 1}`} checked={l.enabled !== false}
                          onChange={(event) => setLoras(loras.map((x, j) => j === i ? { ...x, enabled: event.target.checked } : x))} />
                        <i />
                      </label>
                      {!isSpeedLora({ ...l, speed: false }) && <label className="setting toggle">
                        <span>Speed LoRA <small>Mark renamed or other few-step LoRAs here.</small></span>
                        <input type="checkbox" aria-label={`LoRA ${i + 1} is a speed LoRA`} checked={l.speed === true}
                          onChange={(event) => setLoras(loras.map((x, j) => j === i ? { ...x, speed: event.target.checked } : x))} />
                        <i />
                      </label>}
                    </div>
                  ))}
                  {loras.length < MAX_LORAS && (
                    <button className="secondary" onClick={() => setLoras([...loras, { name: files.loras[0] ?? "", strength: 1 }])}>Add LoRA</button>
                  )}
                </div>
              </div>}
              <div className="setting">
                <span>Acceleration <small>{speedLora ? "Turn off the speed LoRA to use Spectrum." : "Spectrum skips some H3 evaluations and can change the result. Requires ComfyUI-Spectrum-MiniMax-H3; use 20 or more steps."}</small></span>
                <select className="file-name" aria-label="Acceleration" value={selectedAcceleration} disabled={speedLora} onChange={(event) => setAcceleration(event.target.value as Acceleration)}>
                  <option value="none">Off</option>
                  <option value="spectrum">Spectrum</option>
                </select>
              </div>
            </details>
          </section>
          )}

          <div className="go">
            <div className="row">
              {mode === "simple" && <button className="secondary" disabled={!video || submitting} onClick={() => submit("mask")}>Check mask</button>}
              {mode === "object" && editMode === "add" && <button className="secondary" disabled={!video || !placement.length || submitting} onClick={() => submit("fit")}>Check fit</button>}
              {mode === "advanced" && montage ? (<>
                <button className="secondary" disabled={!video || !character || submitting} onClick={() => submit("people")}>Find people</button>
                <button className="primary" disabled={!video || !character || submitting} onClick={() => submit("montage")}>{submitting ? checkingSetup ? "Checking setup…" : "Uploading…" : "Generate"}</button>
              </>) : (
                <button className="primary" disabled={!video || !ready || submitting} onClick={() => submit(generateKind)}>
                  {submitting ? checkingSetup ? "Checking setup…" : "Uploading…" : "Generate"}
                </button>
              )}
            </div>
            <small>{colorFix
              ? !video ? "Add a video." : ready ? `${(part.length || video.duration).toFixed(1)} s of video` : "Turn on detail contrast, the tone mapper or both."
              : clips && ready
              ? mode === "advanced" && montage ? `${clips > 1 ? "About " : ""}${clips} clip${clips > 1 ? "s" : ""} or more at ${canvas ? `${canvas[0]}×${canvas[1]}` : resolution}; Find people (about 3 minutes per 18 s) lets you check the picks first.`
              : faceFix ? `Up to ${clips} chunk${clips > 1 ? "s" : ""} of face`
              : `${clips > 1 ? "About " : ""}${clips} clip${clips > 1 ? "s" : ""} at ${canvas ? `${canvas[0]}×${canvas[1]}` : resolution}`
              : mode === "object" && editMode === "add" && video && !placement.length ? "Draw where the new object should go."
              : `Add a video and ${mode === "object" ? editMode === "add" ? "describe the object to add" : "say what it becomes" : faceFix ? "the photo of the person" : mode === "simple" ? "a character photo" : "character photos"}.`}</small>
          </div>

          {history.length > 0 && (
            <section className="history">
              <div className="row">
                <h2>Recent jobs</h2>
                <button className="link" onClick={() => setHistory([])}>Clear</button>
              </div>
              <ul>
                {history.map((p) => (
                  <li key={p.id}>
                    <button disabled={submitting} onClick={() => reopen(p)}>
                      <span>{KIND_LABELS[p.kind]}</span>
                      <small>{new Date(p.startedAt).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</small>
                      <small className={p.status}>{STATUS_LABELS[p.status ?? ""] ?? "Not finished"}</small>
                      <small className="file">{p.result}</small>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </main>
  );
}

function RunView({ run, job, progress, preview, streamError, now, before, onCancel, onReset, onFix, onGenerate, onUseBox, margin, onMargin, onRecheck, photos, onMontage, frames, onRetry }: {
  run: Run; job: PublicJob | null; progress: Progress | null; preview: string; streamError: string; now: number;
  before: { url: string; start: number } | null;
  onCancel: () => void; onReset: () => void; onFix: (post: Post) => void; onGenerate: (() => void) | null;
  onUseBox: ((box: NonNullable<FitSummary["needed"]>) => void) | null;
  margin: Margin; onMargin: (margin: Margin) => void; onRecheck: (() => void) | null;
  photos: string[]; onMontage: ((tracks: string, labels: Label[]) => void) | null; frames: string; onRetry: (() => void) | null;
}) {
  const status = job?.status ?? "queued";
  const clips = Math.max(run.clips, progress?.clip ?? 1);
  const people = run.kind === "people";
  const mask = run.kind === "mask" || run.kind === "fit" || people;

  if (people && status === "succeeded" && job?.data) {
    return (
      <PersonList
        url={job.data} photos={photos} onBack={onReset}
        onGenerate={run.frames === frames ? onMontage : null}
      />
    );
  }

  if (run.kind === "mask" && status === "succeeded" && job?.video) {
    return (
      <MaskCheck
        url={job.video.url} clipSeconds={run.clipSeconds} checked={run.margin ?? "normal"} margin={margin}
        onMargin={onMargin} onRecheck={onRecheck} onGenerate={onGenerate} onBack={onReset}
      />
    );
  }

  if (run.kind === "fit" && status === "succeeded" && job?.video) {
    return <FitCheck url={job.video.url} data={job.data} onUseBox={onUseBox} onGenerate={onGenerate} onBack={onReset} />;
  }

  if (status === "succeeded" && job?.video) {
    return (
      <section className="panel result">
        {before ? <Compare before={before} after={job.video.url} /> : <video src={job.video.url} controls autoPlay playsInline />}
        {run.kind === "montage" && job.data && <KeptNote url={job.data} />}
        <div className="row">
          <a className="primary" href={`${job.video.url}?download`} download={job.video.name}>Download MP4</a>
          {POSTS.filter((p) => p.id !== run.kind).map((p) => <button key={p.id} className="secondary" onClick={() => onFix(p.id)}>{p.label}</button>)}
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
        <div className="row">
          {status !== "succeeded" && onRetry && <button className="primary" onClick={onRetry}>Retry</button>}
          {(status === "failed" || status === "expired") && <CopyDetails lines={[jobLine(run, job), job?.error ? `Error: ${job.error}` : "", streamError && `Stream error: ${streamError}`]} />}
          <button className="secondary" onClick={onReset}>Back</button>
        </div>
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
        <h2>{status === "queued" ? `Queued${job?.queuePosition ? ` (#${job.queuePosition})` : ""}` : people ? "Finding people" : run.kind === "fit" ? "Checking the fit" : mask ? "Checking the mask" : color ? "Fixing the colours"
          : face ? (sampling ? `Chunk ${chunk} of up to ${run.clips}` : chunk ? "Pasting the face back" : "Tracking the face")
          : progress?.clip ? `Clip ${progress.clip} of ${clips > 1 || run.kind === "montage" ? "about " : ""}${clips}` : "Preparing"}</h2>
        <span className="time">{elapsed(now - run.startedAt)}</span>
      </div>
      <div className="bar"><div style={{ width: `${Math.round(fraction * 100)}%` }} /></div>
      <p className="node">
        {progress ? progress.title : status === "queued" ? "Waiting for ComfyUI…" : "Working…"}
        {progress?.steps ? ` · step ${progress.step ?? 0}/${progress.steps}` : ""}
      </p>
      {preview && <img className="preview" src={preview} alt="Mask preview: white areas are regenerated" />}
      {streamError && <div className="row">
        <p className="error">{streamError}</p>
        <CopyDetails lines={[jobLine(run, job), `Stream error: ${streamError}`]} />
      </div>}
      <p className="hint">{people ? "SAM tracks everyone over the whole video, then Qwen matches each person to a role." : mask ? "SAM tracks the whole video once, about a minute per 3 s of video." : color ? "Every frame goes through the filters, then the video is saved with its soundtrack." : face ? "The face is tracked over the whole video, then each chunk is regenerated; nothing is saved until the end." : "Each clip is saved as it finishes, so a rerun with the same inputs resumes where it stopped."} You can close this page and come back.</p>
      <div className="row">
        <button className="secondary" onClick={onCancel}>Cancel</button>
        <button className="secondary" onClick={onReset}>Back</button>
      </div>
    </section>
  );
}

// The result plays with its own controls; the source follows it from the start of the part used, clipped to the left of the divider.
function Compare({ before, after }: { before: { url: string; start: number }; after: string }) {
  const result = useRef<HTMLVideoElement>(null);
  const source = useRef<HTMLVideoElement>(null);
  const [split, setSplit] = useState(50);
  const [ratio, setRatio] = useState(16 / 9);
  const [paused, setPaused] = useState(true);

  function follow(drift = 0) {
    const r = result.current, s = source.current;
    if (!r || !s) return;
    const target = r.currentTime + before.start;
    if (Math.abs(s.currentTime - target) > drift) s.currentTime = target;
  }

  function play() {
    const s = source.current;
    if (!s || !result.current) return;
    s.playbackRate = result.current.playbackRate;
    follow();
    s.play().catch(() => {});
    setPaused(false);
  }

  function pause() {
    source.current?.pause();
    follow();
    setPaused(true);
  }

  function drag(event: PointerEvent<HTMLDivElement>) {
    const box = event.currentTarget.parentElement!.getBoundingClientRect();
    setSplit(Math.min(100, Math.max(0, ((event.clientX - box.left) / box.width) * 100)));
  }

  return (
    <div className={`compare ${paused ? "paused" : ""}`} style={{ "--split": `${split}%`, "--ratio": ratio } as CSSProperties}>
      <video
        ref={result} src={after} controls autoPlay playsInline
        onLoadedMetadata={(event) => event.currentTarget.videoHeight && setRatio(event.currentTarget.videoWidth / event.currentTarget.videoHeight)}
        onPlay={play} onPause={pause} onSeeking={() => follow()} onTimeUpdate={() => follow(0.1)}
        onRateChange={(event) => { if (source.current) source.current.playbackRate = event.currentTarget.playbackRate; }}
      />
      <video ref={source} className="before" src={before.url} muted playsInline preload="auto" aria-hidden onLoadedMetadata={() => follow()} />
      <span className="compare-label">Before</span>
      <span className="compare-label after">After</span>
      <div
        className="compare-line" role="slider" tabIndex={0} aria-label="Before and after divider"
        aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(split)}
        onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); drag(event); }}
        onPointerMove={(event) => event.currentTarget.hasPointerCapture(event.pointerId) && drag(event)}
        onKeyDown={(event) => {
          const step = event.key === "ArrowLeft" ? -5 : event.key === "ArrowRight" ? 5 : 0;
          if (!step) return;
          event.preventDefault();
          setSplit((current) => Math.min(100, Math.max(0, current + step)));
        }}
      />
    </div>
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
        onLoadedMetadata={(event) => setFrames(Number.isFinite(event.currentTarget.duration) ? Math.round(event.currentTarget.duration * 24) : 0)}
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
        <small>Frame {frame + 1} / {frames} · {(frame / 24).toFixed(2)} s · clip {starts.filter((start) => start <= frame).length} of {starts.length > 1 ? "about " : ""}{starts.length}</small>
      </div>
      <p className="hint legend">
        <i className="swatch cyan" /> regenerated <i className="swatch orange" /> tracked person · right: the grey mannequin H3 copies the motion from.
        Anything outside the cyan area stays as it is, so the new character should fit inside it.
      </p>
      <p className="hint">The check tracks the whole video at once and the render tracks each clip, so they can differ slightly. Clip numbers here are an estimate: the render also ends clips on hard cuts.</p>
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
      {!onGenerate && <p className="hint">To generate, load the video this check used and add a character photo in the settings.</p>}
    </section>
  );
}

// Where the routine of the person the add copies leaves the box, before generating.
function FitCheck({ url, data, onUseBox, onGenerate, onBack }: {
  url: string; data: string | null; onUseBox: ((box: NonNullable<FitSummary["needed"]>) => void) | null; onGenerate: (() => void) | null; onBack: () => void;
}) {
  const [summary, setSummary] = useState<FitSummary | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (data) fetch(data).then((response) => response.json()).then(setSummary, () => setError("Could not read what the fit check found."));
  }, [data]);

  const misses = summary?.outside ?? [];
  return (
    <section className="panel mask-check">
      <h2>Check the fit</h2>
      <video src={url} controls loop autoPlay muted playsInline />
      <p className="hint legend">
        <i className="swatch green" /> predicted motion inside the edit area <i className="swatch red" /> outside it: possible clipping. Yellow: edit boundary.
      </p>
      {error && <p className="error">{error}</p>}
      {summary && <p>{!summary.person ? "No one to copy was found in this part, so there is nothing to check the box against."
        : misses.length ? `${summary.moving ? "Their predicted motion leaves the moving edit area" : "Their routine leaves the box"} at ${misses.map((o) => `${timecode(o.start / 24)}–${timecode(o.end / 24)} (${o.sides.join(", ")})`).join(", ")}.`
        : summary.moving ? "Their predicted motion stays inside the moving edit area." : "Their whole routine fits inside your box."}</p>}
      <p className="hint">{summary?.moving ? "The yellow boundary follows the copied routine and is the same moving edit area used for generation. Your box sets placement and scale. H3 can move differently, so this remains a guide." : "The check moves the person nearest your box into it, as tall as the box and standing on its bottom edge. H3 follows a routine loosely, so it is a guide, not a promise. A box much wider than one person can also bring back a copy of the dancer."}</p>
      <div className="row">
        {summary?.needed && misses.length > 0 && <button className="primary" disabled={!onUseBox} onClick={() => onUseBox?.(summary.needed!)}>Use a box that fits</button>}
        <button className={misses.length ? "secondary" : "primary"} disabled={!onGenerate} onClick={() => onGenerate?.()}>Generate</button>
        <button className="secondary" onClick={onBack}>Back to settings</button>
      </div>
      {!onGenerate && <p className="hint">To generate, load the video and part this check used and fill in the Add settings.</p>}
    </section>
  );
}

// A montage without review keeps brief or small appearances as they are; say so instead of passing the swap off as complete.
function KeptNote({ url }: { url: string }) {
  const [kept, setKept] = useState<Kept[]>([]);
  useEffect(() => {
    fetch(url).then((response) => response.json()).then((data: { kept: Kept[] }) => setKept(data.kept), () => setKept([]));
  }, [url]);
  if (!kept.length) return null;
  return (
    <p className="hint">
      Left as they are, too {kept.every((k) => k.small) ? "small" : "brief or small"} for H3 to draw:{" "}
      {kept.map((k) => `photo ${k.photo}'s person at ${timecode(k.start / 24)}–${timecode(k.end / 24)}`).join(", ")}. Use Find people to pick them anyway.
    </p>
  );
}

function PersonList({ url, photos, onBack, onGenerate }: {
  url: string; photos: string[]; onBack: () => void; onGenerate: ((tracks: string, labels: Label[]) => void) | null;
}) {
  const [found, setFound] = useState<{ tracks: string | null; list: Appearance[] } | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch(url).then((response) => response.json()).then((people: People) => setFound({ tracks: people.tracks, list: appearances(people) }),
      () => setError("Could not read what Find people found."));
  }, [url]);

  const labels = found ? renderLabels(found.list) : [];

  function pick(index: number, photo: number) {
    setFound((current) => current && { ...current, list: current.list.map((a, i) => (i === index ? { ...a, pick: photo } : a)) });
  }

  return (
    <section className="panel">
      <h2>People {found && <small>{found.list.length} appearance{found.list.length === 1 ? "" : "s"}</small>}</h2>
      <p className="hint">
        Everyone SAM tracked, in order of appearance, matched to the photos. Check each one and pick the photo they become,
        or Keep to leave them as they are. The whole video is then made in one go, with one H3 pass per photo on screen.
      </p>
      {error && <p className="error">{error}</p>}
      {!found && !error && <p className="hint">Loading…</p>}
      <div className="people-list">
        {found?.list.map((a, i) => (
          <div className="person" key={`${a.track}:${a.start}`}>
            <img src={a.image} alt={`Appearance ${i + 1}`} />
            <small>
              {timecode(a.on[0][0] / 24)}–{timecode(a.on.at(-1)![1] / 24)} · {a.role ? `looks like photo ${a.role}` : "none of the photos"}
              {a.small ? " · small in the frame" : ""}
            </small>
            <div className="segmented photo-pick">
              {photos.map((photo, k) => (
                <button key={k} className={a.pick === k + 1 ? "on" : ""} onClick={() => pick(i, k + 1)} aria-label={`Photo ${k + 1}`}>
                  <img src={photo} alt="" />
                </button>
              ))}
              <button className={a.pick ? "" : "on"} onClick={() => pick(i, 0)}>Keep</button>
            </div>
          </div>
        ))}
      </div>
      {found && !found.list.length && <p className="hint">Nobody found.</p>}
      {found && !onGenerate && <p className="hint">The video, the part to use or the custom size changed since Find people, or a photo is missing. Go back and find the people again.</p>}
      <div className="row">
        <button className="primary" disabled={!onGenerate || !found?.tracks || !labels.length} onClick={() => onGenerate?.(found!.tracks!, labels)}>
          {labels.length ? "Generate" : "Pick a photo to generate"}
        </button>
        <button className="secondary" onClick={onBack}>Back to settings</button>
      </div>
    </section>
  );
}
