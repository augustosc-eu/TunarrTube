import { ZodError } from "zod";
import { sanitizeLogValue } from "@/lib/logging/sanitize";

export class AppError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
    public details?: unknown
  ) {
    super(message);
  }
}

export function ok<T>(data: T, init?: ResponseInit) {
  return Response.json({ data }, init);
}

export function toErrorResponse(error: unknown) {
  if (error instanceof AppError) {
    return Response.json(
      { error: { code: error.code, message: error.message, details: error.details } },
      { status: error.status }
    );
  }
  if (error instanceof ZodError) {
    return Response.json(
      { error: { code: "VALIDATION_ERROR", message: "The request is invalid.", details: error.issues } },
      { status: 400 }
    );
  }
  // request.json() on a malformed body -- the client's fault, not a server error.
  if (error instanceof SyntaxError) {
    return Response.json(
      { error: { code: "INVALID_JSON", message: "The request body is not valid JSON." } },
      { status: 400 }
    );
  }
  // Anything else is unexpected: a Prisma, filesystem, or fetch error whose raw message can carry
  // internal paths or signed URLs. Log a sanitized copy server-side and keep the response generic.
  const detail = error instanceof Error ? `${error.name}: ${error.message}\n${error.stack ?? ""}` : String(error);
  console.error(sanitizeLogValue(detail));
  return Response.json({ error: { code: "INTERNAL_ERROR", message: "Unexpected server error. See the server log for details." } }, { status: 500 });
}

export function serialize<T>(value: T): T {
  return JSON.parse(
    JSON.stringify(value, (_key, item) => (typeof item === "bigint" ? item.toString() : item))
  ) as T;
}
