import { createHash, timingSafeEqual } from "node:crypto";

export class HttpError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function validateJobId(id: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(id) || id.startsWith("http")) throw new HttpError(400, "Invalid job ID.");
}

export function authorize(request: Request) {
  const password = process.env.OPENJUTSU_PASSWORD;
  if (password) {
    const encoded = request.headers.get("Authorization")?.match(/^Basic\s+(\S+)$/i)?.[1] ?? "";
    const supplied = createHash("sha256").update(Buffer.from(encoded, "base64")).digest();
    const expected = createHash("sha256").update(`openjutsu:${password}`).digest();
    if (!timingSafeEqual(supplied, expected)) {
      return Response.json({ error: "Sign in to Openjutsu." }, {
        status: 401,
        headers: { "WWW-Authenticate": 'Basic realm="Openjutsu", charset="UTF-8"', "Cache-Control": "no-store" },
      });
    }
  } else {
    // Password-free use relies on the launcher's loopback binding. Reject other hostnames, including DNS rebinding.
    const local = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;
    const hosts = [new URL(request.url).host, request.headers.get("Host"), request.headers.get("X-Forwarded-Host")];
    if (hosts.some((host) => host !== null && !local.test(host))) {
      return Response.json({ error: "Set OPENJUTSU_PASSWORD before exposing Openjutsu outside localhost." }, { status: 403 });
    }
  }
  return null;
}

export function apiAccess(request: Request) {
  const denied = authorize(request);
  if (denied) return denied;
  const url = new URL(request.url);
  const protocol = request.headers.get("X-Forwarded-Proto");
  const scheme = protocol === "http" || protocol === "https" ? `${protocol}:` : url.protocol;
  const expectedOrigin = new URL(`${scheme}//${request.headers.get("Host") ?? url.host}`).origin;
  const origin = request.headers.get("Origin");
  const site = request.headers.get("Sec-Fetch-Site");
  if ((origin !== null && origin !== expectedOrigin) || (site !== null && site !== "same-origin" && site !== "none")) {
    return Response.json({ error: "Cross-origin API requests are not allowed." }, { status: 403 });
  }
  return null;
}

// Total multipart body, including reference pictures and boundaries; the proxy separately caps each file at 500 MB.
export const MAX_UPLOAD_BYTES = 512 * 1024 * 1024;

export async function readFormData(request: Request, limit = MAX_UPLOAD_BYTES) {
  const tooLarge = () => new HttpError(413, `Uploads must total no more than ${Math.round(limit / 1024 / 1024)} MB.`);
  if (Number(request.headers.get("Content-Length")) > limit) throw tooLarge();
  let size = 0;
  const body = request.body?.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      size += chunk.byteLength;
      if (size > limit) throw tooLarge();
      controller.enqueue(chunk);
    },
  }), { signal: request.signal });
  try {
    return await new Response(body, { headers: request.headers }).formData();
  } catch (error) {
    // Multipart parsers may wrap the stream error in a TypeError.
    if (size > limit) throw tooLarge();
    throw error;
  }
}
