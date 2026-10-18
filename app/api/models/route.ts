import { NextResponse } from "next/server";
import { listModels } from "../../../lib/comfy.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json((await listModels()) ?? { models: [], loras: [] });
}
