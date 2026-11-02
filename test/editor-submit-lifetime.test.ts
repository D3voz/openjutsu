import assert from "node:assert/strict";
import test from "node:test";
import { act } from "react";
import { mountEditor } from "./editor-dom.ts";

for (const stage of ["setup", "jobs"]) for (const unmount of [false, true]) test(`${unmount ? "unmounted editor ignores" : "mounted editor accepts"} delayed ${stage} JSON`, async () => {
  let release!: (value: unknown) => void;
  const pending = new Promise((resolve) => { release = resolve; });
  let reached = false, uploads = 0;
  const editor = await mountEditor({fetch: async (input) => {
    const url = String(input);
    if (url === "/api/jobs") uploads++;
    if (url === `/api/${stage}`) { reached = true; return {ok: true, json: () => pending} as Response; }
    if (url === "/api/setup") return Response.json({ok: true});
    if (url === "/api/jobs") return Response.json({id: "stale-job", status: "queued"});
    return Response.json(url.includes("presets") ? {tone: []} : {models: [], loras: [], textEncoders: [], vaes: []});
  }});
  try {
    await editor.metadata(await editor.chooseVideo("clip.mp4"), 20);
    const input = editor.container.querySelector<HTMLInputElement>('input[accept="image/*"]')!;
    Object.defineProperty(input, "files", {configurable: true, value: [new editor.dom.window.File(["photo"], "person.png", {type: "image/png"})]});
    await act(async () => input.dispatchEvent(new editor.dom.window.Event("change", {bubbles: true})));
    const generate = [...editor.container.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.trim() === "Generate")!;
    assert.equal(generate.disabled, false);
    await act(async () => generate.click());
    assert.equal(reached, true);
    if (unmount) await editor.unmount();
    const newer = JSON.stringify({id: "newer-job", kind: "simple"});
    editor.dom.window.localStorage.setItem("openjutsu.run", newer);
    await act(async () => { release(stage === "setup" ? {ok: true} : {id: "stale-job", status: "queued"}); await pending; });
    if (unmount) assert.equal(editor.dom.window.localStorage.getItem("openjutsu.run"), newer, "new editor's saved run survives");
    else assert.equal(JSON.parse(editor.dom.window.localStorage.getItem("openjutsu.run")!).id, "stale-job", "active submission is saved");
    assert.equal(uploads, unmount && stage === "setup" ? 0 : 1, "only active preflight starts an upload");
  } finally { await editor.close(); }
});
