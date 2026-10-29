import assert from "node:assert/strict";
import test from "node:test";
import { act } from "react";
import { mountEditor } from "./editor-dom.ts";

const id = "11111111-1111-4111-8111-111111111111";

async function resultEditor() {
  let finish!: (blob: Blob) => void;
  let fail!: (error: Error) => void;
  let signal: AbortSignal | undefined;
  const editor = await mountEditor({
    storage: { "openjutsu.run": { id, kind: "simple", margin: "normal", clips: 1, clipSeconds: 6, startedAt: Date.now(), frames: "original" } },
    fetch: async (url, init) => {
      if (String(url) === "/result.mp4") {
        signal = init?.signal as AbortSignal | undefined;
        const response = new Response(null, { headers: { "Content-Type": "video/mp4" } });
        Object.defineProperty(response, "blob", { value: () => new Promise<Blob>((resolve, reject) => { finish = resolve; fail = reject; }) });
        return response;
      }
      return Response.json(String(url).includes("presets") ? { tone: [] } : { models: [], loras: [], textEncoders: [], vaes: [] });
    },
  });
  const click = async (label: string) => {
    const button = [...editor.container.querySelectorAll("button")].find((button) => button.textContent === label)!;
    assert.ok(button, label);
    await act(async () => button.click());
  };
  await act(async () => editor.sources[0].onmessage!({ data: JSON.stringify({ type: "job", job: { id, status: "succeeded", video: { id: "video", name: "finished.mp4", url: "/result.mp4" } } }) }));
  await click("Fix faces");
  assert.ok(finish, "download has reached its body");
  return { ...editor, click, finish: () => finish(new Blob(["video fixture"], { type: "video/mp4" })), fail: () => fail(new Error("Connection lost")), signal: () => signal };
}

test("an abandoned post-processing download cannot replace the newly selected video", async () => {
  const editor = await resultEditor();
  try {
    await editor.click("New swap");
    await editor.metadata(await editor.chooseVideo("new.mp4"), 20);
    await act(async () => editor.finish());
    assert.match(editor.container.textContent!, /new\.mp4/);
    assert.doesNotMatch(editor.container.textContent!, /finished\.mp4/);
    const active = editor.container.querySelector('.mode.active strong');
    assert.equal(active?.textContent, "Simple motion transfer");
  } finally { await editor.close(); }
});

test("leaving the result view aborts its download without showing an old failure", async () => {
  const editor = await resultEditor();
  try {
    await editor.click("New swap");
    await act(async () => editor.fail());
    assert.equal(editor.signal()?.aborted, true);
    assert.equal(editor.container.querySelector('[role="alert"]'), null);
  } finally { await editor.close(); }
});

test("an active post-processing download still opens the requested tool", async () => {
  const editor = await resultEditor();
  try {
    await act(async () => editor.finish());
    assert.match(editor.container.textContent!, /finished\.mp4/);
    assert.equal(editor.container.querySelector('.mode.active strong')?.textContent, "Post-processing");
  } finally { await editor.close(); }
});
