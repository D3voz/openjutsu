import { apiAccess } from "../../../lib/http.ts";
import { NextResponse } from "next/server";
import { listModels, MODELS_UNAVAILABLE } from "../../../lib/comfy.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const denied = apiAccess(request);
  if (denied) return denied;
  try {
    return NextResponse.json(await listModels());
  } catch {
    // Empty lists turn the pickers into text fields.
    return NextResponse.json({ models: [], loras: [], textEncoders: [], vaes: [], error: MODELS_UNAVAILABLE }, { status: 502 });
  }
}
