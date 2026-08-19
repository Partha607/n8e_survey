import { z } from "zod";
import { defineRoute } from "@/lib/api/pipeline";
import { listVersions } from "@/lib/services/instruments";

export const GET = defineRoute({
  scope: "collect:read",
  summary: "Version history with response counts (FR-INST-09)",
  params: z.object({ id: z.string().uuid() }),
  handler: async (ctx) => listVersions(ctx.db, ctx.params.id),
});
