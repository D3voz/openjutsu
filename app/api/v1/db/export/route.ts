import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NextResponse } from "next/server";
import { apiV1Access } from "../../../../../lib/api-v1.ts";
import { getStore } from "../../../../../lib/db.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ?format=json (default): portable snapshot with jobs, events and meta.
// ?format=sqlite: the database file itself, for a byte-for-byte backup (for example to Google Drive).
export async function GET(request: Request) {
  const denied = apiV1Access(request);
  if (denied) return denied;
  const url = new URL(request.url);
  const format = url.searchParams.get("format") ?? "json";
  try {
    const store = getStore();
    if (format === "sqlite") {
      // VACUUM INTO writes a consistent copy while the app keeps writing, so the download is
      // never a torn WAL snapshot.
      const copy = join(tmpdir(), `openjutsu-export-${process.pid}-${Date.now()}.db`);
      try {
        store.backupTo(copy);
        const bytes = await readFile(copy);
        const stamp = new Date().toISOString().replace(/[:.]/g, "-");
        return new Response(bytes, {
          headers: {
            "Content-Type": "application/vnd.sqlite3",
            "Content-Disposition": `attachment; filename="openjutsu-${stamp}.db"`,
            "Cache-Control": "no-store",
          },
        });
      } finally {
        await rm(copy, { force: true });
      }
    }
    const snapshot = store.exportSnapshot();
    return NextResponse.json(snapshot, {
      headers: { "Content-Disposition": `attachment; filename="openjutsu-${new Date().toISOString().slice(0, 10)}.json"` },
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to export the database." }, { status: 500 });
  }
}
