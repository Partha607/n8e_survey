/**
 * N8E API error registry (N8E-API-SPEC §4.3). Every error code the API can
 * emit is registered here — namespaced, stable, machine-readable.
 */

export const ERROR_CODES = {
  // core
  "core/invalid-request": 400,
  "core/unauthenticated": 401,
  "core/forbidden": 403,
  "core/not-found": 404,
  "core/conflict": 409,
  "core/rate-limited": 429,
  "core/internal": 500,
  // auth
  "auth/invalid-credentials": 401,
  "auth/locked": 429,
  "auth/totp-required": 401,
  "auth/totp-invalid": 401,
  "auth/totp-not-enrolled": 409,
  "auth/origin-mismatch": 403,
  // instrument
  "instrument/not-found": 404,
  "instrument/invalid-definition": 400,
  "instrument/version-immutable": 409,
  "instrument/has-responses": 409,
  "instrument/not-published": 409,
  "instrument/archived": 409,
  // distribution
  "distribution/not-found": 404,
  "distribution/closed": 409,
  "distribution/paused": 409,
  "distribution/cap-reached": 409,
  "distribution/not-open-yet": 409,
  // token (respondent invite tokens)
  "token/invalid": 401,
  "token/void": 409,
  "token/already-completed": 409,
  // response
  "response/not-found": 404,
  "response/already-completed": 409,
  "response/validation-failed": 400,
  "response/hidden-question": 400,
  "response/disqualified": 409,
} as const;

export type ErrorCode = keyof typeof ERROR_CODES;

export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly fieldErrors?: Record<string, string>;

  constructor(code: ErrorCode, message: string, fieldErrors?: Record<string, string>) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = ERROR_CODES[code];
    this.fieldErrors = fieldErrors;
  }
}
