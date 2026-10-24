import { apiAccess } from "../../../lib/http.ts";
import { NextResponse } from "next/server";
import { listTonePresets } from "../../../lib/comfy.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const denied = apiAccess(request);
  if (denied) return denied;
  return NextResponse.json({ tone: await listTonePresets() });
}
