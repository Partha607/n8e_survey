import { z } from "zod";
import { defineRoute } from "@/lib/api/pipeline";
import {
  archiveInstrument,
  deleteInstrument,
  getInstrument,
  updateInstrument,
} from "@/lib/services/instruments";

const params = z.object({ id: z.string().uuid() });

export const GET = defineRoute({
  scope: "collect:read",
  summary: "Read an instrument (admin shape, includes draft)",
  params,
  handler: async (ctx) => getInstrument(ctx.db, ctx.params.id),
});

export const PATCH = defineRoute({
  scope: "collect:write",
  summary: "Update draft definition and/or settings",
  params,
  body: z.object({
    title: z.string().min(1).max(300).optional(),
    slug: z
      .string()
      .min(3)
      .max(60)
      .regex(/^[a-z0-9-]+$/)
      .optional(),
    draftDefinition: z.unknown().optional(),
    settings: z.record(z.string(), z.unknown()).optional(),
    theme: z.record(z.string(), z.unknown()).optional(),
    status: z.enum(["live", "closed"]).optional(),
  }),
  handler: async (ctx) => updateInstrument(ctx.db, ctx.params.id, ctx.body),
});

export const DELETE = defineRoute({
  scope: "collect:write",
  summary: "Archive an instrument, or hard-delete with ?hard=true (zero responses only)",
  params,
  query: z.object({ hard: z.enum(["true", "false"]).optional() }),
  handler: async (ctx) => {
    if (ctx.query.hard === "true") {
      await deleteInstrument(ctx.db, ctx.params.id);
      return { deleted: true };
    }
    return archiveInstrument(ctx.db, ctx.params.id);
  },
});
