import { z } from "zod";
import { defineRoute } from "@/lib/api/pipeline";
import { INSTRUMENT_TYPES } from "@/lib/schema";
import { createInstrument, listInstruments } from "@/lib/services/instruments";

export const GET = defineRoute({
  scope: "collect:read",
  summary: "List instruments with live stats",
  handler: async (ctx) => listInstruments(ctx.db),
});

export const POST = defineRoute({
  scope: "collect:write",
  summary: "Create an instrument from a type preset",
  body: z.object({
    type: z.enum(INSTRUMENT_TYPES),
    title: z.string().min(1).max(300),
    slug: z
      .string()
      .min(3)
      .max(60)
      .regex(/^[a-z0-9-]+$/)
      .optional(),
  }),
  handler: async (ctx) => createInstrument(ctx.db, ctx.body),
});
