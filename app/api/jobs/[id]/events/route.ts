import { NotFound } from "@comfyorg/sdk";
import { getJob, JOB_KINDS, loadGraph, publicJob, rawJobEvents, TERMINAL, type JobKind } from "../../../../../lib/comfy.ts";
import { nodeDescriber } from "../../../../../lib/progress.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Server-sent events for the progress view, with node ids turned into node titles and clip
// numbers. One upstream connection per request; the page's EventSource reconnects.
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const kind = new URL(request.url).searchParams.get("kind") ?? "simple";
  const describe = nodeDescriber(await loadGraph(JOB_KINDS.includes(kind as JobKind) ? (kind as JobKind) : "simple"));
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: unknown) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      try {
        const job = await getJob(id);
        controller.enqueue(encoder.encode("retry: 2000\n\n"));
        send({ type: "job", job: publicJob(job) });
        if (!TERMINAL.has(job.status)) {
          for await (const { event, data } of rawJobEvents(job, request.signal)) {
            if (event === "progress") {
              send({ type: "progress", node: describe(typeof data.current_node === "string" ? data.current_node : null), step: data.step ?? null, steps: data.steps ?? null });
            } else if (event === "status") {
              send({ type: "status", status: data.status, queuePosition: data.queue_position ?? null });
              if (TERMINAL.has(String(data.status))) break;
            } else if (event === "output" && String(data.content_type).startsWith("image/")) {
              send({ type: "preview", url: `/api/jobs/${id}/outputs/${data.id}` });
            }
          }
          send({ type: "job", job: publicJob(await job.refresh()) });
        }
      } catch (error) {
        // The proxy forgets jobs when it restarts; the page then shows the job as no longer available.
        if (error instanceof NotFound) send({ type: "job", job: { id, status: "expired", queuePosition: null, error: null, video: null } });
        else if (!request.signal.aborted) send({ type: "error", message: error instanceof Error ? error.message : "Lost the job stream." });
      }
      if (!request.signal.aborted) controller.close();
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" },
  });
}
