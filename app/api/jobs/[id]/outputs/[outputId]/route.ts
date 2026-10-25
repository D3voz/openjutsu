import { apiAccess, HttpError } from "../../../../../../lib/http.ts";
import { getOutput } from "../../../../../../lib/comfy.ts";

export const runtime = "nodejs";

// SVG is left out: it can carry script.
const SERVED_TYPES = /^(video\/[\w.+-]+|image\/(png|jpeg|webp|gif)|application\/json)$/;

export async function GET(request: Request, { params }: { params: Promise<{ id: string; outputId: string }> }) {
  const denied = apiAccess(request);
  if (denied) return denied;
  try {
    const { id, outputId } = await params;
    const { name, response } = await getOutput(id, outputId, request.headers.get("Range"));
    if (!response.ok || !response.body) return Response.json({ error: "The output is not ready." }, { status: 502 });

    const type = response.headers.get("Content-Type")?.split(";")[0].trim().toLowerCase() ?? "";
    if (!SERVED_TYPES.test(type)) {
      await response.body.cancel();
      return Response.json({ error: "Openjutsu only serves video, image and JSON outputs." }, { status: 502 });
    }

    const headers = new Headers({ "Cache-Control": "private, max-age=300", "Content-Type": type, "X-Content-Type-Options": "nosniff" });
    for (const header of ["Content-Length", "Content-Range", "Accept-Ranges"]) {
      const value = response.headers.get(header);
      if (value) headers.set(header, value);
    }
    if (new URL(request.url).searchParams.has("download")) headers.set("Content-Disposition", `attachment; filename="${name.replace(/"/g, "")}"`);
    return new Response(response.body, { status: response.status, headers });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to download the output." }, { status: error instanceof HttpError ? error.status : 502 });
  }
}
