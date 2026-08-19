import argon2 from "argon2";
import { currentTotpCode } from "../auth/totp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ApiError } from "../api/errors";
import { adminUsers } from "../db/schema";
import { freshTestDb } from "../db/test-helpers";
import {
  beginTotpEnrolment,
  loginWithPassword,
  LOCKOUT_THRESHOLD,
  verifyTotpStep,
} from "./auth";

let ctx: Awaited<ReturnType<typeof freshTestDb>>;
const EMAIL = "admin@test.n8elabs.com";
const PASSWORD = "correct horse battery staple";
let adminId: string;

beforeAll(async () => {
  ctx = await freshTestDb();
  const [row] = await ctx.db
    .insert(adminUsers)
    .values({
      email: EMAIL,
      passwordHash: await argon2.hash(PASSWORD, { type: argon2.argon2id }),
    })
    .returning();
  adminId = row.id;
}, 60_000);

afterAll(async () => {
  await ctx.pool.end();
});

describe("password step", () => {
  it("accepts the correct password", async () => {
    const result = await loginWithPassword(ctx.db, EMAIL, PASSWORD);
    expect(result.adminId).toBe(adminId);
    expect(result.totpEnrolled).toBe(false);
  });

  it("rejects a wrong password and an unknown email identically", async () => {
    await expect(loginWithPassword(ctx.db, EMAIL, "wrong")).rejects.toMatchObject({
      code: "auth/invalid-credentials",
    });
    await expect(
      loginWithPassword(ctx.db, "nobody@n8elabs.com", "whatever"),
    ).rejects.toMatchObject({ code: "auth/invalid-credentials" });
  });
});

describe("TOTP enrol + verify", () => {
  it("enrols, verifies a valid code, and flips totpEnabled", async () => {
    const enrolment = await beginTotpEnrolment(ctx.db, adminId);
    expect(enrolment.otpauthUrl).toContain("otpauth://totp/");
    const code = currentTotpCode(enrolment.secret);
    const result = await verifyTotpStep(ctx.db, adminId, code);
    expect(result.email).toBe(EMAIL);
    const after = await loginWithPassword(ctx.db, EMAIL, PASSWORD);
    expect(after.totpEnrolled).toBe(true);
  });

  it("rejects an invalid code", async () => {
    await expect(verifyTotpStep(ctx.db, adminId, "000000")).rejects.toMatchObject({
      code: "auth/totp-invalid",
    });
  });
});

describe("lockout (FR-AUTH-02)", () => {
  it("locks after 5 consecutive failures and unlocks after the window", async () => {
    const email = "locked@test.n8elabs.com";
    for (let i = 0; i < LOCKOUT_THRESHOLD; i++) {
      await expect(loginWithPassword(ctx.db, email, "bad")).rejects.toBeInstanceOf(
        ApiError,
      );
    }
    // 6th attempt: locked even with a *valid-shaped* attempt
    await expect(loginWithPassword(ctx.db, email, "bad")).rejects.toMatchObject({
      code: "auth/locked",
    });
    // simulate the window passing: evaluate "now" 16 minutes in the future
    const later = new Date(Date.now() + 16 * 60_000);
    await expect(loginWithPassword(ctx.db, email, "bad", later)).rejects.toMatchObject({
      code: "auth/invalid-credentials", // no longer locked, back to normal failure
    });
  });

  it("a success resets the consecutive-failure count", async () => {
    // start from a clean audit trail for this email
    await ctx.pool.query(
      "DELETE FROM audit_log WHERE subject_id = $1 AND action LIKE 'auth.%'",
      [EMAIL],
    );
    for (let i = 0; i < LOCKOUT_THRESHOLD - 1; i++) {
      await expect(loginWithPassword(ctx.db, EMAIL, "bad")).rejects.toBeInstanceOf(
        ApiError,
      );
    }
    // success before the 5th failure
    await loginWithPassword(ctx.db, EMAIL, PASSWORD);
    const enrol = await beginTotpEnrolment(ctx.db, adminId);
    await verifyTotpStep(ctx.db, adminId, currentTotpCode(enrol.secret));
    // failures start counting again from zero
    await expect(loginWithPassword(ctx.db, EMAIL, "bad")).rejects.toMatchObject({
      code: "auth/invalid-credentials",
    });
  });
});
