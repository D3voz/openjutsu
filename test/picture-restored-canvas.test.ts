import assert from "node:assert/strict";
import test from "node:test";
import { act } from "react";
import { mountFromPicture } from "./from-picture-dom.ts";
const STORAGE = "openjutsu.picture-preview";
const storage = { [STORAGE]: { job: { id: "render-saved", stage: "render" }, prepared: "prepared-saved", approved: true } };
const models = { models: [], loras: [], textEncoders: [], vaes: [] };
const source = { status: "ready", url: "/prepared.png", frame: "/frame.png", width: 1376, height: 768 };

test("a restored landscape render seeds Custom resolution from the prepared source", async () => {
  let submitted: { settings: { resolution: unknown } } | undefined;
  const app = await mountFromPicture({ storage, fetch: async (input, init) => {
    if (String(input) === "/api/models") return Response.json(models);
    if (init?.method === "POST") { submitted = JSON.parse(String(init.body)); return Response.json({ id: "render-new" }); }
    return Response.json(String(input).includes("prepared-saved") ? source : { status: "ready", url: "/result.mp4" });
  } });
  try {
    assert.match(app.container.textContent!, /Video canvas: 864×480/);
    const select = [...app.container.querySelectorAll("label")].find((label) => label.textContent?.startsWith("Video resolution"))!.querySelector("select")!;
    await act(async () => { select.value = "custom"; select.dispatchEvent(new app.dom.window.Event("change", { bubbles: true })); });
    await app.click("Render video");
    assert.deepEqual(submitted?.settings.resolution, { width: 864, height: 480 });
  } finally { await app.close(); }
});

test("late restored dimensions cannot replace a newly selected video's dimensions", async () => {
  let resolve!: (value: unknown) => void;
  const pending = new Promise((done) => { resolve = done; });
  let dimensions: string[] = [];
  const app = await mountFromPicture({ storage, fetch: async (input, init) => {
    if (String(input) === "/api/models") return Response.json(models);
    if (init?.method === "POST") {
      const form = init.body as FormData; dimensions = [String(form.get("width")), String(form.get("height"))];
      return Response.json({ id: "fresh-prepare" });
    }
    if (String(input).includes("prepared-saved")) return { ok: true, json: () => pending } as Response;
    return Response.json({ status: "ready", url: "/result.mp4" });
  } });
  try {
    await app.click("Back to image review");
    await app.chooseFile("video", "portrait.mp4"); await app.metadata(720, 1280); await app.chooseFile("picture", "character.png");
    await act(async () => { resolve(source); await pending; });
    await app.click("Generate preview image");
    assert.deepEqual(dimensions, ["720", "1280"]);
  } finally { await app.close(); }
});

test("Custom is unavailable until restored source dimensions are known", async () => {
  let resolve!: (value: unknown) => void;
  const pending = new Promise((done) => { resolve = done; });
  const app = await mountFromPicture({ storage, fetch: async (input) => {
    if (String(input) === "/api/models") return Response.json(models);
    if (String(input).includes("prepared-saved")) return { ok: true, json: () => pending } as Response;
    return Response.json({ status: "ready", url: "/result.mp4" });
  } });
  try {
    const option = app.container.querySelector<HTMLOptionElement>('option[value="custom"]')!;
    assert.equal(option.disabled, true);
    assert.match(app.container.textContent!, /Restoring source dimensions/);
    await act(async () => { resolve(source); await pending; });
    assert.equal(app.container.querySelector<HTMLOptionElement>('option[value="custom"]')!.disabled, false);
  } finally { await app.close(); }
});
