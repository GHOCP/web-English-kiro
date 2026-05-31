// Tiny HTTP response helpers shared by the API route handlers.
//
// Route handlers in the App Router may return any standard `Response`, so we
// build JSON responses with the Web-standard `Response` constructor. This keeps
// the handlers environment-agnostic (no `next/server` dependency), which in
// turn lets them be unit-tested by invoking the exported functions with plain
// `Request` objects — no live server required.
//
// The error envelope matches the shared `ApiErrorResponse` contract so the
// editor/client can surface field-level messages consistently (NFR 3.1).
import type { ApiErrorResponse, FieldError } from '@/types';
import { toErrorResponse } from '@/lib/validation';

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' } as const;

/** Serialize `data` as a JSON `Response` with the given status (default 200). */
export function jsonResponse<T>(data: T, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}

/** Return an `ApiErrorResponse` body with an arbitrary status code. */
export function errorResponse(body: ApiErrorResponse, status: number): Response {
  return jsonResponse(body, status);
}

/** Convenience: 400 Bad Request carrying field-level validation errors. */
export function validationErrorResponse(
  errors: FieldError[],
  message?: string,
): Response {
  return jsonResponse(toErrorResponse(errors, message), 400);
}

/** Convenience: 404 Not Found with a plain message. */
export function notFoundResponse(message: string): Response {
  return jsonResponse({ error: message } satisfies ApiErrorResponse, 404);
}
