import { apiAccess } from "../../../lib/http.ts";
import { MAX_CHARACTERS } from "../../../lib/advanced.ts";
import { JOB_KINDS, loadGraph } from "../../../lib/comfy.ts";
import { checkSetup, setupGraph, type SetupRequest } from "../../../lib/setup.ts";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const denied = apiAccess(request);
  if (denied) return denied;
  try {
    const selection: SetupRequest = await request.json();
    if (!selection || !JOB_KINDS.includes(selection.kind)) return Response.json({ error: "Unknown mode." }, { status: 400 });
    if ("pictures" in selection && (!Number.isInteger(selection.pictures) || selection.pictures < 1 || selection.pictures > MAX_CHARACTERS)) {
      return Response.json({ error: `Add 1-${MAX_CHARACTERS} character photos.` }, { status: 400 });
    }
    const graph = setupGraph(await loadGraph(selection.kind), selection);
    return Response.json(await checkSetup(graph));
  } catch {
    return Response.json({ error: "Could not check these settings. Review them and try again." }, { status: 400 });
  }
}
