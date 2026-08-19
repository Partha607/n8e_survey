/**
 * Instruments domain service (FR-INST-*). HTTP-free (N8E-API-SPEC §5.3).
 * Publishing snapshots an immutable version (DB trigger enforces); publishing
 * over collected responses requires explicit confirmation with a diff
 * (FR-INST-05).
 */
import { and, count, desc, eq, sql } from "drizzle-orm";
import { customAlphabet } from "nanoid";
import { ApiError } from "../api/errors";
import type { Db } from "../db/client";
import { instrumentVersions, instruments, responses } from "../db/schema";
import {
  diffDefinitions,
  instrumentDefinitionSchema,
  presetFor,
  validatePublishInvariants,
  type DefinitionDiff,
  type InstrumentDefinition,
  type InstrumentType,
} from "../schema";
import { appendAudit } from "./audit";

const slugAlphabet = customAlphabet("abcdefghijklmnopqrstuvwxyz0123456789", 8);

export async function listInstruments(db: Db) {
  const rows = await db
    .select({
      id: instruments.id,
      slug: instruments.slug,
      type: instruments.type,
      title: instruments.title,
      status: instruments.status,
      currentVersion: instruments.currentVersion,
      createdAt: instruments.createdAt,
      updatedAt: instruments.updatedAt,
      responseCount: sql<number>`(
        select count(*)::int from ${responses} r where r.instrument_id = ${instruments.id}
      )`,
      completedCount: sql<number>`(
        select count(*)::int from ${responses} r
        where r.instrument_id = ${instruments.id} and r.status = 'completed'
      )`,
    })
    .from(instruments)
    .orderBy(desc(instruments.updatedAt));
  return rows;
}

export async function createInstrument(
  db: Db,
  input: { type: InstrumentType; title: string; slug?: string },
) {
  const slug = input.slug ?? `${input.type}-${slugAlphabet()}`;
  const [row] = await db
    .insert(instruments)
    .values({
      slug,
      type: input.type,
      title: input.title,
      draftDefinition: presetFor(input.type),
      settings: {
        consentText:
          "By continuing you consent to N8E Labs storing your answers for this instrument.",
        retentionDays: 365,
      },
    })
    .returning()
    .catch((err: unknown) => {
      if (err instanceof Error && err.message.includes("duplicate key")) {
        throw new ApiError("core/conflict", `Slug "${slug}" is already in use.`);
      }
      throw err;
    });
  await appendAudit(db, {
    actor: "admin",
    action: "instrument.create",
    subjectType: "instrument",
    subjectId: row.id,
    detail: { type: input.type, title: input.title },
  });
  return row;
}

export async function getInstrument(db: Db, id: string) {
  const [row] = await db.select().from(instruments).where(eq(instruments.id, id));
  if (!row) throw new ApiError("instrument/not-found", "Instrument not found.");
  return row;
}

export async function getPublishedDefinition(
  db: Db,
  instrumentId: string,
  version: number,
): Promise<InstrumentDefinition> {
  const [row] = await db
    .select()
    .from(instrumentVersions)
    .where(
      and(
        eq(instrumentVersions.instrumentId, instrumentId),
        eq(instrumentVersions.version, version),
      ),
    );
  if (!row) throw new ApiError("instrument/not-published", "Version not found.");
  return instrumentDefinitionSchema.parse(row.definition);
}

export type UpdateDraftInput = {
  title?: string;
  slug?: string;
  draftDefinition?: unknown;
  settings?: Record<string, unknown>;
  theme?: Record<string, unknown>;
  status?: "live" | "closed";
};

export async function updateInstrument(db: Db, id: string, input: UpdateDraftInput) {
  const existing = await getInstrument(db, id);
  if (existing.archivedAt) {
    throw new ApiError("instrument/archived", "Archived instruments are read-only.");
  }
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (input.title !== undefined) patch.title = input.title;
  if (input.slug !== undefined) {
    if (existing.currentVersion) {
      throw new ApiError(
        "core/conflict",
        "Slug is locked once an instrument has been published.",
      );
    }
    patch.slug = input.slug;
  }
  if (input.draftDefinition !== undefined) {
    // shape-validate now; full invariants run at publish
    patch.draftDefinition = instrumentDefinitionSchema.parse(input.draftDefinition);
  }
  if (input.settings !== undefined) patch.settings = input.settings;
  if (input.theme !== undefined) patch.theme = input.theme;
  if (input.status !== undefined) {
    if (!existing.currentVersion) {
      throw new ApiError("instrument/not-published", "Publish before going live.");
    }
    patch.status = input.status;
  }
  const [row] = await db
    .update(instruments)
    .set(patch)
    .where(eq(instruments.id, id))
    .returning();
  await appendAudit(db, {
    actor: "admin",
    action: "instrument.update",
    subjectType: "instrument",
    subjectId: id,
    detail: { fields: Object.keys(patch) },
  });
  return row;
}

export type PublishResult =
  | { published: true; version: number; diff: DefinitionDiff | null }
  | {
      published: false;
      requiresConfirmation: true;
      responseCountOnCurrent: number;
      currentVersion: number;
      diff: DefinitionDiff;
    };

export async function publishInstrument(
  db: Db,
  id: string,
  opts: { confirm?: boolean } = {},
): Promise<PublishResult> {
  const instrument = await getInstrument(db, id);
  if (instrument.archivedAt) {
    throw new ApiError("instrument/archived", "Archived instruments cannot publish.");
  }

  const draft = instrumentDefinitionSchema.parse(instrument.draftDefinition);
  const previous = instrument.currentVersion
    ? await getPublishedDefinition(db, id, instrument.currentVersion)
    : null;

  const invariants = validatePublishInvariants(draft, previous);
  if (!invariants.ok) {
    throw new ApiError(
      "instrument/invalid-definition",
      "The definition fails publish invariants.",
      invariants.fieldErrors,
    );
  }

  const diff = previous ? diffDefinitions(previous, draft) : null;

  // FR-INST-05: publishing over collected responses needs explicit confirm
  if (instrument.currentVersion && !opts.confirm) {
    const [{ value: responseCount }] = await db
      .select({ value: count() })
      .from(responses)
      .where(
        and(
          eq(responses.instrumentId, id),
          eq(responses.instrumentVersion, instrument.currentVersion),
        ),
      );
    if (responseCount > 0) {
      return {
        published: false,
        requiresConfirmation: true,
        responseCountOnCurrent: responseCount,
        currentVersion: instrument.currentVersion,
        diff: diff!,
      };
    }
  }

  const nextVersion = (instrument.currentVersion ?? 0) + 1;
  const published = await db.transaction(async (tx) => {
    await tx.insert(instrumentVersions).values({
      instrumentId: id,
      version: nextVersion,
      definition: draft,
    });
    await tx
      .update(instruments)
      .set({ currentVersion: nextVersion, status: "live", updatedAt: new Date() })
      .where(eq(instruments.id, id));
    return nextVersion;
  });
  await appendAudit(db, {
    actor: "admin",
    action: "instrument.publish",
    subjectType: "instrument",
    subjectId: id,
    detail: { version: published },
  });
  return { published: true, version: published, diff };
}

export async function duplicateInstrument(db: Db, id: string) {
  const source = await getInstrument(db, id);
  const [copy] = await db
    .insert(instruments)
    .values({
      slug: `${source.slug.slice(0, 40)}-copy-${slugAlphabet()}`,
      type: source.type,
      title: `${source.title} (copy)`,
      draftDefinition: source.draftDefinition,
      settings: source.settings,
      theme: source.theme,
    })
    .returning();
  await appendAudit(db, {
    actor: "admin",
    action: "instrument.duplicate",
    subjectType: "instrument",
    subjectId: copy.id,
    detail: { sourceId: id },
  });
  return copy;
}

export async function archiveInstrument(db: Db, id: string) {
  await getInstrument(db, id);
  const [row] = await db
    .update(instruments)
    .set({ status: "archived", archivedAt: new Date(), updatedAt: new Date() })
    .where(eq(instruments.id, id))
    .returning();
  await appendAudit(db, {
    actor: "admin",
    action: "instrument.archive",
    subjectType: "instrument",
    subjectId: id,
  });
  return row;
}

/** Hard delete — only while zero responses exist (FR-INST-07). */
export async function deleteInstrument(db: Db, id: string) {
  await getInstrument(db, id);
  const [{ value: responseCount }] = await db
    .select({ value: count() })
    .from(responses)
    .where(eq(responses.instrumentId, id));
  if (responseCount > 0) {
    throw new ApiError(
      "instrument/has-responses",
      `Cannot hard-delete: ${responseCount} responses exist. Archive instead.`,
    );
  }
  // published versions are immutable (trigger blocks DELETE, FK blocks the
  // parent), so an instrument that ever published can only be archived.
  await db
    .delete(instruments)
    .where(eq(instruments.id, id))
    .catch(() => {
      throw new ApiError(
        "instrument/version-immutable",
        "Published instruments cannot be hard-deleted — archive instead.",
      );
    });
  await appendAudit(db, {
    actor: "admin",
    action: "instrument.delete",
    subjectType: "instrument",
    subjectId: id,
  });
}

export async function listVersions(db: Db, instrumentId: string) {
  await getInstrument(db, instrumentId);
  const rows = await db
    .select({
      version: instrumentVersions.version,
      publishedAt: instrumentVersions.publishedAt,
      responseCount: sql<number>`(
        select count(*)::int from ${responses} r
        where r.instrument_id = ${instrumentVersions.instrumentId}
          and r.instrument_version = ${instrumentVersions.version}
      )`,
    })
    .from(instrumentVersions)
    .where(eq(instrumentVersions.instrumentId, instrumentId))
    .orderBy(desc(instrumentVersions.version));
  return rows;
}
