import { createHash, timingSafeEqual } from "node:crypto";
import type { AddressInfo } from "node:net";

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

export const MIN_PASSWORD_LENGTH = 12;
export const PASSWORD_TOO_SHORT = `OPENJUTSU_PASSWORD must be at least ${MIN_PASSWORD_LENGTH} characters. Choose a longer password and start again.`;

// Failed sign-ins back off per client: 5 free tries, then 1 s doubling to 5 min, forgotten after an hour without failures.
// Next fills X-Forwarded-For with the socket address only when the request has none, so its last entry names the client
// only behind a proxy or tunnel that appends it. Served directly, a client can forge it, so each client's free tries also
// count against one shared allowance.
const FREE_FAILURES = 5;
const SHARED_FREE_FAILURES = 20;
const MAX_DELAY = 5 * 60_000;
const FORGET_AFTER = 60 * 60_000;
const MAX_CLIENTS = 1000;
type Failures = { count: number; last: number };
// Proxy is bundled apart from the route handlers, so both keep their record on globalThis.
const { failures, shared } = ((globalThis as { [key: symbol]: unknown })[Symbol.for("openjutsu.failures")] ??=
  { failures: new Map(), shared: { count: 0, last: 0 } }) as { failures: Map<string, Failures>; shared: Failures };

function waitAfter(entry: Failures | undefined, free: number, now: number) {
  if (!entry || entry.count <= free || now - entry.last > FORGET_AFTER) return 0;
  return Math.max(0, entry.last + Math.min(1000 * 2 ** (entry.count - free - 1), MAX_DELAY) - now);
}

function recordFailure(client: string, now: number) {
  const entry = failures.get(client);
  const count = entry && now - entry.last <= FORGET_AFTER ? entry.count + 1 : 1;
  failures.delete(client);
  failures.set(client, { count, last: now });
  // Map order is oldest failure first, so expired and excess clients are at the front.
  for (const [key, { last }] of failures) {
    if (failures.size <= MAX_CLIENTS && now - last <= FORGET_AFTER) break;
    failures.delete(key);
  }
  if (count <= FREE_FAILURES) {
    shared.count = now - shared.last <= FORGET_AFTER ? shared.count + 1 : 1;
    shared.last = now;
  }
}

export function authorize(request: Request) {
  const password = process.env.OPENJUTSU_PASSWORD;
  if (password) {
    const encoded = request.headers.get("Authorization")?.match(/^Basic\s+(\S+)$/i)?.[1] ?? "";
    const client = request.headers.get("X-Forwarded-For")?.split(",").at(-1)?.trim() ?? "";
    const now = performance.now();
    if (encoded) {
      // Refuse before comparing, or the answer to a correct guess would still leak at full speed.
      const wait = Math.max(waitAfter(failures.get(client), FREE_FAILURES, now), waitAfter(shared, SHARED_FREE_FAILURES, now));
      if (wait > 0) {
        const seconds = Math.ceil(wait / 1000);
        return Response.json({ error: `Too many failed sign-ins. Try again in ${seconds} s.` }, {
          status: 429,
          headers: { "Retry-After": String(seconds), "Cache-Control": "no-store" },
        });
      }
    }
    const supplied = createHash("sha256").update(Buffer.from(encoded, "base64")).digest();
    const expected = createHash("sha256").update(`openjutsu:${password}`).digest();
    if (timingSafeEqual(supplied, expected)) {
      failures.delete(client);
    } else {
      // A request without credentials is the browser asking for the sign-in prompt, not a guess.
      if (encoded) recordFailure(client, now);
      return Response.json({ error: "Sign in to Openjutsu." }, {
        status: 401,
        headers: { "WWW-Authenticate": 'Basic realm="Openjutsu", charset="UTF-8"', "Cache-Control": "no-store" },
      });
    }
  } else {
    // instrumentation.ts refuses to start password-free on a network address; this only stops DNS rebinding.
    const local = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;
    const hosts = [new URL(request.url).host, request.headers.get("Host"), request.headers.get("X-Forwarded-Host")];
    if (hosts.some((host) => host !== null && !local.test(host))) {
      return Response.json({ error: "Set OPENJUTSU_PASSWORD before exposing Openjutsu outside localhost." }, { status: 403 });
    }
  }
  return null;
}

export const PASSWORD_REQUIRED = "Set OPENJUTSU_PASSWORD before serving Openjutsu on a network address.";

// Any peer can fake a localhost Host header, so password-free use needs every listening socket on loopback or a local pipe.
export function loopbackOnly(addresses: (AddressInfo | string | null)[]) {
  return addresses.length > 0 && addresses.every((address) => typeof address === "string" || /^(127\.|::1$|::ffff:127\.)/.test(address?.address ?? ""));
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
