"use client";

import { useCallback, useEffect, useRef, useState, type PointerEvent } from "react";
import { placementAt, type PaintKeyframe, type PlacementKeyframe } from "../lib/object.ts";

type Box = Omit<PlacementKeyframe, "frame">;
type Props = { src: string; start: number; end: number; width: number; height: number } & (
  | { mode?: "box"; points: PlacementKeyframe[]; onChange: (points: PlacementKeyframe[]) => void }
  | { mode: "paint"; points: PaintKeyframe[]; onChange: (points: PaintKeyframe[]) => void }
);

export function ObjectPlacement(props: Props) {
  const { src, start, end, width, height, points } = props;
  const painting = props.mode === "paint";
  const video = useRef<HTMLVideoElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const mask = useRef<HTMLCanvasElement | null>(null);
  const origin = useRef<{ x: number; y: number } | null>(null);
  const [time, setTime] = useState(start);
  const [draft, setDraft] = useState<Box | null>(null);
  const [eraser, setEraser] = useState(false);
  const [brush, setBrush] = useState(32);
  const frame = Math.round(time * 24);
  const scale = Math.min(1, 1024 / Math.max(width, height));
  const cw = Math.max(1, Math.round(width * scale));
  const ch = Math.max(1, Math.round(height * scale));
  const mw = Math.max(1, Math.round(cw * 256 / Math.max(cw, ch)));
  const mh = Math.max(1, Math.round(ch * 256 / Math.max(cw, ch)));

  const draw = useCallback(() => {
    const v = video.current;
    const c = canvas.current;
    if (!v || !c || v.readyState < 2) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    const cover = Math.max(c.width / v.videoWidth, c.height / v.videoHeight);
    const sw = c.width / cover, sh = c.height / cover;
    ctx.drawImage(v, (v.videoWidth - sw) / 2, (v.videoHeight - sh) / 2, sw, sh, 0, 0, c.width, c.height);
    if (props.mode === "paint") {
      if (mask.current) {
        ctx.globalAlpha = 0.5;
        ctx.drawImage(mask.current, 0, 0, c.width, c.height);
        ctx.globalAlpha = 1;
      }
    } else {
      const box = draft ?? placementAt(props.points, frame);
      if (box) {
        ctx.fillStyle = "rgba(214, 255, 63, 0.25)";
        ctx.strokeStyle = "#d6ff3f";
        ctx.lineWidth = Math.max(2, c.width / 300);
        ctx.fillRect(box.x * c.width, box.y * c.height, box.width * c.width, box.height * c.height);
        ctx.strokeRect(box.x * c.width, box.y * c.height, box.width * c.width, box.height * c.height);
      }
    }
  }, [draft, props.mode, points, frame]);

  useEffect(() => { setTime(start); }, [start, src]);
  useEffect(() => {
    setTime((current) => Math.max(start, Math.min(current, Math.max(start, end - 1 / 24))));
  }, [start, end]);
  useEffect(() => { if (video.current) video.current.currentTime = time; }, [time, src]);
  useEffect(() => {
    if (props.mode !== "paint") return;
    const c = document.createElement("canvas");
    c.width = mw; c.height = mh;
    const ctx = c.getContext("2d")!;
    const p = props.points.find((p) => p.frame === frame);
    if (p) {
      const image = ctx.createImageData(p.width, p.height);
      for (let i = 0; i < p.runs.length; i += 2) {
        for (let j = p.runs[i]; j < p.runs[i] + p.runs[i + 1]; j++) image.data.set([214, 255, 63, 255], j * 4);
      }
      const stored = document.createElement("canvas");
      stored.width = p.width; stored.height = p.height;
      stored.getContext("2d")!.putImageData(image, 0, 0);
      ctx.drawImage(stored, 0, 0, mw, mh);
    }
    mask.current = c;
    draw();
  }, [props.mode, points, frame, mw, mh, draw]);
  useEffect(draw, [draw, cw, ch]);

  function position(event: PointerEvent<HTMLCanvasElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)) };
  }

  function boxAt(event: PointerEvent<HTMLCanvasElement>): Box | null {
    if (!origin.current) return null;
    const point = position(event);
    return { x: Math.min(point.x, origin.current.x), y: Math.min(point.y, origin.current.y),
      width: Math.abs(point.x - origin.current.x), height: Math.abs(point.y - origin.current.y) };
  }

  function stroke(event: PointerEvent<HTMLCanvasElement>) {
    const c = mask.current;
    if (!origin.current || !c) return;
    const p = position(event), ctx = c.getContext("2d")!;
    ctx.globalCompositeOperation = eraser ? "destination-out" : "source-over";
    ctx.strokeStyle = ctx.fillStyle = "#d6ff3f";
    ctx.lineWidth = brush * mw / cw;
    ctx.lineCap = ctx.lineJoin = "round";
    ctx.beginPath(); ctx.moveTo(origin.current.x * mw, origin.current.y * mh); ctx.lineTo(p.x * mw, p.y * mh); ctx.stroke();
    ctx.beginPath(); ctx.arc(p.x * mw, p.y * mh, ctx.lineWidth / 2, 0, Math.PI * 2); ctx.fill();
    origin.current = p;
    draw();
  }

  function savePaint() {
    if (props.mode !== "paint" || !mask.current) return;
    const data = mask.current.getContext("2d")!.getImageData(0, 0, mw, mh).data;
    const runs: number[] = [];
    for (let i = 0; i < mw * mh;) {
      if (data[i * 4 + 3] < 128) { i++; continue; }
      const start = i++;
      while (i < mw * mh && data[i * 4 + 3] >= 128) i++;
      runs.push(start, i - start);
    }
    const rest = props.points.filter((p) => p.frame !== frame);
    props.onChange((runs.length ? [...rest, { frame, width: mw, height: mh, runs }] : rest).sort((a, b) => a.frame - b.frame));
  }

  function remove(all = false) {
    if (props.mode === "paint") props.onChange(all ? [] : props.points.filter((p) => p.frame !== frame));
    else props.onChange(all ? [] : props.points.filter((p) => p.frame !== frame));
  }

  return (
    <div className="placement">
      <strong>{painting ? "Paint edit area" : "Place the new object"}</strong>
      <p className="hint">{painting ? "Paint extra space around the part SAM tracks. The paint follows its position and size; the tracked area is also edited." : "Drag a box around the whole object's space, including its height above the surface and room for its shadow."}</p>
      {painting && <>
        <div className="segmented">
          <button className={!eraser ? "on" : ""} aria-pressed={!eraser} onClick={() => setEraser(false)}>Brush</button>
          <button className={eraser ? "on" : ""} aria-pressed={eraser} onClick={() => setEraser(true)}>Eraser</button>
        </div>
        <label>Brush size: {brush} px<input type="range" min={4} max={160} step={2} value={brush} onChange={(e) => setBrush(Number(e.target.value))} /></label>
      </>}
      <video ref={video} src={src} preload="auto" muted playsInline hidden
        onLoadedMetadata={() => { if (video.current) video.current.currentTime = time; }} onLoadedData={draw} onSeeked={draw} />
      <canvas ref={canvas} width={cw} height={ch} aria-label={painting ? "Paint the edit area" : "Draw the new object's placement box"} role="img"
        onPointerDown={(event) => {
          event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId);
          origin.current = position(event);
          if (painting) stroke(event);
          else setDraft({ ...origin.current, width: 0, height: 0 });
        }}
        onPointerMove={(event) => { if (painting) stroke(event); else { const box = boxAt(event); if (box) setDraft(box); } }}
        onPointerUp={(event) => {
          if (props.mode === "paint") { stroke(event); savePaint(); }
          else {
            const box = boxAt(event);
            if (box && box.width > 0 && box.height > 0) props.onChange([...props.points.filter((p) => p.frame !== frame), { frame, ...box }].sort((a, b) => a.frame - b.frame));
          }
          origin.current = null; setDraft(null);
        }}
        onPointerCancel={() => { if (painting) savePaint(); origin.current = null; setDraft(null); }} />
      <label>{painting ? "Paint" : "Placement"} frame: {time.toFixed(2)} s
        <input type="range" min={start} max={Math.max(start, end - 1 / 24)} step={1 / 24} value={time}
          onChange={(event) => setTime(Number(event.target.value))} />
      </label>
      <div className="row">
        <button className="secondary" disabled={!points.some((p) => p.frame === frame)} onClick={() => remove()}>Remove this keyframe</button>
        <button className="secondary" disabled={!points.length} onClick={() => remove(true)}>{painting ? "Clear paint" : "Clear placement"}</button>
      </div>
      {points.length > 0 && <div className="placement-keys">{points.map((p) => (
        <button key={p.frame} className={p.frame === frame ? "on" : ""} onClick={() => setTime(Math.max(start, Math.min(end - 1 / 24, p.frame / 24)))}>{(p.frame / 24).toFixed(2)} s</button>
      ))}</div>}
      <p className="hint">{painting ? "Scrub to paint another keyframe. Paint follows SAM during generation and turns off when tracking is lost. This editor shows paint on its painted frames. Changing the tracked part, video, section or resolution clears paint." : "One box stays fixed on screen. If the camera moves, scrub forward and draw more boxes; placement moves between them. This is manual placement, not automatic tracking. Changing the video, section or resolution clears the boxes."}</p>
    </div>
  );
}
