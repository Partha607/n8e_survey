/**
 * The one envelope (N8E-API-SPEC §4.3) — the only way responses are made.
 * success → { data, meta } · failure → { error }; requestId always present.
 */
import { ApiError } from "./errors";

export type Meta = { requestId: string; nextCursor?: string } & Record<string, unknown>;

export function ok(data: unknown, meta: Meta) {
  return { data, meta };
}

export function fail(err: ApiError, requestId: string) {
  return {
    error: {
      code: err.code,
      message: err.message,
      ...(err.fieldErrors ? { fieldErrors: err.fieldErrors } : {}),
      requestId,
    },
  };
}
