"use client";

import { useCallback, useEffect, useRef, useState, type PointerEvent } from "react";
import { placementAt, type PlacementKeyframe } from "../lib/object.ts";

type Box = Omit<PlacementKeyframe, "frame">;

export function ObjectPlacement({ src, start, end, width, height, points, onChange }: {
  src: string; start: number; end: number; width: number; height: number;
  points: PlacementKeyframe[]; onChange: (points: PlacementKeyframe[]) => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const origin = useRef<{ x: number; y: number } | null>(null);
  const [time, setTime] = useState(start);
  const [draft, setDraft] = useState<Box | null>(null);
  const frame = Math.round(time * 24);
  const scale = Math.min(1, 1024 / Math.max(width, height));
  const cw = Math.max(1, Math.round(width * scale));
  const ch = Math.max(1, Math.round(height * scale));

  const draw = useCallback(() => {
    const v = video.current;
    const c = canvas.current;
    if (!v || !c || v.readyState < 2) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    const cover = Math.max(c.width / v.videoWidth, c.height / v.videoHeight);
    const sw = c.width / cover, sh = c.height / cover;
    ctx.drawImage(v, (v.videoWidth - sw) / 2, (v.videoHeight - sh) / 2, sw, sh, 0, 0, c.width, c.height);
    const box = draft ?? placementAt(points, frame);
    if (box) {
      ctx.fillStyle = "rgba(214, 255, 63, 0.25)";
      ctx.strokeStyle = "#d6ff3f";
      ctx.lineWidth = Math.max(2, c.width / 300);
      ctx.fillRect(box.x * c.width, box.y * c.height, box.width * c.width, box.height * c.height);
      ctx.strokeRect(box.x * c.width, box.y * c.height, box.width * c.width, box.height * c.height);
    }
  }, [draft, points, frame]);

  useEffect(() => { setTime(start); }, [start, src]);
  useEffect(() => {
    if (video.current) video.current.currentTime = time;
  }, [time, src]);
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

  return (
    <div className="placement">
      <strong>Place the new object</strong>
      <p className="hint">Drag a box around the whole object&apos;s space, including its height above the surface and room for its shadow.</p>
      <video ref={video} src={src} preload="auto" muted playsInline hidden
        onLoadedMetadata={() => { if (video.current) video.current.currentTime = time; }} onLoadedData={draw} onSeeked={draw} />
      <canvas ref={canvas} width={cw} height={ch} aria-label="Draw the new object's placement box" role="img"
        onPointerDown={(event) => {
          event.preventDefault();
          event.currentTarget.setPointerCapture(event.pointerId);
          origin.current = position(event);
          setDraft({ ...origin.current, width: 0, height: 0 });
        }}
        onPointerMove={(event) => { const box = boxAt(event); if (box) setDraft(box); }}
        onPointerUp={(event) => {
          const box = boxAt(event);
          origin.current = null;
          setDraft(null);
          if (box && box.width > 0 && box.height > 0) onChange([...points.filter((p) => p.frame !== frame), { frame, ...box }].sort((a, b) => a.frame - b.frame));
        }}
        onPointerCancel={() => { origin.current = null; setDraft(null); }} />
      <label>Placement frame: {time.toFixed(2)} s
        <input type="range" min={start} max={Math.max(start, end - 1 / 24)} step={1 / 24} value={time}
          onChange={(event) => setTime(Number(event.target.value))} />
      </label>
      <div className="row">
        <button className="secondary" disabled={!points.some((p) => p.frame === frame)} onClick={() => onChange(points.filter((p) => p.frame !== frame))}>Remove this keyframe</button>
        <button className="secondary" disabled={!points.length} onClick={() => onChange([])}>Clear placement</button>
      </div>
      {points.length > 0 && <div className="placement-keys">{points.map((p) => (
        <button key={p.frame} className={p.frame === frame ? "on" : ""} onClick={() => setTime(Math.max(start, Math.min(end - 1 / 24, p.frame / 24)))}>{(p.frame / 24).toFixed(2)} s</button>
      ))}</div>}
      <p className="hint">One box stays fixed on screen. If the camera moves, scrub forward and draw more boxes; placement moves between them. This is manual placement, not automatic tracking. Changing the video, section or resolution clears the boxes.</p>
    </div>
  );
}
