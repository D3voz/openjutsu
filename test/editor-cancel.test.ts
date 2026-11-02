import assert from "node:assert/strict";
import test from "node:test";
import { act } from "react";
import { mountEditor } from "./editor-dom.ts";

const first = { id: "11111111-1111-4111-8111-111111111111", kind: "simple", margin: "normal", clips: 1, clipSeconds: 6, startedAt: 1, frames: "first" };
const second = { ...first, id: "22222222-2222-4222-8222-222222222222", result: "second.mp4" };

for (const failure of [false, true]) test(`a late cancellation ${failure ? "error" : "result"} cannot overwrite a reopened job`, async () => {
  let finish!: (value: Response) => void;
  const editor = await mountEditor({
    storage: { "openjutsu.run": first, "openjutsu.history": [second] },
    fetch: async (_input, init) => init?.method === "DELETE" ? new Promise<Response>((resolve) => { finish = resolve; }) : Response.json(String(_input).includes("presets") ? { tone: [] } : { models: [], loras: [], textEncoders: [], vaes: [] }),
  });
  try {
    const click = async (label: string) => {
      const button = [...editor.container.querySelectorAll("button")].find((button) => button.textContent?.trim() === label)!;
      assert.ok(button, label);
      await act(async () => button.click());
    };
    await click("Cancel");
    assert.ok(finish, "the original cancellation is in flight");
    await click("Back");
    const past = [...editor.container.querySelectorAll("button")].find((button) => button.textContent?.includes("second.mp4"))!;
    await act(async () => past.click());
    const source = editor.sources.at(-1)!;
    assert.ok(source.url.includes(second.id));
    await act(async () => source.onmessage!({ data: JSON.stringify({ type: "job", job: { id: second.id, status: "running" } }) }));
    await act(async () => finish(Response.json(failure ? { error: "first cancellation failed" } : { id: first.id, status: "canceled" }, { status: failure ? 503 : 200 })));
    assert.doesNotMatch(editor.container.textContent!, /Canceled|first cancellation failed/);
    assert.match(editor.container.textContent!, /Preparing/);
  } finally { await editor.close(); }
});

test("cancellation still updates the job when the user has not switched away", async () => {
  const editor = await mountEditor({
    storage: { "openjutsu.run": first },
    fetch: async (_input, init) => Response.json(init?.method === "DELETE" ? { id: first.id, status: "canceled" } : String(_input).includes("presets") ? { tone: [] } : { models: [], loras: [], textEncoders: [], vaes: [] }),
  });
  try {
    const button = [...editor.container.querySelectorAll("button")].find((button) => button.textContent === "Cancel")!;
    await act(async () => button.click());
    assert.match(editor.container.textContent!, /Canceled/);
  } finally { await editor.close(); }
});
