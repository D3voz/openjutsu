import assert from "node:assert/strict";
import test from "node:test";
import { act } from "react";
import { mountFromPicture } from "./from-picture-dom.ts";
const STORAGE = "openjutsu.picture-preview";
const ready = { status: "ready", url: "/prepared.png", frame: "/frame.png", width: 1376, height: 768 };
for (const stage of ["poll", "prepare", "render"] as const) test(`late ${stage} JSON cannot overwrite newer saved state after leaving From picture`, async () => {
  let resolve!: (value: unknown) => void;
  const pending = new Promise((done) => { resolve = done; });
  let awaitingBody = false;
  const app = await mountFromPicture({
    storage: stage === "poll" ? { [STORAGE]: { job: { id: "old", stage: "prepare" }, prepared: "", approved: false } }
      : stage === "render" ? { [STORAGE]: { job: null, prepared: "prepared", approved: true } } : {},
    fetch: async (input, init) => {
      if (String(input) === "/api/models") return Response.json({ models: [], loras: [], textEncoders: [], vaes: [] });
      if (stage !== "poll" && !init?.method) return Response.json(ready);
      return { ok: true, status: 200, json: () => { awaitingBody = true; return pending; } } as Response;
    },
  });
  try {
    if (stage === "prepare") {
      await app.chooseFile("video", "source.mp4"); await app.metadata(); await app.chooseFile("picture", "character.png");
      await app.click("Generate preview image");
    } else if (stage === "render") await app.click("Render video");
    assert.ok(awaitingBody, "the response headers arrived but JSON is still pending");
    await app.unmount();
    const newer = JSON.stringify({ job: { id: "newer", stage: "prepare" }, prepared: "", approved: false });
    app.dom.window.localStorage.setItem(STORAGE, newer);
    await act(async () => { resolve(stage === "poll" ? ready : { id: "stale" }); await pending; });
    assert.equal(app.dom.window.localStorage.getItem(STORAGE), newer);
  } finally { await app.close(); }
});

test("the current mounted preparation, approval and render still persist their own results", async () => {
  let submissions = 0;
  const app = await mountFromPicture({ fetch: async (input, init) => {
    if (String(input) === "/api/models") return Response.json({ models: [], loras: [], textEncoders: [], vaes: [] });
    if (init?.method === "POST") return Response.json({ id: ++submissions === 1 ? "current-prepared" : "current-render" });
    return Response.json(String(input).includes("current-render") ? { status: "ready", url: "/result.mp4" } : ready);
  } });
  try {
    await app.chooseFile("video", "source.mp4"); await app.metadata(); await app.chooseFile("picture", "character.png");
    await app.click("Generate preview image");
    assert.ok([...app.container.querySelectorAll("button")].some((button) => button.textContent === "Use this image"));
    assert.equal(JSON.parse(app.dom.window.localStorage.getItem(STORAGE)!).prepared, "current-prepared");
    await app.click("Use this image"); await app.click("Render video");
    assert.ok(app.container.querySelector('video[src="/result.mp4"]'));
    assert.equal(JSON.parse(app.dom.window.localStorage.getItem(STORAGE)!).job.id, "current-render");
  } finally { await app.close(); }
});
