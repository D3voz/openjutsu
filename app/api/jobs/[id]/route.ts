import { apiAccess, HttpError } from "../../../../lib/http.ts";
import { NextResponse } from "next/server";
import { getJob, publicJob, type PublicJob } from "../../../../lib/comfy.ts";
import { getStore } from "../../../../lib/db.ts";

export const runtime = "nodejs";

// Keep the local SQLite history in step with ComfyUI whenever the UI or the API checks a job.
function remember(job: PublicJob) {
  try {
    const store = getStore();
    const existing = store.getJob(job.id);
    store.saveJob({
      id: job.id,
      kind: existing?.kind ?? "unknown",
      status: job.status,
      title: existing?.title ?? job.id,
      result: { status: job.status, error: job.error, video: job.video?.name ?? null, url: job.video?.url ?? null, data: job.data },
    });
  } catch {}
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = apiAccess(request);
  if (denied) return denied;
  try {
    const { id } = await params;
    const job = publicJob(await getJob(id));
    remember(job);
    return NextResponse.json(job);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to check the job." }, { status: error instanceof HttpError ? error.status : 502 });
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = apiAccess(request);
  if (denied) return denied;
  try {
    const { id } = await params;
    const job = await getJob(id);
    const cancelled = publicJob(await job.cancel());
    remember(cancelled);
    return NextResponse.json(cancelled);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to cancel the job." }, { status: error instanceof HttpError ? error.status : 502 });
  }
}
