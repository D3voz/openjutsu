import { apiAccess, HttpError } from "../../../../lib/http.ts";
import { NextResponse } from "next/server";
import { NotFound } from "@comfyorg/sdk";
import { getJob, publicJob } from "../../../../lib/comfy.ts";

export const runtime = "nodejs";

function errorStatus(error: unknown) {
  return error instanceof HttpError ? error.status : error instanceof NotFound ? 404 : 502;
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = apiAccess(request);
  if (denied) return denied;
  try {
    const { id } = await params;
    return NextResponse.json(publicJob(await getJob(id)));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to check the job." }, { status: errorStatus(error) });
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = apiAccess(request);
  if (denied) return denied;
  try {
    const { id } = await params;
    const job = await getJob(id);
    return NextResponse.json(publicJob(await job.cancel()));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to cancel the job." }, { status: errorStatus(error) });
  }
}
