import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { act } from "react";
import { setupGraph, type SetupRequest } from "../lib/setup.ts";
import type { ApiGraph } from "../lib/simple.ts";
import { mountEditor } from "./editor-dom.ts";

for (const moving of [false, true]) test(`Add preflight checks the actual ${moving ? "copied-routine" : "static-placement"} graph before uploading`, async () => {
  let checked: ApiGraph | null = null;
  const editor = await mountEditor({
    storage: { "openjutsu.settings": { mode: "object", editMode: "add", editTarget: "on the table" } },
    fetch: async (input, init) => {
      if (String(input) === "/api/setup") {
        const selected = JSON.parse(init!.body as string) as SetupRequest;
        const source = JSON.parse(readFileSync(new URL("../workflows/object.api.json", import.meta.url), "utf8"));
        checked = setupGraph(source, selected);
        return Response.json({ ok: false, packs: [], models: [], error: "Stop before uploading" });
      }
      assert.notEqual(String(input), "/api/jobs", "preflight must stop an unavailable graph before upload");
      return Response.json(String(input).includes("presets") ? { tone: [] } : { models: [], loras: [], textEncoders: [], vaes: [] });
    },
  });
  try {
    await editor.metadata(await editor.chooseVideo("clip.mp4"), 20);
    const change = async (selector: string, value: string) => {
      const input = editor.container.querySelector<HTMLInputElement>(selector)!;
      assert.ok(input, selector);
      await act(async () => {
        Object.getOwnPropertyDescriptor(editor.dom.window.HTMLInputElement.prototype, "value")!.set!.call(input, value);
        input.dispatchEvent(new editor.dom.window.Event("input", { bubbles: true }));
      });
    };
    await change('input[placeholder="e.g. a chocolate cake on a plate"]', "a dancer");
    if (moving) await change('input[placeholder^="e.g. she dances"]', "she dances the same routine in sync with the others");
    const canvas = editor.container.querySelector("canvas")!;
    canvas.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, right: 640, bottom: 360, width: 640, height: 360, toJSON() {} });
    canvas.setPointerCapture = () => {};
    for (const [type, x, y] of [["pointerdown", 64, 36], ["pointerup", 256, 252]] as const) {
      await act(async () => {
        const event = new editor.dom.window.MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y });
        Object.defineProperty(event, "pointerId", { value: 1 });
        canvas.dispatchEvent(event);
      });
    }
    const generate = [...editor.container.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.trim() === "Generate")!;
    assert.equal(generate.disabled, false, "the real input controls are ready");
    await act(async () => generate.click());
    assert.ok(checked);
    const types = Object.values(checked as ApiGraph).map((node) => node.class_type);
    assert.equal(types.includes("H3AddMovingArea"), moving);
    assert.equal(types.includes("H3ObjectPlacementMask"), !moving);
  } finally { await editor.close(); }
});
