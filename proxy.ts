import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function proxy(request: NextRequest) {
  if (!SAFE_METHODS.has(request.method) && request.headers.get("sec-fetch-site") === "cross-site") {
    return NextResponse.json(
      { error: { code: "CROSS_SITE_REQUEST_REJECTED", message: "Cross-site state-changing requests are not allowed." } },
      { status: 403 }
    );
  }
  return NextResponse.next();
}

export const config = { matcher: "/api/:path*" };
