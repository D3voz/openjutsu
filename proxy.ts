import { NextResponse } from "next/server";
import { authorize } from "./lib/http.ts";

export function proxy(request: Request) {
  return authorize(request) ?? NextResponse.next();
}

// API routes enforce access themselves, so large uploads never pass through Proxy's body cloning.
export const config = { matcher: "/" };
