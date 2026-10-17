import { NextResponse } from "next/server";
import { getJob, publicJob } from "../../../../lib/comfy.ts";

export const runtime = "nodejs";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    return NextResponse.json(publicJob(await getJob(id)));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to check the job." }, { status: 502 });
  }
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const job = await getJob(id);
    return NextResponse.json(publicJob(await job.cancel()));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to cancel the job." }, { status: 502 });
  }
}
