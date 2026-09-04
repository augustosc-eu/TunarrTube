import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
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
});
