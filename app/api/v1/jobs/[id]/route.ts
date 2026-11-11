import { NextResponse } from "next/server";
import { apiV1Access } from "../../../../../lib/api-v1.ts";
import { getJob, publicJob } from "../../../../../lib/comfy.ts";
import { getStore } from "../../../../../lib/db.ts";
import { HttpError } from "../../../../../lib/http.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function statusOf(error: unknown) {
  return error instanceof HttpError ? error.status : 502;
}

// The live status from ComfyUI plus the stored record and its event log.
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = apiV1Access(request);
  if (denied) return denied;
  try {
    const { id } = await params;
    const job = publicJob(await getJob(id));
    const store = getStore();
    const record = store.getJob(job.id);
    if (record) {
      store.saveJob({
        id: job.id,
        kind: record.kind,
        status: job.status,
        title: record.title,
        result: { status: job.status, error: job.error, video: job.video?.name ?? null, url: job.video?.url ?? null, data: job.data },
      });
    }
    return NextResponse.json({ ...job, record: record ?? null, events: store.events(job.id) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to check the job." }, { status: statusOf(error) });
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = apiV1Access(request);
  if (denied) return denied;
  try {
    const { id } = await params;
    const job = await getJob(id);
    const cancelled = publicJob(await job.cancel());
    const store = getStore();
    const record = store.getJob(cancelled.id);
    store.saveJob({ id: cancelled.id, kind: record?.kind ?? "unknown", status: cancelled.status, title: record?.title ?? cancelled.id });
    return NextResponse.json(cancelled);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to cancel the job." }, { status: statusOf(error) });
  }
}
