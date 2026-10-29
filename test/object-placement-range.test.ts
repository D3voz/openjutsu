import assert from "node:assert/strict";
import test from "node:test";
import { mountPlacement } from "./object-placement-dom.ts";

const box = { frame: 8 * 24, x: 0.1, y: 0.1, width: 0.2, height: 0.3 };
test("shortening the section clamps the placement frame before the next drag", async () => {
  const app = await mountPlacement({ src: "blob:source", start: 0, end: 10, width: 640, height: 360, points: [box] });
  try {
    await app.click("8.00 s");
    assert.equal(app.video.currentTime, 8);
    await app.update({ end: 4, points: [] });
    const previewTime = app.video.currentTime;
    await app.pointer("pointerdown", 1, 64, 36);
    await app.pointer("pointerup", 1, 192, 144);
    assert.equal(app.changes.length, 1);
    assert.equal(app.changes[0][0].frame, 95);
    assert.ok(previewTime < 4, "preview must stay in the shortened section");
  } finally { await app.close(); }
});

test("shortening the section preserves a selected placement frame that still fits", async () => {
  const app = await mountPlacement({ src: "blob:source", start: 0, end: 10, width: 640, height: 360,
    points: [{ ...box, frame: 2 * 24 }] });
  try {
    await app.click("2.00 s");
    await app.update({ end: 4, points: [] });
    assert.equal(app.video.currentTime, 2);
    await app.pointer("pointerdown", 1, 64, 36);
    await app.pointer("pointerup", 1, 192, 144);
    assert.equal(app.changes[0][0].frame, 48);
  } finally { await app.close(); }
});
