import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { instruments, instrumentVersions } from "./schema";
import { freshTestDb } from "./test-helpers";

let ctx: Awaited<ReturnType<typeof freshTestDb>>;

beforeAll(async () => {
  ctx = await freshTestDb();
}, 60_000);

afterAll(async () => {
  await ctx.pool.end();
});

describe("instrument_versions immutability trigger", () => {
  it("accepts inserts but rejects UPDATE and DELETE", async () => {
    const [inst] = await ctx.db
      .insert(instruments)
      .values({
        slug: "trigger-test",
        type: "survey",
        title: "Trigger test",
        draftDefinition: { schemaVersion: 1 },
      })
      .returning();

    const [version] = await ctx.db
      .insert(instrumentVersions)
      .values({
        instrumentId: inst.id,
        version: 1,
        definition: { schemaVersion: 1, pages: [] },
      })
      .returning();
    expect(version.version).toBe(1);

    // drizzle wraps the pg error; the trigger's message is on error.cause
    const chainMessage = (err: unknown): string => {
      let msg = "";
      for (let e = err; e instanceof Error; e = e.cause as Error) msg += e.message;
      return msg;
    };

    const updateErr = await ctx.db
      .update(instrumentVersions)
      .set({ definition: { schemaVersion: 1, tampered: true } })
      .where(eq(instrumentVersions.id, version.id))
      .then(() => null)
      .catch((e: unknown) => e);
    expect(chainMessage(updateErr)).toMatch(/immutable/);

    const deleteErr = await ctx.db
      .delete(instrumentVersions)
      .where(eq(instrumentVersions.id, version.id))
      .then(() => null)
      .catch((e: unknown) => e);
    expect(chainMessage(deleteErr)).toMatch(/immutable/);

    // row is untouched
    const rows = await ctx.db
      .select()
      .from(instrumentVersions)
      .where(eq(instrumentVersions.id, version.id));
    expect(rows).toHaveLength(1);
    expect(rows[0].definition).toEqual({ schemaVersion: 1, pages: [] });
  });

  it("enforces one row per (instrument, version)", async () => {
    const [inst] = await ctx.db
      .insert(instruments)
      .values({
        slug: "uq-test",
        type: "poll",
        title: "Uniqueness test",
        draftDefinition: { schemaVersion: 1 },
      })
      .returning();

    await ctx.db.insert(instrumentVersions).values({
      instrumentId: inst.id,
      version: 1,
      definition: {},
    });
    await expect(
      ctx.db.insert(instrumentVersions).values({
        instrumentId: inst.id,
        version: 1,
        definition: {},
      }),
    ).rejects.toThrow();
  });
});
