import { NextResponse } from "next/server";
import { apiV1Access } from "../../../../lib/api-v1.ts";
import { getStore } from "../../../../lib/db.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const denied = apiV1Access(request);
  if (denied) return denied;
  try {
    const store = getStore();
    return NextResponse.json({ ...store.stats(), database: { path: store.path, sizeBytes: store.sizeBytes() } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to read the database." }, { status: 500 });
  }
}
