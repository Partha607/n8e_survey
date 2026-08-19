import { defineRoute } from "@/lib/api/pipeline";
import { SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth/session";

export const POST = defineRoute({
  scope: "collect:read",
  plane: "session",
  summary: "Invalidate the admin session cookie",
  handler: async (ctx) => {
    await ctx.audit({
      actor: "admin",
      action: "auth.logout",
      subjectType: "admin",
      subjectId: ctx.identity.plane === "session" ? ctx.identity.email : undefined,
    });
    return {
      data: { loggedOut: true },
      cookies: [{ name: SESSION_COOKIE, value: "", options: sessionCookieOptions(0) }],
    };
  },
});
