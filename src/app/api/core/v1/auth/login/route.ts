import { z } from "zod";
import { defineRoute } from "@/lib/api/pipeline";
import { PENDING_COOKIE, sessionCookieOptions, signPending } from "@/lib/auth/session";
import { loginWithPassword } from "@/lib/services/auth";

export const POST = defineRoute({
  plane: "public",
  rateClass: "auth",
  summary: "Password step of admin login; issues short-lived pending cookie",
  body: z.object({ email: z.string().email(), password: z.string().min(1) }),
  handler: async (ctx) => {
    const result = await loginWithPassword(ctx.db, ctx.body.email, ctx.body.password);
    return {
      data: { totpEnrolled: result.totpEnrolled },
      cookies: [
        {
          name: PENDING_COOKIE,
          value: await signPending({ adminId: result.adminId, email: result.email }),
          options: sessionCookieOptions(10 * 60),
        },
      ],
    };
  },
});
