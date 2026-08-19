import { z } from "zod";
import { ApiError } from "@/lib/api/errors";
import { defineRoute } from "@/lib/api/pipeline";
import {
  PENDING_COOKIE,
  SESSION_COOKIE,
  SESSION_IDLE_HOURS,
  sessionCookieOptions,
  signSession,
  verifyPending,
} from "@/lib/auth/session";
import { verifyTotpStep } from "@/lib/services/auth";

export const POST = defineRoute({
  plane: "public",
  rateClass: "auth",
  summary: "TOTP step of admin login; issues the session cookie",
  body: z.object({ code: z.string().min(6).max(8) }),
  handler: async (ctx) => {
    const pendingToken = ctx.req.cookies.get(PENDING_COOKIE)?.value;
    const pending = pendingToken ? await verifyPending(pendingToken) : null;
    if (!pending) {
      throw new ApiError("auth/totp-required", "Complete the password step first.");
    }
    await verifyTotpStep(ctx.db, pending.adminId, ctx.body.code);
    return {
      data: { loggedIn: true },
      cookies: [
        {
          name: SESSION_COOKIE,
          value: await signSession({ adminId: pending.adminId, email: pending.email }),
          options: sessionCookieOptions(SESSION_IDLE_HOURS * 3600),
        },
        { name: PENDING_COOKIE, value: "", options: sessionCookieOptions(0) },
      ],
    };
  },
});
