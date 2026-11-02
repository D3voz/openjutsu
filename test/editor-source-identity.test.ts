import assert from "node:assert/strict";
import test from "node:test";
import { act } from "react";
import { mountEditor } from "./editor-dom.ts";

for (const replace of [false, true]) test(`Find people ${replace ? "cannot reuse tracks for a different same-name/same-size source" : "can reuse tracks while the selected source is unchanged"}`, async () => {
  const job = { id: "11111111-1111-4111-8111-111111111111", status: "succeeded", data: "/people-result" };
  const editor = await mountEditor({
    storage: { "openjutsu.settings": { mode: "advanced", montage: true } },
    fetch: async (input, init) => {
      const url = String(input);
      if (url === "/api/setup") return Response.json({ ok: true, packs: [], models: [] });
      if (url === "/api/jobs") {
        assert.equal((init!.body as FormData).get("role"), "the dancer - red shirt");
        return Response.json(job, { status: 202 });
      }
      if (url === "/people-result") return Response.json({ frames: 480, tracks: "h3_montage_people_1_.npz", people: [{ track: 1, start: 0, end: 480, role: 1, on: [[0, 480]], area: 0.4, pick: 1, image: "/person.jpg" }] });
      return Response.json(url.includes("presets") ? { tone: [] } : { models: [], loras: [], textEncoders: [], vaes: [] });
    },
  });
  try {
    await editor.metadata(await editor.chooseVideo("clip.mp4", "first!!"), 20);
    const photo = editor.container.querySelector<HTMLInputElement>('input[type="file"][accept="image/*"]')!;
    Object.defineProperty(photo, "files", { configurable: true, value: [new editor.dom.window.File(["photo"], "person.png", { type: "image/png" })] });
    await act(async () => photo.dispatchEvent(new editor.dom.window.Event("change", { bubbles: true })));
    const role = editor.container.querySelector<HTMLInputElement>('input[maxlength="200"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(editor.dom.window.HTMLInputElement.prototype, "value")!.set!.call(role, "the dancer - red shirt");
      role.dispatchEvent(new editor.dom.window.Event("input", { bubbles: true }));
    });
    const click = async (label: string) => {
      const button = [...editor.container.querySelectorAll("button")].find((button) => button.textContent?.trim() === label)!;
      assert.ok(button, label);
      await act(async () => button.click());
    };
    await click("Find people");
    await click("Back to settings");
    if (replace) await editor.metadata(await editor.chooseVideo("clip.mp4", "second!"), 20);
    const past = [...editor.container.querySelectorAll<HTMLButtonElement>(".history button")].find((button) => button.textContent?.includes("Find people"))!;
    assert.ok(past);
    await act(async () => past.click());
    await act(async () => editor.sources.at(-1)!.onmessage!({ data: JSON.stringify({ type: "job", job }) }));
    const generate = [...editor.container.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.trim() === "Generate")!;
    assert.ok(generate);
    assert.equal(generate.disabled, replace);
  } finally { await editor.close(); }
});
