/**
 * TOTP (FR-AUTH-01/05): otplib v13 functional API. Secrets are generated
 * server-side; enrolment exposes the otpauth URL (QR) and the manual secret
 * once. Verification is constant-time (otplib) with ±30s clock tolerance.
 */
import { generateSecret, generateSync, generateURI, verifySync } from "otplib";

export function generateTotpSecret(): string {
  return generateSecret();
}

export function totpKeyUri(email: string, secret: string): string {
  return generateURI({ issuer: "N8E Collect", label: email, secret });
}

export function verifyTotpCode(code: string, secret: string): boolean {
  try {
    return verifySync({ token: code, secret, epochTolerance: 30 }).valid;
  } catch {
    return false;
  }
}

/** Test helper: current code for a secret (used by unit + e2e specs). */
export function currentTotpCode(secret: string): string {
  return generateSync({ secret });
}
