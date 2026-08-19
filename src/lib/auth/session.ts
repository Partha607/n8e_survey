/**
 * Admin session: signed httpOnly SameSite=Lax cookie, 12h idle expiry
 * (FR-AUTH-03). Signed JWT (HS256, jose) — no server-side session store, so
 * sessions survive restarts. A short-lived "pending" cookie bridges the
 * password step and the TOTP step (FR-AUTH-01).
 */
import { jwtVerify, SignJWT } from "jose";

export const SESSION_COOKIE = "n8e_session";
export const PENDING_COOKIE = "n8e_pending";
export const SESSION_IDLE_HOURS = 12;
const PENDING_MINUTES = 10;

function secretKey(): Uint8Array {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("SESSION_SECRET must be set in production");
    }
    return new TextEncoder().encode("n8e-dev-session-secret-not-for-production");
  }
  return new TextEncoder().encode(secret);
}

export type SessionClaims = { adminId: string; email: string };
export type PendingClaims = SessionClaims & { stage: "password-ok" };

export async function signSession(claims: SessionClaims): Promise<string> {
  return new SignJWT({ email: claims.email })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(claims.adminId)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_IDLE_HOURS}h`)
    .sign(secretKey());
}

export async function verifySession(token: string): Promise<SessionClaims | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey());
    if (!payload.sub || typeof payload.email !== "string") return null;
    return { adminId: payload.sub, email: payload.email };
  } catch {
    return null;
  }
}

export async function signPending(claims: SessionClaims): Promise<string> {
  return new SignJWT({ email: claims.email, stage: "password-ok" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(claims.adminId)
    .setIssuedAt()
    .setExpirationTime(`${PENDING_MINUTES}m`)
    .sign(secretKey());
}

export async function verifyPending(token: string): Promise<PendingClaims | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey());
    if (!payload.sub || typeof payload.email !== "string") return null;
    if (payload.stage !== "password-ok") return null;
    return { adminId: payload.sub, email: payload.email, stage: "password-ok" };
  } catch {
    return null;
  }
}

export function sessionCookieOptions(maxAgeSeconds: number) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: maxAgeSeconds,
  };
}
