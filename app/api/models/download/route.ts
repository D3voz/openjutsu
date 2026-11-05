import { apiAccess, HttpError } from "../../../../lib/http.ts";
import { downloadStatus, startDownload } from "../../../../lib/download.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const denied = apiAccess(request);
  if (denied) return denied;
  return Response.json(downloadStatus());
}

export async function POST(request: Request) {
  const denied = apiAccess(request);
  if (denied) return denied;
  try {
    const { name } = await request.json();
    await startDownload(String(name));
    return Response.json(downloadStatus());
  } catch (error) {
    if (error instanceof HttpError) return Response.json({ error: error.message }, { status: error.status });
    return Response.json({ error: "Could not start the download." }, { status: 400 });
  }
}
