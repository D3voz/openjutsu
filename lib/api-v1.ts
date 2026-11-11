import { apiAccess, apiKeyMatches, suppliedKey } from "./http.ts";

// API access for machine clients. With OPENJUTSU_API_KEY set, a Bearer token (or x-api-key)
// is enough and no browser origin check applies; otherwise the normal Basic-password login is used.
// The browser login still works when a key is configured, so the web UI keeps working.

export function apiV1Access(request: Request): Response | null {
  if (apiKeyMatches(request)) return null;
  if (process.env.OPENJUTSU_API_KEY?.trim() && suppliedKey(request) !== null) {
    return Response.json({ error: "Invalid API key." }, { status: 401, headers: { "WWW-Authenticate": 'Bearer realm="Openjutsu"', "Cache-Control": "no-store" } });
  }
  return apiAccess(request);
}

export async function readJsonBody<T>(request: Request, limit = 32 * 1024 * 1024): Promise<T> {
  const length = Number(request.headers.get("Content-Length") ?? 0);
  if (length > limit) throw new Error(`The body must be no larger than ${Math.round(limit / 1024 / 1024)} MB.`);
  const text = await request.text();
  if (text.length > limit) throw new Error(`The body must be no larger than ${Math.round(limit / 1024 / 1024)} MB.`);
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error("The body must be valid JSON.");
  }
}

export function queryInt(value: string | null, fallback: number, min: number, max: number) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(number)));
}
