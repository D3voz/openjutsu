import { NextResponse } from "next/server";
import { apiV1Access } from "../../../../lib/api-v1.ts";
import { comfyUi } from "../../../../lib/comfy.ts";
import { getStore } from "../../../../lib/db.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Liveness for the API, the SQLite store and ComfyUI. A failing database is reported, not thrown.
export async function GET(request: Request) {
  const denied = apiV1Access(request);
  if (denied) return denied;

  let db: Record<string, unknown>;
  try {
    const store = getStore();
    const stats = store.stats();
    db = { ok: true, path: store.path, sizeBytes: store.sizeBytes(), jobs: stats.jobs, lastJobAt: stats.lastJobAt };
  } catch (error) {
    db = { ok: false, error: error instanceof Error ? error.message : "Unable to open the database." };
  }

  let comfy: Record<string, unknown>;
  try {
    await comfyUi("/system_stats", 4000);
    comfy = { ok: true };
  } catch (error) {
    comfy = { ok: false, error: error instanceof Error ? error.message : "ComfyUI is unreachable." };
  }

  return NextResponse.json({
    ok: db.ok === true && comfy.ok === true,
    service: "openjutsu",
    time: new Date().toISOString(),
    db,
    comfy,
  });
}
