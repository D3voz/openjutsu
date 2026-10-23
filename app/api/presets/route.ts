import { NextResponse } from "next/server";
import { listTonePresets } from "../../../lib/comfy.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ tone: await listTonePresets() });
}
