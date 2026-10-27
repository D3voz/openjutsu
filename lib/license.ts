// License-gated modes. The app source is MIT, but the optional models are not:
// Fix faces uses InsightFace buffalo_l (non-commercial research) + Ultralytics YOLO (AGPL-3.0);
// From picture uses FLUX 3 Klein (non-commercial). Keep both off unless the owner enables them.
export const KAFEIN_RESEARCH_MODES = process.env.NEXT_PUBLIC_KAFEIN_RESEARCH_MODES === "1";
export function researchModesEnabled() {
  return process.env.KAFEIN_RESEARCH_MODES === "1";
}
