import { z } from "zod";
import { defineRoute } from "@/lib/api/pipeline";
import { duplicateInstrument } from "@/lib/services/instruments";

export const POST = defineRoute({
  scope: "collect:write",
  summary: "Copy the draft as a new instrument",
  params: z.object({ id: z.string().uuid() }),
  handler: async (ctx) => duplicateInstrument(ctx.db, ctx.params.id),
});
