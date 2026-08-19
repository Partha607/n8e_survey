/**
 * resolveIdentity(): session | respondent | anonymous (N8E-API-SPEC §2 step 5).
 * The machine plane (service tokens) ships in Phase 6 — its tables exist now.
 * Respondent identity is possession of a distribution/response key, which the
 * route itself validates; the pipeline just classifies the plane.
 */
import type { NextRequest } from "next/server";
import { SESSION_COOKIE, verifySession } from "../auth/session";
import type { Identity } from "./scopes";

export async function resolveIdentity(
  req: NextRequest,
  plane: "session" | "respondent" | "public",
): Promise<Identity> {
  const cookie = req.cookies.get(SESSION_COOKIE)?.value;
  if (cookie) {
    const claims = await verifySession(cookie);
    if (claims) return { plane: "session", adminId: claims.adminId, email: claims.email };
  }
  if (plane === "respondent") return { plane: "respondent" };
  return { plane: "anonymous" };
}

/** CSRF: SameSite=Lax + origin check on admin mutations (FR-AUTH-04). */
export function originAllowed(req: NextRequest): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true; // same-origin fetches may omit it; SameSite covers the cookie
  const allowed = new Set(
    [
      process.env.APP_ORIGIN,
      `http://${req.headers.get("host")}`,
      `https://${req.headers.get("host")}`,
    ].filter(Boolean),
  );
  return allowed.has(origin);
}
