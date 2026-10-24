// Mirrors clip_lengths() in the H3OneClickSwapPlan node, so the page can show "clip k of N".
const FPS = 24;
const OVERLAP = 39;

const gridFloor = (frames: number) => Math.floor((frames - 5) / 17) * 17 + 5;
const gridCeil = (frames: number) => Math.ceil((frames - 5) / 17) * 17 + 5;

function clipLengths(durationSeconds: number, clipSeconds: number) {
  const total = Math.floor(durationSeconds * FPS);
  const clipFrames = Math.floor(clipSeconds * FPS);
  if (!Number.isFinite(total) || total < 5 || !Number.isFinite(clipFrames) || gridFloor(clipFrames) <= OVERLAP) return [];
  const lengths = [Math.min(gridFloor(clipFrames), gridFloor(total))];
  let rem = total - lengths[0];
  const count = rem >= 17 ? Math.ceil(rem / (gridFloor(clipFrames) - OVERLAP)) : 0;
  for (let j = 0; j < count; j++) {
    const length = Math.min(gridCeil(Math.ceil(rem / (count - j)) + OVERLAP), gridFloor(rem + OVERLAP));
    if (length - OVERLAP < 17) break;
    lengths.push(length);
    rem -= length - OVERLAP;
  }
  return lengths;
}

export function clipCount(durationSeconds: number, clipSeconds: number) {
  return clipLengths(durationSeconds, clipSeconds).length;
}

// First source frame of each clip (clips after the first start OVERLAP frames early).
export function clipStarts(durationSeconds: number, clipSeconds: number) {
  const starts = [0];
  for (const length of clipLengths(durationSeconds, clipSeconds).slice(0, -1)) starts.push(starts.at(-1)! + length - OVERLAP);
  return starts;
}
