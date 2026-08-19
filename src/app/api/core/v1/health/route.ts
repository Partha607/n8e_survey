import { sql } from "drizzle-orm";
import { defineRoute } from "@/lib/api/pipeline";

export const GET = defineRoute({
  plane: "public",
  summary: "Liveness/readiness: verifies DB connectivity",
  handler: async (ctx) => {
    await ctx.db.execute(sql`select 1`);
    // TODO(milestone 2.4): include pg-boss queue health once workers exist
    return { data: { status: "ok", db: "ok" } };
  },
});
