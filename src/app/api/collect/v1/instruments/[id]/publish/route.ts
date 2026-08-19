import { z } from "zod";
import { defineRoute } from "@/lib/api/pipeline";
import { publishInstrument } from "@/lib/services/instruments";

export const POST = defineRoute({
  scope: "collect:write",
  summary:
    "Validate invariants and snapshot an immutable version; returns a diff + confirmation demand when responses exist on the current version",
  params: z.object({ id: z.string().uuid() }),
  body: z.object({ confirm: z.boolean().optional() }).optional().default({}),
  handler: async (ctx) => publishInstrument(ctx.db, ctx.params.id, ctx.body ?? {}),
});
