import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { openApiDocument } from "@/lib/openapi/document";

const HTTP_METHODS = ["get", "post", "put", "patch", "delete", "head", "options"] as const;

async function routeFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  return (await Promise.all(entries.map((entry) => {
    const fullPath = path.join(directory, entry.name);
    return entry.isDirectory() ? routeFiles(fullPath) : entry.name === "route.ts" ? [fullPath] : [];
  }))).flat();
}

function routePath(file: string) {
  const relative = path.relative(path.join(process.cwd(), "app"), path.dirname(file));
  return `/${relative.split(path.sep).map((segment) => segment.replace(/^\[(.+)\]$/, "{$1}")).join("/")}`;
}

describe("OpenAPI contract", () => {
  it("is OpenAPI 3.1 and has unique operation IDs", () => {
    expect(openApiDocument.openapi).toBe("3.1.0");
    const ids = Object.values(openApiDocument.paths).flatMap((item) =>
      HTTP_METHODS.flatMap((method) => {
        const candidate = item[method];
        return candidate && typeof candidate === "object" && "operationId" in candidate ? [candidate.operationId] : [];
      })
    );
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("only references declared component schemas", () => {
    const serialized = JSON.stringify(openApiDocument);
    const referenced = [...serialized.matchAll(/#\/components\/schemas\/([^"}]+)/g)].map((match) => match[1]);
    for (const name of referenced) {
      expect(name in openApiDocument.components.schemas, `schema ${name} is missing`).toBe(true);
    }
  });

  it("documents every implemented route method", async () => {
    for (const file of await routeFiles(path.join(process.cwd(), "app"))) {
      const source = await readFile(file, "utf8");
      const documentedPath = routePath(file);
      const pathItem = openApiDocument.paths[documentedPath];
      expect(pathItem, `${documentedPath} is missing`).toBeDefined();
      for (const method of HTTP_METHODS) {
        if (new RegExp(`export\\s+(?:async\\s+)?function\\s+${method}`, "i").test(source)) {
          expect(method in pathItem, `${method.toUpperCase()} ${documentedPath} is undocumented`).toBe(true);
        }
      }
    }
  });
});
