"use client";

import { useEffect, useRef, useState, type CSSProperties, type DragEvent, type PointerEvent, type ReactNode } from "react";
import type { PublicJob } from "../lib/comfy.ts";
import type { SetupRequest, SetupResult } from "../lib/setup.ts";
import type { NodeInfo } from "../lib/progress.ts";
import { clipCount, clipStarts } from "../lib/clips.ts";
import { CLIP_SECONDS, DEFAULT_TARGET, MARGINS, MAX_SEED, MIN_SECTION_SECONDS, MOTION_SIZES, PLACES, PLACE_LABELS, placeStart, RESOLUTIONS, CUSTOM_SIZE, canvasSize, timecode, type Margin, type MotionSize, type Resolution, type Section, type Size } from "../lib/simple.ts";
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
  simple: "Cambio de persona", mask: "Comprobar máscara", advanced: "Cambio avanzado", advanced_maxq: "Cambio avanzado", object: "Cambio de objeto", fit: "Comprobar encaje",
  face: "Corregir caras", color: "Corregir colores", people: "Buscar personas", montage: "Montaje",
};
const STATUS_LABELS: Record<string, string> = { succeeded: "Hecho", failed: "Fallido", canceled: "Cancelado", expired: "Caducado" };
const MARGIN_LABELS: Record<Margin, string> = { tight: "Ajustado", normal: "Normal", loose: "Amplio" };

const MODES = [
  { id: "simple", title: "Transferencia de movimiento simple", text: "Sustituye a la persona principal del vídeo por tu personaje.", ready: true },
  { id: "advanced", title: "Transferencia de movimiento avanzada", text: "Varias personas: elige quién se convierte en quién.", ready: true },
  { id: "object", title: "Cambio de objeto", text: "Cambia el pelo, la ropa, un objeto o el fondo, o elimina algo.", ready: true },
  { id: "post", title: "Posprocesado", text: "Corrige las caras o los colores de un vídeo terminado.", ready: true },
] as const;

const POSTS: { id: Post; label: string }[] = [{ id: "face", label: "Corregir caras" }, { id: "color", label: "Corregir colores" }];

const FACE_STYLE_TEXT: Record<FaceStyle, { label: string; hint: string }> = {
  photo: { label: "Igualar la foto", hint: "La cara se redibuja a partir de la foto: el mayor parecido posible, aunque H3 inventa sus propias expresiones y movimientos de boca." },
  mouth: { label: "Seguir la boca", hint: "La cara sigue las expresiones y los movimientos de boca del vídeo; se parece un poco menos a la foto." },
};

type EditTab = EditMode | "picture";
const EDITS: { id: EditTab; label: string; target: string; what: string; to: string; toHint: string }[] = [
  { id: "change", label: "Cambiar", target: "hair, top", what: "Qué cambiar", to: "short bright pink hair and a black leather jacket", toHint: "En qué se convierte" },
  { id: "add", label: "Añadir", target: "on the table", what: "Dónde va", to: "a chocolate cake on a plate", toHint: "Objeto que añadir" },
  { id: "remove", label: "Quitar", target: "poster", what: "Qué quitar", to: "a plain wall", toHint: "Qué se ve en su lugar (opcional)" },
  { id: "background", label: "Fondo", target: "person", what: "Qué se queda", to: "a snowy mountain pass at dusk", toHint: "El nuevo lugar" },
  { id: "picture", label: "Desde una foto", target: "person", what: "A quién sustituye", to: "", toHint: "" },
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
  return `Trabajo: ${run.kind} ${run.id}, estado ${job?.status ?? "desconocido"}`;
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
    <button className="secondary" onClick={copy}>{copied ? "Copiado" : "Copiar detalles del error"}</button>
    {manual && <textarea ref={box} className="report" readOnly rows={manual.split("\n").length} value={manual} aria-label="Detalles del error" onFocus={(event) => event.currentTarget.select()} />}
  </>);
}

function MarginPicker({ value, onChange }: { value: Margin; onChange: (margin: Margin) => void }) {
  return (
    <div className="segmented">
      {(Object.keys(MARGINS) as Margin[]).map((m) => (
        <button key={m} className={m === value ? "on" : ""} onClick={() => onChange(m)}>{MARGIN_LABELS[m]}</button>
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
      if (!response.ok) throw new Error(result.error ?? "No se pudieron leer los modelos de ComfyUI.");
      setFiles(result);
    } catch (error) {
      setModelsError(error instanceof Error ? error.message : "No se pudieron leer los modelos de ComfyUI.");
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
      if (source.readyState === EventSource.CLOSED) setStreamError("Se perdió la conexión con este trabajo. Recarga la página para volver a intentarlo, o pulsa Volver: el trabajo sigue ejecutándose en ComfyUI.");
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
      if (!checked.ok) throw new Error(result.error ?? "No se pudo comprobar la configuración.");
      setSetup(result);
      if (!result.ok) return;
      setCheckingSetup(false);
      const response = await fetch("/api/jobs", { method: "POST", body: form });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "No se pudo iniciar el trabajo.");
      const next: Run = { id: body.id, kind, margin, clips: Math.max(clips, 1), clipSeconds: kind === "face" ? chunkSeconds : clipSeconds, startedAt: Date.now(), frames };
      writeRun(next);
      setHistory((list) => [next, ...list.filter((p) => p.id !== next.id)].slice(0, HISTORY_LENGTH));
      setJob(body);
      setProgress(null);
      setPreview("");
      setStreamError("");
      setRun(next);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "No se pudo iniciar el trabajo.");
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
      if (!response.ok) throw new Error(body.error ?? "No se pudo cancelar el trabajo.");
      setJob(body);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "No se pudo cancelar el trabajo.");
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
      setFormError("No se pudo cargar el vídeo del resultado. Descárgalo y elígelo en Posprocesado.");
      return;
    }
    reset();
    setMode("post");
    setPost(next);
  }

  if (!restored) return <main className="shell"><p className="hint" role="status">Cargando Openjutsu…</p></main>;
  if (welcome && !run) return <Welcome value={describer} options={files.textEncoders} onChange={setDescriber}
    loading={modelsLoading} error={modelsError} onRefresh={refreshModels} onContinue={finishWelcome} />;

  return (
    <main className="shell">
      <header className="top row">
        <div className="brand">
          <span className="mark" aria-hidden>忍</span>
          <div>
            <h1>Openjutsu</h1>
            <p>Cambia las personas o los objetos de cualquier vídeo. Pesos abiertos, en tu propia GPU.</p>
          </div>
        </div>
        <button className="secondary" disabled={!!run || submitting} onClick={() => setWelcome(true)}>Bienvenida y modelos</button>
      </header>

      <nav className="modes" aria-label="Modo">
        {MODES.map((m) => (
          <button
            key={m.id} className={`mode ${m.id === mode ? "active" : ""}`} disabled={!m.ready || !!run} aria-pressed={m.id === mode}
            onClick={() => setMode(m.id)}
          >
            <strong>{m.title}</strong>
            <span>{m.text}</span>
            {!m.ready && <em>Próximamente</em>}
          </button>
        ))}
      </nav>

      {mode === "object" && !run && <nav className="segmented" aria-label="Herramientas de cambio de objeto">
        {EDITS.map((e) => <button key={e.id} className={e.id === editMode ? "on" : ""} aria-pressed={e.id === editMode} onClick={() => {
          if (e.id !== editMode) { setEditTarget(e.target); setChangeTo(""); setAction(""); }
          setEditMode(e.id);
        }}>{e.label}</button>)}
      </nav>}

      {formError && <div className="row">
        <p className="error" role="alert">{formError}</p>
        <CopyDetails lines={[tab, run ? jobLine(run, job) : "", `Error: ${formError}`]} />
      </div>}
      {checkingSetup && <p className="hint" role="status">Comprobando nodos y modelos requeridos…</p>}
      {setup && !setup.ok && (
        <section className="panel setup" role="alert">
          <h2>La configuración requiere atención</h2>
          {setup.error && <p className="error">{setup.error}</p>}
          {setup.packs.length > 0 && <>
            <p className="hint">Instala o actualiza cada pack de nodos personalizados en la carpeta <code>custom_nodes</code> de la instalación de ComfyUI a la que se conecta Openjutsu, con una subcarpeta por pack (por ejemplo, <code>ComfyUI/custom_nodes/ComfyUI-KJNodes</code>).</p>
            <p className="hint">Usa ComfyUI Manager o sigue los enlaces de abajo para instalar y ver las dependencias de Python. Si aparece el propio ComfyUI, actualízalo. Después reinicia ComfyUI y vuelve a intentarlo.</p>
            <ul>{setup.packs.map((pack) => <li key={pack.url}>
              <a href={pack.url} target="_blank" rel="noopener noreferrer">{pack.name} ↗</a>
              {pack.nodes.length > 0 && <small>Nodos que faltan: {pack.nodes.join(", ")}</small>}
            </li>)}</ul>
          </>}
          {setup.models.length > 0 && <>
            <p className="hint">Añade estos modelos a ComfyUI, o elige un modelo base o LoRA instalado, y vuelve a intentarlo.</p>
            <ul>{setup.models.map((item) => <li key={`${item.folder}/${item.name}`}>
              <code>{item.name}</code><small>ComfyUI/models/{item.folder}</small>
            </li>)}</ul>
          </>}
          <CopyDetails lines={[tab, "La comprobación de configuración falló", setup.error ? `Error: ${setup.error}` : "",
            ...setup.packs.map((pack) => `Pack que falta: ${pack.name} ${pack.url}${pack.nodes.length ? ` (nodos: ${pack.nodes.join(", ")})` : ""}`),
            ...setup.models.map((item) => `Modelo que falta: ComfyUI/models/${item.folder}/${item.name}`)]} />
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
              <h2><span>1</span> Vídeo de origen</h2>
              {video ? (
                <div className="video-pick">
                  <video
                    ref={player} src={video.url} controls muted playsInline
                    onTimeUpdate={(event) => { if (!whole && event.currentTarget.currentTime >= part.start + part.length) event.currentTarget.currentTime = part.start; }}
                  />
                  <div className="row">
                    <small>{video.file.name}{video.duration ? ` · ${video.duration.toFixed(1)} s` : ""}</small>
                    <DropZone accept="video/*,.mkv" onFiles={chooseVideo} className="link">Reemplazar</DropZone>
                  </div>
                  {video.duration > MIN_SECTION_SECONDS && (
                    <>
                      <div className="setting">
                        <span>Parte a usar <small>{timecode(part.start)}–{timecode(part.start + part.length)} ({part.length.toFixed(1)} s). Solo se sustituye esta parte.</small></span>
                        <div className="segmented">
                          {PLACES.map((p) => (
                            <button key={p} className={p === place ? "on" : ""} onClick={() => p === "Whole" ? choosePart(0, video.duration) : choosePart(placeStart(p, video.duration, part.length), part.length)}>{PLACE_LABELS[p]}</button>
                          ))}
                        </div>
                      </div>
                      <label className="setting">
                        <span>Duración <small>{part.length.toFixed(1)} s</small></span>
                        <input type="range" min={MIN_SECTION_SECONDS} max={video.duration} step={0.5} value={part.length} onChange={(event) => choosePart(part.start, Number(event.target.value))} />
                      </label>
                      <label className="setting">
                        <span>Empieza en <small>{timecode(part.start)}</small></span>
                        <input type="range" min={0} max={video.duration - part.length} step={0.1} value={part.start} disabled={whole} onChange={(event) => choosePart(Number(event.target.value), part.length)} />
                      </label>
                    </>
                  )}
                </div>
              ) : (
                <DropZone accept="video/*,.mkv" onFiles={chooseVideo} className="big">
                  <strong>Arrastra un vídeo</strong>
                  <span>o haz clic para buscarlo. Se conservan la cámara, los cortes, el movimiento y la banda sonora.</span>
                </DropZone>
              )}
            </div>

            <div className="panel">
              <h2><span>2</span> {mode === "object" ? "Qué cambiar" : colorFix ? "Corrección de color" : faceFix ? "Cara de quién" : mode === "simple" ? "Personaje" : "Personajes"}</h2>
              {mode === "post" && (
                <div className="segmented">
                  {POSTS.map((p) => (
                    <button key={p.id} className={p.id === post ? "on" : ""} onClick={() => setPost(p.id)}>{p.label}</button>
                  ))}
                </div>
              )}
              {mode === "advanced" && (<>
                <div className="segmented">
                  <button className={montage ? "" : "on"} onClick={() => setMontage(false)}>Estándar</button>
                  <button className={montage ? "on" : ""} onClick={() => setMontage(true)}>Montaje</button>
                </div>
                {montage && (
                  <p className="hint">
                    Para clips editados en los que varias personas se turnan dentro de un mismo plano, sin un corte claro entre ellas: barridos de cámara,
                    pasos de selfi, viajes y montajes de &ldquo;ambiente&rdquo;. Generar sigue a todo el mundo por el vídeo entero, lo empareja con las
                    fotos y hace el vídeo de una vez. Para comprobar antes quién se convierte en cada foto, usa Buscar personas. Da a cada foto un rol con un aspecto después
                    de &ldquo; - &rdquo; (&ldquo;la bailarina - polo blanco, vaqueros&rdquo;) para poder distinguir a las personas. Usa Estándar para todo lo demás.
                  </p>
                )}
              </>)}
              {colorFix ? (<>
                <label className="setting toggle">
                  <span>Contraste de detalle <small>Suaviza el detalle fino y crujiente de H3 y la piel sobreexigida, sin difuminar los bordes.</small></span>
                  <input type="checkbox" checked={detailOn} onChange={(event) => setDetailOn(event.target.checked)} />
                  <i aria-hidden />
                </label>
                {detailOn && <label className="setting">
                  <span>Cantidad <small>{detail.toFixed(2)}: por debajo de 0 suaviza, por encima de 0 enfoca.</small></span>
                  <input type="range" min={DETAIL.min} max={DETAIL.max} step={0.01} value={detail} onChange={(event) => setDetail(Number(event.target.value))} />
                </label>}
                <label className="setting toggle">
                  <span>Mapeador tonal <small>Orion4D DCTL Tone Mapper, un etalonaje sobre cada fotograma. {DEFAULT_PRESET} suaviza el contraste y las altas luces y mantiene los negros profundos.</small></span>
                  <input type="checkbox" checked={toneOn} onChange={(event) => setToneOn(event.target.checked)} />
                  <i aria-hidden />
                </label>
                {toneOn && <div className="setting">
                  <span>Preajuste <small>Los preajustes guardados de Orion. Cambia los valores en Ajustes para crear el tuyo.</small></span>
                  <select className="file-name" aria-label="Preajuste del mapeador tonal" value={tonePreset} onChange={(event) => choosePreset(event.target.value)}>
                    {!tonePreset && <option value="">Personalizado</option>}
                    {presetOptions.map((p) => <option key={p.name} value={p.name}>{p.name}</option>)}
                  </select>
                </div>}
                <p className="hint">Sin ejecutar H3: el vídeo solo se filtra, así que conserva sus fotogramas y su banda sonora. Primero se aplica el contraste de detalle y después el mapeador tonal.</p>
              </>) : mode === "object" ? (
                <div className="edit">
                  <label>
                    <span>{edit.what} <small>{editMode === "add" ? "Describe la colocación, por ejemplo en la mesa delante de la persona." : "Lo que sigue SAM, en inglés."}{(editMode === "change" || editMode === "remove") && " Separa varios con comas."}</small></span>
                    <input value={editTarget} maxLength={100} placeholder={edit.target} onChange={(event) => setEditTarget(event.target.value)} />
                  </label>
                  <label>
                    <span>{edit.toHint}</span>
                    <input value={changeTo} maxLength={300} placeholder={`p. ej. ${edit.to}`} onChange={(event) => setChangeTo(event.target.value)} />
                  </label>
                  {editMode === "add" && <label>
                    <span>Qué hace <small>Opcional. Déjalo vacío para un objeto quieto.</small></span>
                    <input value={action} maxLength={300} placeholder="p. ej., baila la misma coreografía sincronizada con los demás" onChange={(event) => setAction(event.target.value)} />
                  </label>}
                  {editMode !== "remove" && (look ? (
                    <div className="character look">
                      <img src={look.url} alt="Imagen de referencia" />
                      <button className="remove" onClick={() => { URL.revokeObjectURL(look.url); setLook(null); }} aria-label="Quitar imagen">×</button>
                    </div>
                  ) : (
                    <DropZone accept="image/*" onFiles={chooseLook} className="add">
                      <strong>+</strong>
                      <span>{editMode === "add" ? "Foto del objeto (opcional)" : editMode === "background" ? "Foto del lugar (opcional)" : "Foto del nuevo aspecto (opcional)"}</span>
                    </DropZone>
                  ))}
                  <p className="hint">
                    {editMode === "change" && "Solo se regenera lo que sigue SAM: el pelo, una prenda, un coche. Una foto de un conjunto, un peinado o un producto se copia encima."}
                    {editMode === "add" && "Se genera un objeto nuevo dentro de tu zona de colocación mientras la escena continúa. Mantén visible la superficie de apoyo y describe dónde se apoya el objeto."}
                    {editMode === "remove" && "Lo que sigue SAM se borra y se rellena con lo que hay alrededor. La cámara, las personas y el sonido se mantienen."}
                    {editMode === "background" && "Todo excepto lo que sigue SAM se convierte en el nuevo lugar; el movimiento de cámara se mantiene."}
                  </p>
                  {editMode === "change" && video && canvas && <details>
                    <summary>Pintar zona de edición (opcional)</summary>
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
                    <img src={c.url} alt={`Personaje ${i + 1}`} />
                    <button className="remove" onClick={() => removeCharacter(i)} aria-label={`Quitar personaje ${i + 1}`}>×</button>
                    {mode !== "post" && <label>
                      <span>¿A quién sustituyen? (opcional)</span>
                      <input
                        value={c.role}
                        maxLength={200}
                        placeholder={i === 0 ? "p. ej., la cantante - vestido rojo" : "p. ej., el batería - gorra negra"}
                        onChange={(event) => setRole(i, event.target.value)}
                      />
                    </label>}
                  </div>
                ))}
                {shown.length < limit && (
                  <DropZone accept="image/*" onFiles={addCharacters} multiple={mode === "advanced"} className="add">
                    <strong>+</strong>
                    <span>Arrastra una foto</span>
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
                  {FACE_STYLE_TEXT[faceStyle].hint} Usa la foto con la que se hizo el vídeo. Solo cambia la cara de esa persona; las caras
                  que ocupan más de un quinto del fotograma ya están nítidas y se dejan como están.
                </p>
              </>) : mode === "simple" ? (
                <p className="hint">
                  El personaje sustituye a la persona principal del vídeo, la que ocupa más parte del fotograma. Los demás se quedan como están.
                  Los espejos y los reflejos todavía no funcionan.
                  Para nombrarla en el prompt, usa un rol (&ldquo;la cantante&rdquo;), no prendas; su aspecto puede ir después de &ldquo; - &rdquo; (&ldquo;la cantante - vestido rojo&rdquo;).
                </p>
              ) : (
                <p className="hint">
                  Hasta {MAX_CHARACTERS} personajes. En cada clip, cada persona seguida se empareja con un rol; las personas sin
                  personaje (extras, transeúntes) se quedan como están. Los espejos y los reflejos todavía no funcionan. Nombra roles (&ldquo;el batería&rdquo;), no prendas, y añade su aspecto
                  después de &ldquo; - &rdquo; para ayudar al emparejamiento (&ldquo;el batería - hombre con gorra&rdquo;). Los roles vacíos van a las personas con
                  más tiempo en pantalla.
                </p>
              )}
              </>)}
            </div>
          </section>

          {colorFix ? toneOn && (
            <section className="panel settings">
              <h2><span>3</span> Ajustes <small>{tonePreset || "Personalizado"}</small></h2>
              <div className="setting">
                <span>Modo del mapeador tonal</span>
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
              <p className="hint">La intensidad mezcla el etalonaje con el original: 0,2 es un 20 %. Elige el preajuste otra vez para deshacer tus cambios.</p>
            </section>
          ) : (
          <section className="panel settings">
            <h2><span>3</span> Ajustes</h2>
            {mode !== "post" && <div className="setting">
              <span>Resolución <small>{typeof resolution === "object" ? "Ancho × alto. El vídeo se escala y se recorta al centro con esta forma." : `${canvas ? `${canvas[0]} × ${canvas[1]} para este vídeo` : "Lado corto del vídeo"}. La forma sigue a la fuente.`}</small></span>
              <div className="segmented">
                {RESOLUTIONS.map((r) => (
                  <button key={r} className={r === resolution ? "on" : ""} onClick={() => setResolution(r)}>{r}</button>
                ))}
                <button className={typeof resolution === "object" ? "on" : ""} onClick={() => setResolution(customSize)}>Personalizado</button>
              </div>
              {typeof resolution === "object" && (
                <div className="custom-size">
                  {(["width", "height"] as const).map((side) => (
                    <label key={side}>
                      {side === "height" && "×"}
                      <input
                        className="steps-input" type="number" aria-label={`${side} personalizado en píxeles`} min={CUSTOM_SIZE.min} max={CUSTOM_SIZE.max} step={CUSTOM_SIZE.step}
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
                <span>Solo el más grande <small>Desactivado: cambia cada coincidencia que encuentra SAM (el pelo de todos). Activado: solo la que ocupa más parte del fotograma.</small></span>
                <input type="checkbox" checked={biggestOnly} onChange={(event) => setBiggestOnly(event.target.checked)} />
                <i aria-hidden />
              </label>
            )}
            {mode === "object" && editMode === "change" && (
              <label className="setting toggle">
                <span>Mantener el contorno original <small>Activado: la cara, las manos y los brazos de alrededor quedan exactos, pero el nuevo aspecto conserva la forma antigua (mangas, largo). Desactivado: la forma puede cambiar (de pelo largo a media melena, de pantalón a falda), pero los bordes junto a la cara y las manos pueden perderse.</small></span>
                <input type="checkbox" checked={keepOutline} onChange={(event) => setKeepOutline(event.target.checked)} />
                <i aria-hidden />
              </label>
            )}
            {mode === "simple" && (
              <div className="setting">
                <span>Qué sustituir <small>Lo que sigue SAM, en inglés: person, cat, dog, o una descripción corta como “black and white cat”. Se sustituye la coincidencia más grande.</small></span>
                <input className="target-input" aria-label="Qué sustituir" placeholder={DEFAULT_TARGET} value={target} onChange={(event) => setTarget(event.target.value)} />
              </div>
            )}
            {(mode === "simple" || mode === "advanced") && <label className="setting toggle">
              <span>Corregir sombreros <small>También sustituye los sombreros{mode === "advanced" ? " que llevan las personas sustituidas" : ""} (unos 45 s más por clip).</small></span>
              <input type="checkbox" checked={hatFix} onChange={(event) => setHatFix(event.target.checked)} />
              <i aria-hidden />
            </label>}
            {(mode === "simple" || mode === "advanced") && <label className="setting toggle">
              <span>Sin sincronía labial <small>Para canciones que las personas del vídeo no cantan ni hablan, así el nuevo {mode === "advanced" ? "grupo" : "personaje"} no mueve los labios con ellas (unos 30 s más por clip).</small></span>
              <input type="checkbox" checked={noLipSync} onChange={(event) => setNoLipSync(event.target.checked)} />
              <i aria-hidden />
            </label>}
            {mode === "advanced" && !montage && (
              <label className="setting toggle">
                <span>Una pasada por persona <small>Cada personaje recibe su propia pasada de H3 con solo su foto, así que el tiempo de generación se duplica.{shown.length === 2 ? "" : " Necesita exactamente dos personajes."}</small></span>
                <input type="checkbox" checked={onePassEach} disabled={shown.length !== 2} onChange={(event) => setMaxQuality(event.target.checked)} />
                <i aria-hidden />
              </label>
            )}
            {mode !== "post" && <div className="setting">
              <span>Margen de la máscara <small>{mode === "object"
                ? editMode === "background" ? "Hasta dónde llega el nuevo lugar hacia el borde de lo que se queda." : "Espacio alrededor para una forma nueva más grande y su sombra."
                : <>Espacio alrededor de la persona para un personaje con otra complexión.{mode === "simple" ? " Comprobar máscara lo muestra." : ""}</>}</small></span>
              <MarginPicker value={margin} onChange={setMargin} />
            </div>}
            <details>
              <summary>Avanzado</summary>
              <div className="setting">
                <span>Semilla <small>Cámbiala para una nueva toma.</small></span>
                <div className="seed">
                  <input type="number" min={0} max={MAX_SEED} value={seed} onChange={(event) => setSeed(Math.min(MAX_SEED, Math.max(0, Math.floor(Number(event.target.value) || 0))))} />
                  <button onClick={() => setSeed(Math.floor(Math.random() * MAX_SEED))} aria-label="Semilla aleatoria">🎲</button>
                </div>
              </div>
              {faceFix ? (
                <div className="setting">
                  <span>Duración del bloque <small>{chunkSeconds.toFixed(1)} s de cara por generación de H3; los bloques se solapan 1 s y se funden.</small></span>
                  <input type="range" min={CHUNK_SECONDS.min} max={CHUNK_SECONDS.max} step={0.5} value={chunkSeconds} onChange={(event) => setChunkSeconds(Number(event.target.value))} />
                </div>
              ) : (
                <div className="setting">
                  <span>Duración del clip <small>{clipSeconds.toFixed(1)} s por generación de H3</small></span>
                  <input type="range" min={CLIP_SECONDS.min} max={CLIP_SECONDS.max} step={0.5} value={clipSeconds} onChange={(event) => setClipSeconds(Number(event.target.value))} />
                </div>
              )}
              {mode !== "post" && <div className="setting">
                <span>Referencia de movimiento <small>Tamaño de las figuras grises de las que H3 copia el movimiento. Cuanto más grande, más se acerca a las poses originales; el muestreo tarda alrededor de un tercio más a 768 px y unas 2,4 veces más a 1376 px.</small></span>
                <div className="segmented">
                  {MOTION_SIZES.map((m) => (
                    <button key={m} className={m === motion ? "on" : ""} onClick={() => setMotion(m)}>{m} px</button>
                  ))}
                </div>
              </div>}
              <div className="setting">
                <span>Pasos <small>6 con la LoRA rápida DMAD; sin una LoRA rápida, 20 o más.</small></span>
                <input
                  className="steps-input" type="number" min={STEPS.min} max={STEPS.max} value={steps}
                  onChange={(event) => setSteps(Math.min(STEPS.max, Math.max(STEPS.min, Math.floor(Number(event.target.value) || STEPS.min))))}
                />
              </div>
              <div className="setting">
                <span>Modelo base <small>El modelo de difusión H3 en models/diffusion_models de ComfyUI.</small></span>
                <FilePicker label="Modelo base" value={model} options={files.models} onChange={setModel} />
              </div>
              <div className="setting">
                <span>Descriptor visual <small>Lee fotos y fotogramas para escribir prompts. Usa un modelo de visión y lenguaje en models/text_encoders.</small></span>
                <FilePicker label="Descriptor visual" value={describer} options={files.textEncoders} onChange={setDescriber} />
              </div>
              <div className="setting">
                <span>Codificador de texto H3 <small>Elige tu cuantización de MiniMax H3 Qwen3-VL 32B en models/text_encoders.</small></span>
                <FilePicker label="Codificador de texto H3" value={textEncoder} options={files.textEncoders} onChange={setTextEncoder} />
              </div>
              <div className="setting">
                <span>VAE de vídeo <small>Elige un VAE de vídeo MiniMax H3 en models/vae.</small></span>
                <FilePicker label="VAE de vídeo" value={videoVae} options={files.vaes} onChange={setVideoVae} />
              </div>
              <div className="setting">
                <span>VAE de audio <small>Elige un VAE de audio MiniMax H3 en models/vae.</small></span>
                <FilePicker label="VAE de audio" value={audioVae} options={files.vaes} onChange={setAudioVae} />
              </div>
              <label className="setting toggle">
                <span>Usar LoRAs <small>Desactívalo para usar solo el modelo base. Sin una LoRA rápida, usa 20 pasos o más.</small></span>
                <input type="checkbox" checked={useLoras} onChange={(event) => setUseLoras(event.target.checked)} />
                <i />
              </label>
              {useLoras && <div className="setting loras">
                <span>LoRAs <small>Se aplican en orden al modelo base.</small></span>
                <div className="lora-list">
                  {loras.map((l, i) => (
                    <div className="lora-entry" key={i}>
                      <div className="lora">
                        <FilePicker label={`LoRA ${i + 1}`} value={l.name} options={files.loras} onChange={(name) => setLoras(loras.map((x, j) => (j === i ? { ...x, name } : x)))} />
                        <input
                          type="number" aria-label={`Intensidad de la LoRA ${i + 1}`} min={STRENGTH.min} max={STRENGTH.max} step={0.05} value={l.strength}
                          onChange={(event) => setLoras(loras.map((x, j) => (j === i ? { ...x, strength: Math.min(STRENGTH.max, Math.max(STRENGTH.min, Number(event.target.value) || 0)) } : x)))}
                        />
                        <button className="secondary" onClick={() => setLoras(loras.filter((_, j) => j !== i))} aria-label={`Quitar LoRA ${i + 1}`}>×</button>
                      </div>
                      <label className="setting toggle">
                        <span>{isSpeedLora(l) ? "Usar LoRA rápida" : "Usar esta LoRA"}<small>Desactívalo para omitir esta LoRA y conservar sus ajustes.</small></span>
                        <input type="checkbox" aria-label={`Usar LoRA ${i + 1}`} checked={l.enabled !== false}
                          onChange={(event) => setLoras(loras.map((x, j) => j === i ? { ...x, enabled: event.target.checked } : x))} />
                        <i />
                      </label>
                      {!isSpeedLora({ ...l, speed: false }) && <label className="setting toggle">
                        <span>LoRA rápida <small>Marca aquí LoRAs renombradas u otras LoRAs de pocos pasos.</small></span>
                        <input type="checkbox" aria-label={`La LoRA ${i + 1} es una LoRA rápida`} checked={l.speed === true}
                          onChange={(event) => setLoras(loras.map((x, j) => j === i ? { ...x, speed: event.target.checked } : x))} />
                        <i />
                      </label>}
                    </div>
                  ))}
                  {loras.length < MAX_LORAS && (
                    <button className="secondary" onClick={() => setLoras([...loras, { name: files.loras[0] ?? "", strength: 1 }])}>Añadir LoRA</button>
                  )}
                </div>
              </div>}
              <div className="setting">
                <span>Aceleración <small>{speedLora ? "Desactiva la LoRA rápida para usar Spectrum." : "Spectrum omite algunas evaluaciones de H3 y puede cambiar el resultado. Requiere ComfyUI-Spectrum-MiniMax-H3; usa 20 pasos o más."}</small></span>
                <select className="file-name" aria-label="Aceleración" value={selectedAcceleration} disabled={speedLora} onChange={(event) => setAcceleration(event.target.value as Acceleration)}>
                  <option value="none">Desactivado</option>
                  <option value="spectrum">Spectrum</option>
                </select>
              </div>
            </details>
          </section>
          )}

          <div className="go">
            <div className="row">
              {mode === "simple" && <button className="secondary" disabled={!video || submitting} onClick={() => submit("mask")}>Comprobar máscara</button>}
              {mode === "object" && editMode === "add" && <button className="secondary" disabled={!video || !placement.length || submitting} onClick={() => submit("fit")}>Comprobar encaje</button>}
              {mode === "advanced" && montage ? (<>
                <button className="secondary" disabled={!video || !character || submitting} onClick={() => submit("people")}>Buscar personas</button>
                <button className="primary" disabled={!video || !character || submitting} onClick={() => submit("montage")}>{submitting ? checkingSetup ? "Comprobando configuración…" : "Subiendo…" : "Generar"}</button>
              </>) : (
                <button className="primary" disabled={!video || !ready || submitting} onClick={() => submit(generateKind)}>
                  {submitting ? checkingSetup ? "Comprobando configuración…" : "Subiendo…" : "Generar"}
                </button>
              )}
            </div>
            <small>{colorFix
              ? !video ? "Añade un vídeo." : ready ? `${(part.length || video.duration).toFixed(1)} s de vídeo` : "Activa el contraste de detalle, el mapeador tonal o ambos."
              : clips && ready
              ? mode === "advanced" && montage ? `${clips > 1 ? "Unos " : ""}${clips} clip${clips > 1 ? "s" : ""} o más a ${canvas ? `${canvas[0]}×${canvas[1]}` : resolution}; Buscar personas (unos 3 minutos por cada 18 s) te deja comprobar antes las elecciones.`
              : faceFix ? `Hasta ${clips} bloque${clips > 1 ? "s" : ""} de cara`
              : `${clips > 1 ? "Unos " : ""}${clips} clip${clips > 1 ? "s" : ""} a ${canvas ? `${canvas[0]}×${canvas[1]}` : resolution}`
              : mode === "object" && editMode === "add" && video && !placement.length ? "Dibuja dónde debe ir el nuevo objeto."
              : `Añade un vídeo y ${mode === "object" ? editMode === "add" ? "describe el objeto que quieres añadir" : "di en qué se convierte" : faceFix ? "la foto de la persona" : mode === "simple" ? "una foto de personaje" : "fotos de personajes"}.`}</small>
          </div>

          {history.length > 0 && (
            <section className="history">
              <div className="row">
                <h2>Trabajos recientes</h2>
                <button className="link" onClick={() => setHistory([])}>Vaciar</button>
              </div>
              <ul>
                {history.map((p) => (
                  <li key={p.id}>
                    <button disabled={submitting} onClick={() => reopen(p)}>
                      <span>{KIND_LABELS[p.kind]}</span>
                      <small>{new Date(p.startedAt).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</small>
                      <small className={p.status}>{STATUS_LABELS[p.status ?? ""] ?? "Sin terminar"}</small>
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
          <a className="primary" href={`${job.video.url}?download`} download={job.video.name}>Descargar MP4</a>
          {POSTS.filter((p) => p.id !== run.kind).map((p) => <button key={p.id} className="secondary" onClick={() => onFix(p.id)}>{p.label}</button>)}
          <button className="secondary" onClick={onReset}>{run.kind === "object" ? "Nueva edición" : run.kind === "face" || run.kind === "color" ? "Corregir otro" : "Nuevo cambio"}</button>
        </div>
      </section>
    );
  }

  if (TERMINAL.has(status)) {
    return (
      <section className="panel">
        <h2>{status === "canceled" ? "Cancelado" : status === "succeeded" ? "Terminado sin vídeo" : status === "expired" ? "El trabajo ya no está disponible" : "Algo salió mal"}</h2>
        {job?.error && <p className="error">{job.error}</p>}
        {status === "expired" && <p className="hint">ComfyUI ya no conoce este trabajo, por ejemplo tras un reinicio. Los vídeos terminados están en la carpeta output/{run.kind === "object" ? "h3_oneclick_edit" : run.kind === "face" ? "openjutsu_face" : run.kind === "color" ? "openjutsu_color" : "h3_oneclick_swap"} de ComfyUI.</p>}
        <div className="row">
          {status !== "succeeded" && onRetry && <button className="primary" onClick={onRetry}>Reintentar</button>}
          {(status === "failed" || status === "expired") && <CopyDetails lines={[jobLine(run, job), job?.error ? `Error: ${job.error}` : "", streamError && `Stream error: ${streamError}`]} />}
          <button className="secondary" onClick={onReset}>Volver</button>
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
        <h2>{status === "queued" ? `En cola${job?.queuePosition ? ` (#${job.queuePosition})` : ""}` : people ? "Buscando personas" : run.kind === "fit" ? "Comprobando el encaje" : mask ? "Comprobando la máscara" : color ? "Corrigiendo los colores"
          : face ? (sampling ? `Bloque ${chunk} de hasta ${run.clips}` : chunk ? "Pegando la cara de vuelta" : "Siguiendo la cara")
          : progress?.clip ? `Clip ${progress.clip} de ${clips > 1 || run.kind === "montage" ? "unos " : ""}${clips}` : "Preparando"}</h2>
        <span className="time">{elapsed(now - run.startedAt)}</span>
      </div>
      <div className="bar"><div style={{ width: `${Math.round(fraction * 100)}%` }} /></div>
      <p className="node">
        {progress ? progress.title : status === "queued" ? "Esperando a ComfyUI…" : "Trabajando…"}
        {progress?.steps ? ` · step ${progress.step ?? 0}/${progress.steps}` : ""}
      </p>
      {preview && <img className="preview" src={preview} alt="Vista previa de la máscara: las zonas blancas se regeneran" />}
      {streamError && <div className="row">
        <p className="error">{streamError}</p>
        <CopyDetails lines={[jobLine(run, job), `Stream error: ${streamError}`]} />
      </div>}
      <p className="hint">{people ? "SAM sigue a todo el mundo por el vídeo entero y luego Qwen empareja a cada persona con un rol." : mask ? "SAM sigue el vídeo entero una vez, alrededor de un minuto por cada 3 s de vídeo." : color ? "Cada fotograma pasa por los filtros y después el vídeo se guarda con su banda sonora." : face ? "La cara se sigue por todo el vídeo y después se regenera cada bloque; no se guarda nada hasta el final." : "Cada clip se guarda al terminar, así que repetir con las mismas entradas continúa donde se quedó."} Puedes cerrar esta página y volver."</p>
      <div className="row">
        <button className="secondary" onClick={onCancel}>Cancelar</button>
        <button className="secondary" onClick={onReset}>Volver</button>
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
      <span className="compare-label">Antes</span>
      <span className="compare-label after">Después</span>
      <div
        className="compare-line" role="slider" tabIndex={0} aria-label="Divisor entre antes y después"
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
      <h2>Comprobar la máscara</h2>
      <video
        ref={player} src={url} muted playsInline preload="auto"
        onLoadedMetadata={(event) => setFrames(Number.isFinite(event.currentTarget.duration) ? Math.round(event.currentTarget.duration * 24) : 0)}
        onTimeUpdate={(event) => playing && setFrame(Math.min(frames - 1, Math.floor(event.currentTarget.currentTime * 24)))}
        onEnded={() => setPlaying(false)}
      />
      <input className="scrub" type="range" min={0} max={Math.max(frames - 1, 0)} value={frame} aria-label="Fotograma" onChange={(event) => seek(Number(event.target.value))} />
      <div className="row">
        <div className="steps">
          <button className="secondary" onClick={() => seek(frame - 1)} aria-label="Fotograma anterior">◀</button>
          <button className="secondary" onClick={toggle}>{playing ? "Pausa" : "Reproducir"}</button>
          <button className="secondary" onClick={() => seek(frame + 1)} aria-label="Fotograma siguiente">▶</button>
        </div>
        <small>Fotograma {frame + 1} / {frames} · {(frame / 24).toFixed(2)} s · clip {starts.filter((start) => start <= frame).length} de {starts.length > 1 ? "unos " : ""}{starts.length}</small>
      </div>
      <p className="hint legend">
        <i className="swatch cyan" /> regenerado <i className="swatch orange" /> persona seguida · derecha: el maniquí gris del que H3 copia el movimiento.
        Todo lo que queda fuera de la zona cian se mantiene igual, así que el nuevo personaje debe caber dentro.
      </p>
      <p className="hint">La comprobación sigue el vídeo entero de una vez y el render sigue cada clip, así que pueden diferir un poco. Los números de clip son una estimación: el render también cierra clips en los cortes duros.</p>
      <div className="setting">
        <span>Margen de la máscara <small>{margin === checked ? `Mostrando ${MARGIN_LABELS[checked]}.` : `Mostrando ${MARGIN_LABELS[checked]}; vuelve a comprobar para ver ${MARGIN_LABELS[margin]}.`} Ajustado conserva más fondo; amplio da más espacio a un personaje más grande.</small></span>
        <MarginPicker value={margin} onChange={onMargin} />
      </div>
      <div className="row">
        {margin !== checked && <button className="primary" disabled={!onRecheck} onClick={() => onRecheck?.()}>Comprobar de nuevo</button>}
        <button className={margin === checked ? "primary" : "secondary"} disabled={!onGenerate} onClick={() => onGenerate?.()}>
          {margin === checked ? "Se ve bien, generar" : `Generar con margen ${MARGIN_LABELS[margin]}`}
        </button>
        <button className="secondary" onClick={onBack}>Volver a los ajustes</button>
      </div>
      {!onGenerate && <p className="hint">Para generar, carga el vídeo que usó esta comprobación y añade una foto de personaje en los ajustes.</p>}
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
    if (data) fetch(data).then((response) => response.json()).then(setSummary, () => setError("No se pudo leer lo que encontró la comprobación de encaje."));
  }, [data]);

  const misses = summary?.outside ?? [];
  return (
    <section className="panel mask-check">
      <h2>Comprobar el encaje</h2>
      <video src={url} controls loop autoPlay muted playsInline />
      <p className="hint legend">
        <i className="swatch green" /> movimiento previsto dentro de la zona de edición <i className="swatch red" /> fuera de ella: posible recorte. Amarillo: límite de la edición.
      </p>
      {error && <p className="error">{error}</p>}
      {summary && <p>{!summary.person ? "No se encontró a nadie a quien copiar en esta parte, así que no hay nada con lo que comprobar el recuadro."
        : misses.length ? `${summary.moving ? "Su movimiento previsto sale de la zona de edición móvil" : "Su coreografía sale del recuadro"} en ${misses.map((o) => `${timecode(o.start / 24)}–${timecode(o.end / 24)} (${o.sides.join(", ")})`).join(", ")}.`
        : summary.moving ? "Su movimiento previsto se mantiene dentro de la zona de edición móvil." : "Toda su coreografía cabe dentro de tu recuadro."}</p>}
      <p className="hint">{summary?.moving ? "El límite amarillo sigue la coreografía copiada y es la misma zona de edición móvil que se usa al generar. Tu recuadro fija la colocación y la escala. H3 puede moverse de otra forma, así que esto sigue siendo una guía." : "La comprobación mete en el recuadro a la persona más cercana, tan alta como el recuadro y apoyada en su borde inferior. H3 sigue una coreografía de forma aproximada, así que es una guía, no una promesa. Un recuadro mucho más ancho que una persona también puede traer de vuelta una copia del bailarín."}</p>
      <div className="row">
        {summary?.needed && misses.length > 0 && <button className="primary" disabled={!onUseBox} onClick={() => onUseBox?.(summary.needed!)}>Usar un recuadro que encaje</button>}
        <button className={misses.length ? "secondary" : "primary"} disabled={!onGenerate} onClick={() => onGenerate?.()}>Generar</button>
        <button className="secondary" onClick={onBack}>Volver a los ajustes</button>
      </div>
      {!onGenerate && <p className="hint">Para generar, carga el vídeo y la parte que usó esta comprobación y rellena los ajustes de Añadir.</p>}
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
      Se dejan como están, demasiado {kept.every((k) => k.small) ? "pequeñas" : "breves o pequeñas"} para que H3 las dibuje:{" "}
      {kept.map((k) => `la persona de la foto ${k.photo} en ${timecode(k.start / 24)}–${timecode(k.end / 24)}`).join(", ")}. Usa Buscar personas para elegirlas de todos modos.
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
      () => setError("No se pudo leer lo que encontró Buscar personas."));
  }, [url]);

  const labels = found ? renderLabels(found.list) : [];

  function pick(index: number, photo: number) {
    setFound((current) => current && { ...current, list: current.list.map((a, i) => (i === index ? { ...a, pick: photo } : a)) });
  }

  return (
    <section className="panel">
      <h2>Personas {found && <small>{found.list.length} aparici{found.list.length === 1 ? "ón" : "ones"}</small>}</h2>
      <p className="hint">
        Todos los que siguió SAM, en orden de aparición, emparejados con las fotos. Revisa cada uno y elige la foto en la que se convierte,
        o Mantener para dejarlo como está. Después el vídeo entero se hace de una vez, con una pasada de H3 por cada foto en pantalla.
      </p>
      {error && <p className="error">{error}</p>}
      {!found && !error && <p className="hint">Cargando…</p>}
      <div className="people-list">
        {found?.list.map((a, i) => (
          <div className="person" key={`${a.track}:${a.start}`}>
            <img src={a.image} alt={`Aparición ${i + 1}`} />
            <small>
              {timecode(a.on[0][0] / 24)}–{timecode(a.on.at(-1)![1] / 24)} · {a.role ? `parece la foto ${a.role}` : "ninguna de las fotos"}
              {a.small ? " · pequeño en el fotograma" : ""}
            </small>
            <div className="segmented photo-pick">
              {photos.map((photo, k) => (
                <button key={k} className={a.pick === k + 1 ? "on" : ""} onClick={() => pick(i, k + 1)} aria-label={`Foto ${k + 1}`}>
                  <img src={photo} alt="" />
                </button>
              ))}
              <button className={a.pick ? "" : "on"} onClick={() => pick(i, 0)}>Mantener</button>
            </div>
          </div>
        ))}
      </div>
      {found && !found.list.length && <p className="hint">No se encontró a nadie.</p>}
      {found && !onGenerate && <p className="hint">El vídeo, la parte a usar o el tamaño personalizado cambiaron desde Buscar personas, o falta una foto. Vuelve atrás y busca de nuevo a las personas.</p>}
      <div className="row">
        <button className="primary" disabled={!onGenerate || !found?.tracks || !labels.length} onClick={() => onGenerate?.(found!.tracks!, labels)}>
          {labels.length ? "Generar" : "Elige una foto para generar"}
        </button>
        <button className="secondary" onClick={onBack}>Volver a los ajustes</button>
      </div>
    </section>
  );
}
