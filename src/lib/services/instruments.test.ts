import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { instrumentDefinitionSchema } from "../schema";
import { responses, distributions } from "../db/schema";
import { freshTestDb } from "../db/test-helpers";
import {
  archiveInstrument,
  createInstrument,
  deleteInstrument,
  duplicateInstrument,
  getInstrument,
  getPublishedDefinition,
  listVersions,
  publishInstrument,
  updateInstrument,
} from "./instruments";

let ctx: Awaited<ReturnType<typeof freshTestDb>>;

beforeAll(async () => {
  ctx = await freshTestDb();
}, 60_000);

afterAll(async () => {
  await ctx.pool.end();
});

describe("instrument lifecycle (1.3 acceptance)", () => {
  it("publish → edit → publish yields v1, v2; v1 stays immutable", async () => {
    const inst = await createInstrument(ctx.db, { type: "survey", title: "Lifecycle" });
    expect(inst.status).toBe("draft");

    const first = await publishInstrument(ctx.db, inst.id);
    expect(first).toMatchObject({ published: true, version: 1 });

    // edit the draft (relabel keeps the key)
    const def = instrumentDefinitionSchema.parse(inst.draftDefinition);
    def.pages[0].questions[0].label = "First question (edited)";
    await updateInstrument(ctx.db, inst.id, { draftDefinition: def });

    const second = await publishInstrument(ctx.db, inst.id);
    expect(second).toMatchObject({ published: true, version: 2 });
    if (second.published) {
      expect(second.diff?.relabeledQuestions[0]).toMatchObject({ key: "q_1" });
    }

    // v1 definition still the original
    const v1 = await getPublishedDefinition(ctx.db, inst.id, 1);
    expect(v1.pages[0].questions[0].label).toBe("First question");

    const versions = await listVersions(ctx.db, inst.id);
    expect(versions.map((v) => v.version)).toEqual([2, 1]);
  });

  it("rejects invalid definitions with field errors", async () => {
    const inst = await createInstrument(ctx.db, { type: "survey", title: "Bad def" });
    const def = instrumentDefinitionSchema.parse(inst.draftDefinition);
    def.logic.push({
      id: "r_bad",
      when: { op: "and", clauses: [{ q: "q_ghost", cmp: "answered" }] },
      action: { kind: "hide_question", target: "q_1" },
    });
    await updateInstrument(ctx.db, inst.id, { draftDefinition: def });
    await expect(publishInstrument(ctx.db, inst.id)).rejects.toMatchObject({
      code: "instrument/invalid-definition",
    });
  });

  it("publishing over collected responses demands confirmation with a diff", async () => {
    const inst = await createInstrument(ctx.db, { type: "poll", title: "Confirm" });
    await publishInstrument(ctx.db, inst.id);

    const [dist] = await ctx.db
      .insert(distributions)
      .values({
        instrumentId: inst.id,
        kind: "public",
        key: "confirmtest12",
        label: "test",
      })
      .returning();
    await ctx.db.insert(responses).values({
      responseKey: "resp_confirm_1",
      instrumentId: inst.id,
      instrumentVersion: 1,
      distributionId: dist.id,
    });

    const fresh = await getInstrument(ctx.db, inst.id);
    const def = instrumentDefinitionSchema.parse(fresh.draftDefinition);
    def.pages[0].questions[0].label = "Changed question";
    await updateInstrument(ctx.db, inst.id, { draftDefinition: def });

    const attempt = await publishInstrument(ctx.db, inst.id);
    expect(attempt).toMatchObject({
      published: false,
      requiresConfirmation: true,
      responseCountOnCurrent: 1,
    });

    const confirmed = await publishInstrument(ctx.db, inst.id, { confirm: true });
    expect(confirmed).toMatchObject({ published: true, version: 2 });
  });

  it("hard delete works with zero responses, blocked with responses, archive always works", async () => {
    // never-published, zero responses → deletable
    const fresh = await createInstrument(ctx.db, {
      type: "feedback",
      title: "Delete me",
    });
    await deleteInstrument(ctx.db, fresh.id);
    await expect(getInstrument(ctx.db, fresh.id)).rejects.toMatchObject({
      code: "instrument/not-found",
    });

    // with responses → blocked
    const used = await createInstrument(ctx.db, { type: "feedback", title: "Used" });
    await publishInstrument(ctx.db, used.id);
    const [dist] = await ctx.db
      .insert(distributions)
      .values({ instrumentId: used.id, kind: "public", key: "deltest123456", label: "t" })
      .returning();
    await ctx.db.insert(responses).values({
      responseKey: "resp_del_1",
      instrumentId: used.id,
      instrumentVersion: 1,
      distributionId: dist.id,
    });
    await expect(deleteInstrument(ctx.db, used.id)).rejects.toMatchObject({
      code: "instrument/has-responses",
    });

    // archive works and freezes edits
    const archived = await archiveInstrument(ctx.db, used.id);
    expect(archived.status).toBe("archived");
    await expect(
      updateInstrument(ctx.db, used.id, { title: "nope" }),
    ).rejects.toMatchObject({ code: "instrument/archived" });
  });

  it("duplicate copies the draft as a new draft instrument", async () => {
    const inst = await createInstrument(ctx.db, { type: "quiz", title: "Original" });
    const copy = await duplicateInstrument(ctx.db, inst.id);
    expect(copy.id).not.toBe(inst.id);
    expect(copy.status).toBe("draft");
    expect(copy.title).toBe("Original (copy)");
    expect(copy.draftDefinition).toEqual(inst.draftDefinition);
  });

  it("slug locks after first publish", async () => {
    const inst = await createInstrument(ctx.db, { type: "survey", title: "Sluggy" });
    await updateInstrument(ctx.db, inst.id, { slug: "before-publish" });
    await publishInstrument(ctx.db, inst.id);
    await expect(
      updateInstrument(ctx.db, inst.id, { slug: "after-publish" }),
    ).rejects.toMatchObject({ code: "core/conflict" });
  });
});
