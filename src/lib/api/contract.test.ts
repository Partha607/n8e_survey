/**
 * Generic contract tests (N8E-API-SPEC §5.5): iterate every route file and
 * assert scope enforcement and envelope shape without per-route code.
 */
import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

const API_ROOT = path.resolve(__dirname, "../../app/api");
const METHODS = ["GET", "POST", "PATCH", "PUT", "DELETE"] as const;

function findRouteFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...findRouteFiles(full));
    else if (entry === "route.ts") out.push(full);
  }
  return out;
}

function urlFor(file: string): string {
  const rel = path.relative(API_ROOT, path.dirname(file)).split(path.sep).join("/");
  // substitute UUID-ish values for params so zod param parsing isn't the failure
  return (
    "http://localhost/api/" +
    rel
      .split("/")
      .map((seg) => (seg.startsWith("[") ? "00000000-0000-4000-8000-000000000000" : seg))
      .join("/")
  );
}

type RouteHandler = ((req: NextRequest, ctx?: unknown) => Promise<Response>) & {
  apiDef?: { scope?: string; plane?: string };
};

const files = findRouteFiles(API_ROOT);

describe("route registry contract", () => {
  it("found route files", () => {
    expect(files.length).toBeGreaterThan(5);
  });

  for (const file of files) {
    const rel = path.relative(API_ROOT, file);
    describe(rel, () => {
      for (const method of METHODS) {
        it(`${method}: anonymous requests never reach scoped handlers`, async () => {
          const mod = (await import(file)) as Record<string, RouteHandler>;
          const handler = mod[method];
          if (!handler?.apiDef) return; // method not exported
          const def = handler.apiDef;
          const req = new NextRequest(urlFor(file), {
            method,
            headers: { "x-forwarded-for": `contract-test-${rel}-${method}` },
          });
          const res = await handler(req, {
            params: Promise.resolve({ id: "00000000-0000-4000-8000-000000000000" }),
          });
          const json = (await res.json()) as {
            data?: unknown;
            error?: { code: string; requestId: string };
            meta?: { requestId: string };
          };
          // envelope shape always holds
          expect(res.headers.get("x-request-id")).toBeTruthy();
          expect(json.data !== undefined || json.error !== undefined).toBe(true);

          if (def.scope && def.plane !== "respondent" && def.plane !== "public") {
            // session-scoped route hit anonymously → 401 with stable code
            expect(res.status).toBe(401);
            expect(json.error?.code).toBe("core/unauthenticated");
            expect(json.error?.requestId).toBeTruthy();
          }
        });
      }
    });
  }
});
