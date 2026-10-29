import { createHash, timingSafeEqual } from "node:crypto";
import { openAsBlob } from "node:fs";
import { mkdir, mkdtemp, open as openFile, rm, type FileHandle } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

export class HttpError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

// Native fetch decodes these content codings but retains the upstream headers.
// Byte lengths, ranges and validators of the coded representation cannot label
// the decoded full body. Unknown codings and coded partial bodies fail closed.
export async function mediaTransferHeaders(response: Response): Promise<Headers> {
  const coding = response.headers.get("Content-Encoding")?.trim().toLowerCase();
  if (coding && coding !== "identity") {
    if (!["gzip", "deflate", "br"].includes(coding) || response.status === 206) {
      await response.body?.cancel();
      throw new HttpError(502, response.status === 206 ? "Unsupported compressed byte-range response." : "Unsupported upstream media content encoding.");
    }
    return new Headers();
  }
  return new Headers(["Content-Length", "Content-Range", "Accept-Ranges"].flatMap((key) => {
    const value = response.headers.get(key);
    return value === null ? [] : [[key, value]];
  }));
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
const MAX_FIELD_BYTES = 1024 * 1024;
const MAX_HEADER_BYTES = 16 * 1024;
const MAX_FILES = 16;
const HEAD_BYTES = 12;

// Leading bytes of what ComfyUI's loaders read: MP4/MOV, MKV/WebM and AVI; PNG, JPEG and WebP.
export const VIDEO_SIGNATURE = /^(?:[^]{4}ftyp|\x1a\x45\xdf\xa3|RIFF[^]{4}AVI )/;
export const IMAGE_SIGNATURE = /^(?:\x89PNG\r\n\x1a\n|\xff\xd8\xff|RIFF[^]{4}WEBP)/;
export type FileCheck = { signature: RegExp; error: string };

// A file part already on disk, so it can be uploaded without reading it into memory.
export class StoredFile extends File {
  readonly path: string;

  constructor(blob: Blob, name: string, type: string, path: string) {
    super([blob], name, { type });
    this.path = path;
  }
}

// ComfyUI keeps the upload under its temp file's name, and Windows reserves device names even with an extension.
export function uploadName(name: string) {
  const safe = name.replace(/[^\w.\- ]+/g, "_").slice(-100).replace(/[. ]+$/, "") || "upload";
  return /^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(safe) ? `_${safe}` : safe;
}

type Part = { name: string; text?: Buffer[]; file?: { name: string; type: string; path: string; handle: FileHandle; head: Buffer; size: number; check?: FileCheck } };

// Streams a multipart body to temp files, checking each file's first bytes as they arrive. Call dispose() when done.
export async function readFormData(request: Request, checks: Record<string, FileCheck> = {}, limit = MAX_UPLOAD_BYTES) {
  const tooLarge = () => new HttpError(413, `Uploads must total no more than ${Math.round(limit / 1024 / 1024)} MB.`);
  if (Number(request.headers.get("Content-Length")) > limit) throw tooLarge();
  const boundary = request.headers.get("Content-Type")?.match(/^multipart\/form-data\s*;.*?\bboundary=(?:"([^"]+)"|([^\s;]+))/i);
  if (!boundary || !request.body) throw new HttpError(400, "Send the upload as multipart/form-data.");
  const malformed = () => new HttpError(400, "The upload is not a valid multipart form.");
  const delimiter = Buffer.from(`\r\n--${boundary[1] ?? boundary[2]}`);
  const dir = await mkdtemp(join(tmpdir(), "openjutsu-"));
  const dispose = () => rm(dir, { recursive: true, force: true });
  const reader = request.body.getReader();
  const form = new FormData();
  let part: Part | null = null;
  let size = 0;
  let fieldBytes = 0;
  let files = 0;

  const open = async (headers: string): Promise<Part> => {
    const disposition = headers.match(/^content-disposition:[ \t]*form-data(.*)$/im)?.[1] ?? "";
    const param = (key: string) => disposition.match(new RegExp(`;\\s*${key}=(?:"([^"]*)"|([^;\\s]+))`, "i"))?.slice(1).find((value) => value !== undefined);
    const name = param("name") ?? "";
    const filename = param("filename");
    if (filename === undefined) return { name, text: [] };
    if (++files > MAX_FILES) throw new HttpError(400, `Send no more than ${MAX_FILES} files.`);
    const path = join(dir, String(files), uploadName(filename));
    await mkdir(dirname(path));
    const type = headers.match(/^content-type:[ \t]*([^\r\n]*)$/im)?.[1].trim() ?? "";
    return { name, file: { name: filename, type, path, handle: await openFile(path, "wx"), head: Buffer.alloc(0), size: 0, check: Object.hasOwn(checks, name) ? checks[name] : undefined } };
  };
  const sniff = (file: NonNullable<Part["file"]>) => {
    if (file.check && !file.check.signature.test(file.head.toString("latin1"))) throw new HttpError(400, file.check.error);
    file.check = undefined;
  };
  const write = async ({ text, file }: Part, chunk: Buffer) => {
    if (text) {
      fieldBytes += chunk.length;
      if (fieldBytes > MAX_FIELD_BYTES) throw new HttpError(413, `Form fields must total no more than ${MAX_FIELD_BYTES / 1024 / 1024} MB.`);
      text.push(Buffer.from(chunk));
    } else if (file && chunk.length > 0) {
      if (file.head.length < HEAD_BYTES) file.head = Buffer.concat([file.head, chunk.subarray(0, HEAD_BYTES - file.head.length)]);
      if (file.head.length === HEAD_BYTES) sniff(file);
      file.size += chunk.length;
      await file.handle.write(chunk);
    }
  };
  const finish = async ({ name, text, file }: Part) => {
    if (text) form.append(name, Buffer.concat(text).toString("utf8"));
    if (!file) return;
    await file.handle.close();
    if (file.size > 0) sniff(file);
    form.append(name, new StoredFile(await openAsBlob(file.path), file.name, file.type, file.path));
  };

  try {
    // The leading line break lets the first boundary match the delimiter that ends every part.
    let buffer = Buffer.from("\r\n");
    let state: "preamble" | "next" | "headers" | "body" | "end" = "preamble";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) throw tooLarge();
      buffer = Buffer.concat([buffer, value]);
      for (let more = true; more;) {
        if (state === "preamble" || state === "body") {
          const at = buffer.indexOf(delimiter);
          // Without a delimiter, keep only the tail that could still start one.
          const end = at === -1 ? Math.max(0, buffer.length - delimiter.length + 1) : at;
          if (part) await write(part, buffer.subarray(0, end));
          buffer = buffer.subarray(at === -1 ? end : at + delimiter.length);
          if (at === -1) more = false;
          else {
            if (part) await finish(part);
            part = null;
            state = "next";
          }
        } else if (state === "next") {
          const mark = buffer.toString("latin1", 0, 2);
          if (mark.length < 2) more = false;
          else if (mark === "--") state = "end";
          else if (mark !== "\r\n") throw malformed();
          else {
            buffer = buffer.subarray(2);
            state = "headers";
          }
        } else if (state === "headers") {
          const at = buffer.indexOf("\r\n\r\n");
          if (at === -1) {
            if (buffer.length > MAX_HEADER_BYTES) throw malformed();
            more = false;
          } else {
            part = await open(buffer.toString("utf8", 0, at));
            buffer = buffer.subarray(at + 4);
            state = "body";
          }
        } else {
          buffer = Buffer.alloc(0);
          more = false;
        }
      }
    }
    if (state !== "end") throw malformed();
    return { form, dispose };
  } catch (error) {
    await reader.cancel().catch(() => {});
    await part?.file?.handle.close().catch(() => {});
    await dispose();
    throw error;
  }
}
