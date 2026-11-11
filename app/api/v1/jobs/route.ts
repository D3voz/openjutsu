import { NextResponse } from "next/server";
import { apiV1Access, queryInt } from "../../../../lib/api-v1.ts";
import { getStore } from "../../../../lib/db.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Submitting is the same multipart upload as the web UI; it is recorded in SQLite by that handler.
export { POST } from "../../jobs/route.ts";

export async function GET(request: Request) {
  const denied = apiV1Access(request);
  if (denied) return denied;
  const url = new URL(request.url);
  try {
    const list = getStore().listJobs({
      limit: queryInt(url.searchParams.get("limit"), 50, 1, 500),
      offset: queryInt(url.searchParams.get("offset"), 0, 0, 1_000_000),
      status: url.searchParams.get("status") ?? undefined,
      kind: url.searchParams.get("kind") ?? undefined,
    });
    return NextResponse.json(list);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to read the database." }, { status: 500 });
  }
}
