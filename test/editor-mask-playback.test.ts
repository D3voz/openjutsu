import assert from "node:assert/strict";
import test from "node:test";
import { act } from "react";
import { mountEditor } from "./editor-dom.ts";

test("mask playback reports rejected play and recovers on retry", async () => {
  const id = "11111111-1111-4111-8111-111111111111";
  const editor = await mountEditor({storage: {"openjutsu.run": {id, kind: "mask", margin: "normal", clips: 1, clipSeconds: 6, startedAt: 1, frames: ""}}});
  try {
    await act(async () => editor.sources.at(-1)!.onmessage!({data: JSON.stringify({type: "job", job: {id, status: "succeeded", video: {url: "/mask.mp4", name: "mask.mp4"}}})}));
    const video = editor.container.querySelector<HTMLVideoElement>(".mask-check video")!;
    assert.ok(video);
    const rejected = Promise.reject(new Error("The media could not be played."));
    void rejected.catch(() => {}); // Keep the baseline rejection from obscuring the visible-state assertion.
    video.play = () => rejected;
    const toggle = () => [...editor.container.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.trim() === "Play" || b.textContent?.trim() === "Pause")!;
    await act(async () => toggle().click());
    assert.equal(toggle().textContent, "Play", "failed play must remain retryable");
    assert.match(editor.container.textContent!, /could not.*play/i);
    video.play = async () => { video.dispatchEvent(new editor.dom.window.Event("play")); };
    video.pause = () => { video.dispatchEvent(new editor.dom.window.Event("pause")); };
    await act(async () => toggle().click());
    assert.equal(toggle().textContent, "Pause");
    await act(async () => toggle().click());
    assert.equal(toggle().textContent, "Play");
    assert.doesNotMatch(editor.container.textContent!, /could not.*play/i);
    let rejectOld!: (reason: Error) => void;
    video.play = () => new Promise<void>((_resolve, reject) => { rejectOld = reject; });
    await act(async () => toggle().click());
    assert.equal(toggle().textContent, "Play", "pending play does not claim playback started");
    video.play = async () => { video.dispatchEvent(new editor.dom.window.Event("play")); };
    await act(async () => toggle().click());
    await act(async () => rejectOld(new Error("obsolete attempt")));
    assert.equal(toggle().textContent, "Pause", "old rejection cannot replace the newer successful play");
    assert.doesNotMatch(editor.container.textContent!, /could not.*play/i);
  } finally { await editor.close(); }
});
