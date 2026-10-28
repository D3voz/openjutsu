import assert from "node:assert/strict";
import test from "node:test";
import { listTonePresets } from "../lib/comfy.ts";

test("healthy tone presets survive a missing or malformed neighbour", async (t) => {
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    const url = String(input);
    if (url.endsWith("/presets/color_fx_dctl_tone_mapper")) return Response.json({ presets: ["good one", "missing", "malformed", "good two", 42] });
    if (url.endsWith("/good%20one")) return Response.json({ settings: { strength: 0.2 } });
    if (url.endsWith("/good%20two")) return Response.json({ settings: { strength: 0.4 } });
    if (url.endsWith("/malformed")) return Response.json({ settings: null });
    return new Response("not found", { status: 404 });
  });
  assert.deepEqual(await listTonePresets(), [
    { name: "good one", settings: { strength: 0.2 } }, { name: "good two", settings: { strength: 0.4 } },
  ]);
});

test("a missing preset service still returns an empty optional list", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response("unavailable", { status: 503 }));
  assert.deepEqual(await listTonePresets(), []);
});
