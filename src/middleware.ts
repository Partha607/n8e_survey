/**
 * /admin gate (FR-AUTH-04): unauthenticated requests to any /admin route are
 * redirected to /admin/login. Session verification is signature-only here
 * (edge-safe, no DB).
 */
import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/lib/auth/session";

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (pathname === "/admin/login") return NextResponse.next();

  const cookie = req.cookies.get(SESSION_COOKIE)?.value;
  const session = cookie ? await verifySession(cookie) : null;
  if (!session) {
    const url = req.nextUrl.clone();
    url.pathname = "/admin/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*", "/admin"],
};
