/**
 * Append-only audit log at the app layer (FR-PRIV-01). Every admin mutation,
 * auth event, and export appends here.
 */
import { desc, eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { auditLog } from "../db/schema";

export type AuditEntry = {
  actor: "admin" | "system";
  action: string; // 'instrument.publish', 'export.csv', 'auth.login', …
  subjectType?: string;
  subjectId?: string;
  detail?: Record<string, unknown>;
};

// Db and transaction handles share the query interface we need.
type DbLike = Pick<Db, "insert" | "select">;

export async function appendAudit(db: DbLike, entry: AuditEntry): Promise<void> {
  await db.insert(auditLog).values({
    actor: entry.actor,
    action: entry.action,
    subjectType: entry.subjectType,
    subjectId: entry.subjectId,
    detail: entry.detail,
  });
}

export async function listAudit(db: DbLike, opts: { limit: number; action?: string }) {
  const base = db.select().from(auditLog);
  const query = opts.action ? base.where(eq(auditLog.action, opts.action)) : base;
  return query.orderBy(desc(auditLog.id)).limit(opts.limit);
}
