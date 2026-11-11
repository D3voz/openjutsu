import { NextResponse } from "next/server";
import { apiV1Access, readJsonBody } from "../../../../../lib/api-v1.ts";
import { getStore, type Snapshot } from "../../../../../lib/db.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Restores a snapshot made by /api/v1/db/export. Send the snapshot itself, or
// { "replace": true, "snapshot": { ... } } to clear the current history first.
export async function POST(request: Request) {
  const denied = apiV1Access(request);
  if (denied) return denied;
  try {
    const body = await readJsonBody<Snapshot & { snapshot?: Snapshot; replace?: boolean }>(request);
    const snapshot = body.snapshot ?? body;
    const replace = body.replace === true;
    const store = getStore();
    const result = store.importSnapshot(snapshot, { replace });
    store.logEvent(null, "import", `${result.jobs} jobs${replace ? ", replaced" : ", merged"}`);
    return NextResponse.json({ ok: true, replaced: replace, jobs: result.jobs, total: store.stats().jobs });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to import the database." }, { status: 400 });
  }
}
