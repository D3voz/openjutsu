// Mirrors clip_lengths() in the H3OneClickSwapPlan node, so the page can show "clip k of N".
const FPS = 24;
const OVERLAP = 39;

const gridFloor = (frames: number) => Math.floor((frames - 5) / 17) * 17 + 5;
const gridCeil = (frames: number) => Math.ceil((frames - 5) / 17) * 17 + 5;

export function clipCount(durationSeconds: number, clipSeconds: number) {
  const total = Math.floor(durationSeconds * FPS);
  const clipFrames = Math.floor(clipSeconds * FPS);
  let rem = total - Math.min(gridFloor(clipFrames), gridFloor(total));
  const count = rem >= 17 ? Math.ceil(rem / (gridFloor(clipFrames) - OVERLAP)) : 0;
  let clips = 1;
  for (let j = 0; j < count; j++) {
    const length = Math.min(gridCeil(Math.ceil(rem / (count - j)) + OVERLAP), gridFloor(rem + OVERLAP));
    if (length - OVERLAP < 17) break;
    clips++;
    rem -= length - OVERLAP;
  }
  return clips;
}
