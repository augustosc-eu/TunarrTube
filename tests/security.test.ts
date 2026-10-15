import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppError, toErrorResponse } from "@/lib/api";
import { proxy } from "@/proxy";

describe("API request boundary", () => {
  it("rejects browser cross-site mutations", async () => {
    const request = new NextRequest("http://localhost:3000/api/settings", {
      method: "PATCH",
      headers: { "sec-fetch-site": "cross-site" }
    });
    const response = proxy(request);
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "CROSS_SITE_REQUEST_REJECTED" } });
  });

  it("allows same-site mutations and cross-site safe requests", () => {
    const mutation = proxy(new NextRequest("http://localhost:3000/api/settings", {
      method: "PATCH",
      headers: { "sec-fetch-site": "same-origin" }
    }));
    const read = proxy(new NextRequest("http://localhost:3000/api/health", {
      headers: { "sec-fetch-site": "cross-site" }
    }));
    expect(mutation.status).toBe(200);
    expect(read.status).toBe(200);
  });

  it("rejects same-site mutations, such as another port on the same host", () => {
    const response = proxy(new NextRequest("http://localhost:3000/api/settings", {
      method: "PATCH",
      headers: { "sec-fetch-site": "same-site" }
    }));
    expect(response.status).toBe(403);
  });
});

describe("optional password", () => {
  afterEach(() => vi.unstubAllEnvs());
  const basic = (credentials: string) => `Basic ${Buffer.from(credentials).toString("base64")}`;

  it("is off unless TUNARRTUBE_AUTH_PASSWORD is set", () => {
    vi.stubEnv("TUNARRTUBE_AUTH_PASSWORD", "");
    expect(proxy(new NextRequest("http://localhost:3000/sources")).status).toBe(200);
  });

  it("requires credentials for pages and API routes when set", async () => {
    vi.stubEnv("TUNARRTUBE_AUTH_PASSWORD", "s3cret");
    const page = proxy(new NextRequest("http://localhost:3000/sources"));
    expect(page.status).toBe(401);
    expect(page.headers.get("www-authenticate")).toMatch(/^Basic realm="TunarrTube"/);
    const api = proxy(new NextRequest("http://localhost:3000/api/sources", { headers: { authorization: basic("admin:wrong") } }));
    expect(api.status).toBe(401);
    await expect(api.json()).resolves.toMatchObject({ error: { code: "UNAUTHORIZED" } });
  });

  it("accepts the configured credentials and leaves the health check open", () => {
    vi.stubEnv("TUNARRTUBE_AUTH_PASSWORD", "s3cret");
    vi.stubEnv("TUNARRTUBE_AUTH_USERNAME", "operator");
    expect(proxy(new NextRequest("http://localhost:3000/api/sources", { headers: { authorization: basic("operator:s3cret") } })).status).toBe(200);
    expect(proxy(new NextRequest("http://localhost:3000/api/sources", { headers: { authorization: basic("admin:s3cret") } })).status).toBe(401);
    expect(proxy(new NextRequest("http://localhost:3000/api/health")).status).toBe(200);
  });
});

describe("error responses", () => {
  it("keeps unexpected error details out of the response", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = toErrorResponse(new Error("ENOENT: open '/secret/path' https://rr1.googlevideo.com/videoplayback?sig=abc"));
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error.code).toBe("INTERNAL_ERROR");
    expect(JSON.stringify(body)).not.toContain("/secret/path");
    expect(consoleError.mock.calls[0][0]).not.toContain("googlevideo");
    consoleError.mockRestore();
  });

  it("maps malformed JSON bodies to 400 and keeps AppError details", async () => {
    let parseError: unknown;
    try { JSON.parse("{"); } catch (error) { parseError = error; }
    const malformed = toErrorResponse(parseError);
    expect(malformed.status).toBe(400);
    await expect(malformed.json()).resolves.toMatchObject({ error: { code: "INVALID_JSON" } });
    const expected = toErrorResponse(new AppError("SOURCE_NOT_FOUND", "Source not found.", 404));
    expect(expected.status).toBe(404);
    await expect(expected.json()).resolves.toMatchObject({ error: { code: "SOURCE_NOT_FOUND", message: "Source not found." } });
  });
});
