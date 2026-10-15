import { createHash, timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
// Fetch Metadata values a browser sends for a request this app's own pages made ("same-origin") or a
// user typed/bookmarked ("none"). "same-site" is rejected too: another service on the same host but a
// different port (e.g. anything else on a home server) is same-site, and must not be able to drive the
// API. Requests with no header at all (curl, scripts, older browsers) aren't a CSRF vector and pass.
const TRUSTED_FETCH_SITES = new Set(["same-origin", "none"]);
// Left reachable without credentials: the Docker HEALTHCHECK (Dockerfile) calls it from inside the
// container, and it reveals nothing beyond up/down.
const PUBLIC_PATHS = new Set(["/api/health"]);
const AUTH_REALM = 'Basic realm="TunarrTube", charset="UTF-8"';

function digest(value: string) {
  return createHash("sha256").update(value, "utf8").digest();
}

// Constant-time comparison of a "user:password" pair -- both sides are hashed first so timingSafeEqual
// always sees equal-length buffers regardless of what the client sent.
function credentialsMatch(header: string | null, username: string, password: string) {
  if (!header?.startsWith("Basic ")) return false;
  let decoded: string;
  try {
    decoded = Buffer.from(header.slice(6).trim(), "base64").toString("utf8");
  } catch {
    return false;
  }
  return timingSafeEqual(digest(decoded), digest(`${username}:${password}`));
}

// Optional shared-password gate for installs exposed beyond localhost (`npm run start:lan`, a published
// Docker port). The password only ever comes from the environment -- it's never stored in the database,
// accepted through the API, or shown in the UI (same shape as AGENTS.md rule 11's cookie handling).
// Basic auth is used because browsers prompt for it natively and resend it on the UI's own fetch() calls,
// so no client component needs to know about it. Over plain HTTP it is sent in cleartext: put TunarrTube
// behind an HTTPS reverse proxy if the network isn't trusted.
function authorize(request: NextRequest) {
  const password = process.env.TUNARRTUBE_AUTH_PASSWORD;
  if (!password || PUBLIC_PATHS.has(request.nextUrl.pathname)) return null;
  const username = process.env.TUNARRTUBE_AUTH_USERNAME || "admin";
  if (credentialsMatch(request.headers.get("authorization"), username, password)) return null;
  const headers = { "WWW-Authenticate": AUTH_REALM };
  if (request.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "Authentication is required." } }, { status: 401, headers });
  }
  return new NextResponse("Authentication is required.", { status: 401, headers });
}

export function proxy(request: NextRequest) {
  const unauthorized = authorize(request);
  if (unauthorized) return unauthorized;
  const fetchSite = request.headers.get("sec-fetch-site");
  if (
    request.nextUrl.pathname.startsWith("/api/") &&
    !SAFE_METHODS.has(request.method) &&
    fetchSite !== null &&
    !TRUSTED_FETCH_SITES.has(fetchSite)
  ) {
    return NextResponse.json(
      { error: { code: "CROSS_SITE_REQUEST_REJECTED", message: "Cross-site state-changing requests are not allowed." } },
      { status: 403 }
    );
  }
  return NextResponse.next();
}

// Every route except Next's own build assets, which carry no user data and must load for the browser's
// auth prompt flow to work.
export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
