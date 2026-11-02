import assert from "node:assert/strict";
import test from "node:test";
import { mountPlacement } from "./object-placement-dom.ts";

test("a second touch cannot complete or replace the active placement gesture", async () => {
  const app = await mountPlacement({ src: "blob:source", start: 0, end: 10, width: 640, height: 360, points: [] });
  try {
    await app.pointer("pointerdown", 1, 64, 36);
    await app.pointer("pointerdown", 2, 320, 180);
    await app.pointer("pointermove", 2, 500, 250);
    await app.pointer("pointerup", 2, 600, 300);
    assert.equal(app.changes.length, 0, "only the pointer that started the box may commit it");
    await app.pointer("pointermove", 1, 192, 144);
    await app.pointer("pointerup", 1, 192, 144);
    assert.equal(app.changes.length, 1);
    const point = app.changes[0][0];
    assert.ok("x" in point);
    assert.deepEqual([point.frame, point.x, point.y], [0, 0.1, 0.1]);
    assert.ok(Math.abs(point.width - 0.2) < 1e-8);
    assert.ok(Math.abs(point.height - 0.3) < 1e-8);
  } finally { await app.close(); }
});

test("cancelling another touch does not discard the active placement gesture", async () => {
  const app = await mountPlacement({ src: "blob:source", start: 0, end: 10, width: 640, height: 360, points: [] });
  try {
    await app.pointer("pointerdown", 1, 64, 36);
    await app.pointer("pointercancel", 2, 320, 180);
    await app.pointer("pointerup", 1, 192, 144);
    assert.equal(app.changes.length, 1);
    const point = app.changes[0][0];
    assert.ok("x" in point);
    assert.equal(point.x, 0.1);
  } finally { await app.close(); }
});

test("cancelling the owning pointer discards an unfinished box", async () => {
  const app = await mountPlacement({ src: "blob:source", start: 0, end: 10, width: 640, height: 360, points: [] });
  try {
    await app.pointer("pointerdown", 1, 64, 36);
    await app.pointer("pointercancel", 1, 100, 100);
    await app.pointer("pointerup", 1, 192, 144);
    assert.equal(app.changes.length, 0);
  } finally { await app.close(); }
});
