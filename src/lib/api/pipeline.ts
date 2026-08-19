/**
 * defineRoute() — the one pipeline every endpoint flows through
 * (N8E-API-SPEC §2, §5.2): requestId → rate limit → authN → authZ (scopes) →
 * zod-validate → handler → envelope. Route files contain no logic.
 */
import { NextRequest, NextResponse } from "next/server";
import { ulid } from "ulidx";
import { z } from "zod";
import { getDb, type Db } from "../db/client";
import { appendAudit, type AuditEntry } from "../services/audit";
import { originAllowed, resolveIdentity } from "./auth";
import { fail, ok } from "./envelope";
import { ApiError } from "./errors";
import { checkRateLimit, hashIp, type RateClass } from "./ratelimit";
import { identityHasScope, type Identity, type Scope } from "./scopes";

export type RouteContext<P, Q, B> = {
  requestId: string;
  identity: Identity;
  params: P;
  query: Q;
  body: B;
  db: Db;
  req: NextRequest;
  audit: (entry: AuditEntry) => Promise<void>;
  now: () => Date;
};

export type RouteResult =
  unknown | { data: unknown; meta?: Record<string, unknown>; cookies?: CookieSet[] };

export type CookieSet = {
  name: string;
  value: string;
  options: {
    httpOnly?: boolean;
    sameSite?: "lax" | "strict" | "none";
    secure?: boolean;
    path?: string;
    maxAge?: number;
  };
};

export type RouteDefinition<P, Q, B> = {
  /** Required scope; omit for public/anonymous endpoints. */
  scope?: Scope;
  /** Identity plane this route serves. Default: 'session' when scope is admin-y, else 'public'. */
  plane?: "session" | "respondent" | "public";
  rateClass?: RateClass;
  params?: z.ZodType<P>;
  query?: z.ZodType<Q>;
  body?: z.ZodType<B>;
  /** OpenAPI metadata; registry-driven docs land in Phase 1.3. */
  summary?: string;
  handler: (ctx: RouteContext<P, Q, B>) => Promise<RouteResult>;
};

// Route registry: generic contract tests + OpenAPI generation iterate this.
export type RegisteredRoute = {
  summary?: string;
  scope?: Scope;
  plane: string;
  rateClass: RateClass;
};
export const routeRegistry: RegisteredRoute[] = [];

function clientIp(req: NextRequest): string {
  const fwd = req.headers.get("x-forwarded-for");
  return fwd ? fwd.split(",")[0].trim() : "local";
}

function zodFieldErrors(err: z.ZodError): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of err.issues) {
    fields[issue.path.join(".") || "_"] = issue.message;
  }
  return fields;
}

export function defineRoute<P = unknown, Q = unknown, B = unknown>(
  def: RouteDefinition<P, Q, B>,
) {
  const plane =
    def.plane ??
    (def.scope?.startsWith("collect:respond")
      ? "respondent"
      : def.scope
        ? "session"
        : "public");
  const rateClass: RateClass =
    def.rateClass ?? (plane === "session" ? "admin" : "public");
  routeRegistry.push({ summary: def.summary, scope: def.scope, plane, rateClass });

  const route = async function route(
    req: NextRequest,
    routeCtx?: { params?: Promise<Record<string, string>> },
  ): Promise<NextResponse> {
    const requestId = ulid();
    const db = getDb();
    try {
      // rate limit
      const identityForLimit = hashIp(clientIp(req));
      if (!checkRateLimit(rateClass, identityForLimit)) {
        throw new ApiError("core/rate-limited", "Too many requests. Slow down.");
      }

      // authN
      const identity = await resolveIdentity(req, plane);

      // authZ
      if (def.scope && !identityHasScope(identity, def.scope)) {
        throw identity.plane === "anonymous"
          ? new ApiError("core/unauthenticated", "Authentication required.")
          : new ApiError("core/forbidden", "Insufficient scope for this operation.");
      }

      // CSRF origin check on session-plane mutations
      const mutating = !["GET", "HEAD", "OPTIONS"].includes(req.method);
      if (mutating && identity.plane === "session" && !originAllowed(req)) {
        throw new ApiError("auth/origin-mismatch", "Request origin not allowed.");
      }

      // validate
      const rawParams = routeCtx?.params ? await routeCtx.params : {};
      const params = def.params ? def.params.parse(rawParams) : (rawParams as P);
      const rawQuery = Object.fromEntries(req.nextUrl.searchParams.entries());
      const query = def.query ? def.query.parse(rawQuery) : (rawQuery as Q);
      let body = undefined as B;
      if (def.body) {
        const json = await req.json().catch(() => {
          throw new ApiError("core/invalid-request", "Body must be valid JSON.");
        });
        body = def.body.parse(json);
      }

      // handle
      const result = await def.handler({
        requestId,
        identity,
        params,
        query,
        body,
        db,
        req,
        audit: (entry) => appendAudit(db, entry),
        now: () => new Date(),
      });

      // envelope (+ optional cookies)
      const isShaped =
        result !== null &&
        typeof result === "object" &&
        ("data" in result || "cookies" in result);
      const data = isShaped ? (result as { data: unknown }).data : result;
      const meta = isShaped
        ? ((result as { meta?: Record<string, unknown> }).meta ?? {})
        : {};
      const res = NextResponse.json(ok(data, { requestId, ...meta }), {
        status: 200,
        headers: { "x-request-id": requestId },
      });
      if (isShaped) {
        for (const c of (result as { cookies?: CookieSet[] }).cookies ?? []) {
          res.cookies.set(c.name, c.value, c.options);
        }
      }
      return res;
    } catch (err) {
      if (err instanceof z.ZodError) {
        const apiErr = new ApiError(
          "core/invalid-request",
          "Request validation failed.",
          zodFieldErrors(err),
        );
        return NextResponse.json(fail(apiErr, requestId), {
          status: apiErr.status,
          headers: { "x-request-id": requestId },
        });
      }
      if (err instanceof ApiError) {
        return NextResponse.json(fail(err, requestId), {
          status: err.status,
          headers: { "x-request-id": requestId },
        });
      }
      console.error(`[${requestId}]`, err);
      const internal = new ApiError("core/internal", "Something went wrong.");
      return NextResponse.json(fail(internal, requestId), {
        status: 500,
        headers: { "x-request-id": requestId },
      });
    }
  };
  // expose the definition for OpenAPI generation + generic contract tests
  (route as unknown as { apiDef: RouteDefinition<P, Q, B> & { plane: string } }).apiDef =
    { ...def, plane };
  return route;
}
