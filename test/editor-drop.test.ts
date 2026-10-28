import assert from "node:assert/strict";
import test from "node:test";
import { act } from "react";
import { mountEditor } from "./editor-dom.ts";

for (const [kind, name] of [
  ["video", "clip.mp4"], ["video", "clip.webm"], ["video", "clip.mkv"], ["video", "clip.mov"], ["video", "clip.avi"],
  ["image", "reference.PNG"], ["image", "reference.jpg"], ["image", "reference.jpeg"], ["image", "reference.webp"],
] as const) test(`a supported ${name} can be dropped when its MIME type is empty`, async () => {
  const editor = await mountEditor();
  try {
    const target = editor.container.querySelector(kind === "video" ? "label.drop.big" : "label.drop.add")!;
    const event = new editor.dom.window.Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "dataTransfer", { value: { files: [new editor.dom.window.File(["fixture"], name, { type: "" })] } });
    await act(async () => target.dispatchEvent(event));
    if (kind === "video") assert.ok(editor.container.querySelector(".video-pick"), "source accepted");
    else assert.ok(editor.container.querySelector('.character img[alt="Character 1"]'), "character accepted");
  } finally { await editor.close(); }
});

for (const kind of ["video", "image"] as const) test(`unknown empty-MIME ${kind} files are still ignored`, async () => {
  const editor = await mountEditor();
  try {
    const target = editor.container.querySelector(kind === "video" ? "label.drop.big" : "label.drop.add")!;
    const event = new editor.dom.window.Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "dataTransfer", { value: { files: [new editor.dom.window.File(["fixture"], "notes.txt")] } });
    await act(async () => target.dispatchEvent(event));
    assert.equal(editor.container.querySelector(kind === "video" ? ".video-pick" : ".character"), null);
  } finally { await editor.close(); }
});
