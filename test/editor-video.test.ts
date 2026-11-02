import assert from "node:assert/strict";
import test from "node:test";
import { mountEditor } from "./editor-dom.ts";

test("a replaced video's late metadata cannot reset the current video's section", async () => {
  const editor = await mountEditor();
  try {
    const old = await editor.chooseVideo("old.mp4");
    const current = await editor.chooseVideo("current.mp4");
    await editor.metadata(current, 20);
    await editor.metadata(old, 90);
    assert.match(editor.container.textContent!, /current\.mp4 · 20\.0 s/);
    assert.doesNotMatch(editor.container.textContent!, /90\.0 s/);
    assert.match(editor.container.textContent!, /0:00\.0–0:20\.0 \(20\.0 s\)/);
  } finally { await editor.close(); }
});
