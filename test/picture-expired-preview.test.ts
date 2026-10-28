import assert from "node:assert/strict";
import test from "node:test";
import { mountFromPicture } from "./from-picture-dom.ts";
const STORAGE = "openjutsu.picture-preview";
const models = { models: [], loras: [], textEncoders: [], vaes: [] };
for (const status of [400, 404, 422]) test(`an approved saved preparation with HTTP${status} recovers the source inputs`, async () => {
  const app = await mountFromPicture({ storage: { [STORAGE]: { job: null, prepared: "expired", approved: true } }, fetch: async (input) =>
    String(input) === "/api/models" ? Response.json(models) : Response.json({ error: "Prepare the picture again." }, { status }),
  });
  try {
    assert.equal(app.container.querySelectorAll('input[type="file"]').length, 2);
    assert.ok([...app.container.querySelectorAll("button")].some((button) => button.textContent === "Generate preview image"));
    assert.match(app.container.querySelector('[role="alert"]')!.textContent!, /Prepare the picture again/);
    assert.deepEqual(JSON.parse(app.dom.window.localStorage.getItem(STORAGE)!), { job: null, prepared: "", approved: false });
  } finally { await app.close(); }
});

test("a failed render retains its valid approved preparation for retry", async () => {
  const app = await mountFromPicture({ storage: { [STORAGE]: { job: { id: "render-failed", stage: "render" }, prepared: "valid-prepare", approved: true } }, fetch: async (input) =>
    String(input) === "/api/models" ? Response.json(models) : Response.json({ error: "Render failed." }, { status: 422 }),
  });
  try {
    const render = [...app.container.querySelectorAll("button")].find((button) => button.textContent === "Render video")!;
    assert.ok(render); assert.equal(render.disabled, false);
    assert.deepEqual(JSON.parse(app.dom.window.localStorage.getItem(STORAGE)!), { job: null, prepared: "valid-prepare", approved: true });
  } finally { await app.close(); }
});
