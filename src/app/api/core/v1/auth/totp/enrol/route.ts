import QRCode from "qrcode";
import { ApiError } from "@/lib/api/errors";
import { defineRoute } from "@/lib/api/pipeline";
import { PENDING_COOKIE, verifyPending } from "@/lib/auth/session";
import { beginTotpEnrolment } from "@/lib/services/auth";

/**
 * TOTP enrolment (QR + manual secret). Available to the authenticated admin
 * (re-enrolment) and to a pending login that has passed the password step but
 * never enrolled (first-run bootstrap) — FR-AUTH-05.
 */
export const POST = defineRoute({
  plane: "public",
  rateClass: "auth",
  summary: "Begin TOTP enrolment; returns otpauth URL, QR data URL and secret (once)",
  handler: async (ctx) => {
    let adminId: string | null = null;
    if (ctx.identity.plane === "session") {
      adminId = ctx.identity.adminId;
    } else {
      const pendingToken = ctx.req.cookies.get(PENDING_COOKIE)?.value;
      const pending = pendingToken ? await verifyPending(pendingToken) : null;
      adminId = pending?.adminId ?? null;
    }
    if (!adminId) {
      throw new ApiError("core/unauthenticated", "Authentication required.");
    }
    const enrolment = await beginTotpEnrolment(ctx.db, adminId);
    const qrDataUrl = await QRCode.toDataURL(enrolment.otpauthUrl);
    return { data: { ...enrolment, qrDataUrl } };
  },
});
