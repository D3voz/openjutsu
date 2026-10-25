// Estimates the clip plan of the H3OneClickSwapPlan node (clip_plan() in comfyui-h3-oneclick-swap), so the page can
// show about how many clips a run takes and where they start. It is exact for a video without hard cuts. The pack also
// ends a clip on a nearby hard cut and starts the next one without overlap; the page cannot see the cuts before a
// run, so for a video with cuts the real count and boundaries can differ.
const FPS = 24;
const OVERLAP = 39;

const gridFloor = (frames: number) => Math.floor((frames - 5) / 17) * 17 + 5;

// [length, context] per clip: each clip is the longest that fits and repeats the previous clip's last frames.
function clipPlan(durationSeconds: number, clipSeconds: number) {
  const total = Math.floor(durationSeconds * FPS);
  const longest = gridFloor(Math.floor(clipSeconds * FPS));
  if (!Number.isFinite(total) || total < 5 || !Number.isFinite(longest) || longest <= OVERLAP) return [];
  const clips: [number, number][] = [];
  let end = 0;
  let context = 0;
  while (true) {
    const start = end - context;
    const length = gridFloor(Math.min(longest, total - start));
    if (clips.length && length - context < 17) return clips;
    clips.push([length, context]);
    end = start + length;
    context = Math.min(OVERLAP, gridFloor(length - context));
  }
}

export function clipCount(durationSeconds: number, clipSeconds: number) {
  return clipPlan(durationSeconds, clipSeconds).length;
}

// First source frame of each clip (clips after the first start on the frames they repeat).
export function clipStarts(durationSeconds: number, clipSeconds: number) {
  const starts: number[] = [];
  let end = 0;
  for (const [length, context] of clipPlan(durationSeconds, clipSeconds)) {
    starts.push(end - context);
    end = starts.at(-1)! + length;
  }
  return starts.length ? starts : [0];
}
