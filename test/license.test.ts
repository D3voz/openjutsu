import assert from "node:assert/strict";
import test from "node:test";
import { researchModesEnabled } from "../lib/license.ts";

test("research-only modes are off unless explicitly enabled", () => {
  const previous = process.env.KAFEIN_RESEARCH_MODES;
  delete process.env.KAFEIN_RESEARCH_MODES;
  assert.equal(researchModesEnabled(), false);
  process.env.KAFEIN_RESEARCH_MODES = "1";
  assert.equal(researchModesEnabled(), true);
  if (previous === undefined) delete process.env.KAFEIN_RESEARCH_MODES;
  else process.env.KAFEIN_RESEARCH_MODES = previous;
});
