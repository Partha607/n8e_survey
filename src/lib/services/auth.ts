/**
 * Auth domain service (HTTP-free, N8E-API-SPEC §5.3).
 * - Password step: argon2id verify, throttled — 5 consecutive failures lock
 *   the login for 15 minutes (FR-AUTH-02). The lock is derived from the
 *   append-only audit log so it survives restarts; every failure is audited.
 * - TOTP step: mandatory (FR-AUTH-01); enrolment exposes QR + manual secret.
 */
import argon2 from "argon2";
import { and, desc, eq, gt, inArray } from "drizzle-orm";
import { ApiError } from "../api/errors";
import { generateTotpSecret, totpKeyUri, verifyTotpCode } from "../auth/totp";
import type { Db } from "../db/client";
import { adminUsers, auditLog } from "../db/schema";
import { appendAudit } from "./audit";

export const LOCKOUT_THRESHOLD = 5;
export const LOCKOUT_MINUTES = 15;

const FAIL_ACTIONS = ["auth.login.fail", "auth.totp.fail"];

async function assertNotLocked(db: Db, email: string, now: Date): Promise<void> {
  const windowStart = new Date(now.getTime() - LOCKOUT_MINUTES * 60_000);
  const recent = await db
    .select({ id: auditLog.id, action: auditLog.action })
    .from(auditLog)
    .where(
      and(
        inArray(auditLog.action, [...FAIL_ACTIONS, "auth.login.success"]),
        eq(auditLog.subjectId, email),
        gt(auditLog.at, windowStart),
      ),
    )
    .orderBy(desc(auditLog.id))
    .limit(LOCKOUT_THRESHOLD);

  const consecutiveFails =
    recent.length &&
    recent.every((r) => FAIL_ACTIONS.includes(r.action)) &&
    recent.length >= LOCKOUT_THRESHOLD;

  if (consecutiveFails) {
    throw new ApiError(
      "auth/locked",
      `Too many failed attempts. Try again in ${LOCKOUT_MINUTES} minutes.`,
    );
  }
}

async function auditFail(db: Db, action: string, email: string) {
  await appendAudit(db, {
    actor: "system",
    action,
    subjectType: "admin",
    subjectId: email,
  });
}

export type PasswordStepResult = {
  adminId: string;
  email: string;
  totpEnrolled: boolean;
};

export async function loginWithPassword(
  db: Db,
  email: string,
  password: string,
  now = new Date(),
): Promise<PasswordStepResult> {
  await assertNotLocked(db, email, now);

  const [user] = await db.select().from(adminUsers).where(eq(adminUsers.email, email));
  const hash = user?.passwordHash ?? (await dummyHash());
  const valid = await argon2.verify(hash, password).catch(() => false);

  if (!user || !valid) {
    await auditFail(db, "auth.login.fail", email);
    throw new ApiError("auth/invalid-credentials", "Invalid email or password.");
  }

  return { adminId: user.id, email: user.email, totpEnrolled: user.totpEnabled };
}

// constant-shape work for unknown emails so timing doesn't reveal existence
let cachedDummy: string | null = null;
async function dummyHash(): Promise<string> {
  if (!cachedDummy) {
    cachedDummy = await argon2.hash("dummy-password-for-timing", {
      type: argon2.argon2id,
    });
  }
  return cachedDummy;
}

export type TotpEnrolment = { secret: string; otpauthUrl: string };

export async function beginTotpEnrolment(
  db: Db,
  adminId: string,
): Promise<TotpEnrolment> {
  const [user] = await db.select().from(adminUsers).where(eq(adminUsers.id, adminId));
  if (!user) throw new ApiError("core/not-found", "Admin not found.");
  const secret = generateTotpSecret();
  await db
    .update(adminUsers)
    .set({ totpSecret: secret, totpEnabled: false })
    .where(eq(adminUsers.id, adminId));
  await appendAudit(db, {
    actor: "admin",
    action: "auth.totp.enrol-started",
    subjectType: "admin",
    subjectId: user.email,
  });
  return { secret, otpauthUrl: totpKeyUri(user.email, secret) };
}

/** Verify a TOTP code; on first successful verify, enrolment is activated. */
export async function verifyTotpStep(
  db: Db,
  adminId: string,
  code: string,
  now = new Date(),
): Promise<{ email: string }> {
  const [user] = await db.select().from(adminUsers).where(eq(adminUsers.id, adminId));
  if (!user) throw new ApiError("core/not-found", "Admin not found.");
  await assertNotLocked(db, user.email, now);
  if (!user.totpSecret) {
    throw new ApiError("auth/totp-not-enrolled", "TOTP enrolment required.");
  }

  if (!verifyTotpCode(code, user.totpSecret)) {
    await auditFail(db, "auth.totp.fail", user.email);
    throw new ApiError("auth/totp-invalid", "Invalid authenticator code.");
  }

  await db
    .update(adminUsers)
    .set({ totpEnabled: true, lastLoginAt: now })
    .where(eq(adminUsers.id, adminId));
  await appendAudit(db, {
    actor: "admin",
    action: "auth.login.success",
    subjectType: "admin",
    subjectId: user.email,
  });
  return { email: user.email };
}
