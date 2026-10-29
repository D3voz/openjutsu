import assert from "node:assert/strict";
import test from "node:test";
import { act } from "react";
import { mountEditor } from "./editor-dom.ts";

const id = "11111111-1111-4111-8111-111111111111";
const people = { frames: 24, tracks: "h3_montage_people_1_.npz", people: [{ track: 1, start: 0, end: 24, role: 1, on: [[0, 24]], area: 0.5, pick: 1, image: "/person.png" }] };
const fit = { frames: 24, person: true, outside: [], needed: null };
const montage = { kept: [{ photo: 1, start: 0, end: 24, small: true }] };

for (const kind of ["people", "fit", "montage"] as const) for (const failed of [false, true]) {
  test(`${kind} metadata ${failed ? "reports an HTTP failure without treating it as result data" : "retains its successful result"}`, async () => {
    const editor = await mountEditor({
      storage: { "openjutsu.run": { id, kind, margin: "normal", clips: 1, clipSeconds: 6, startedAt: Date.now(), frames: "source" } },
      fetch: async (url) => {
        if (String(url) === "/result-data") return Response.json(failed ? { error: "backend unavailable" } : { people, fit, montage }[kind], { status: failed ? 503 : 200 });
        return Response.json(String(url).includes("presets") ? { tone: [] } : { models: [], loras: [], textEncoders: [], vaes: [] });
      },
    });
    try {
      await act(async () => editor.sources[0].onmessage!({ data: JSON.stringify({ type: "job", job: { id, status: "succeeded", data: "/result-data", video: { id: "video", name: "result.mp4", url: "/result.mp4" } } }) }));
      if (failed) {
        assert.ok(editor.container.querySelector('[role="alert"]'), "metadata failure is visible rather than a crash, a spinner, or a false empty result");
        assert.doesNotMatch(editor.container.textContent!, /No one to copy was found/);
      } else {
        assert.equal(editor.container.querySelector('[role="alert"]'), null);
        assert.match(editor.container.textContent!, kind === "people" ? /1 appearance/ : kind === "fit" ? /whole routine fits/ : /Left as they are/);
      }
    } finally { await editor.close(); }
  });
}

for (const kind of ["people", "fit", "montage"] as const) test(`${kind} releases its pending metadata request on Back`, async () => {
  let signal: AbortSignal | undefined;
  const editor = await mountEditor({
    storage: { "openjutsu.run": { id, kind, margin: "normal", clips: 1, clipSeconds: 6, startedAt: Date.now(), frames: "source" } },
    fetch: async (url, init) => {
      if (String(url) === "/result-data") {
        signal = init?.signal as AbortSignal | undefined;
        return new Promise<Response>((_resolve, reject) => signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true }));
      }
      return Response.json(String(url).includes("presets") ? { tone: [] } : { models: [], loras: [], textEncoders: [], vaes: [] });
    },
  });
  try {
    await act(async () => editor.sources[0].onmessage!({ data: JSON.stringify({ type: "job", job: { id, status: "succeeded", data: "/result-data", video: { id: "video", name: "result.mp4", url: "/result.mp4" } } }) }));
    const back = [...editor.container.querySelectorAll("button")].find((button) => button.textContent === (kind === "montage" ? "New swap" : "Back to settings"))!;
    assert.ok(back);
    await act(async () => back.click());
    assert.equal(signal?.aborted, true);
    assert.equal(editor.container.querySelector('[role="alert"]'), null, "leaving the view is not a failed metadata request");
  } finally { await editor.close(); }
});
