/**
 * Drizzle schema — authoritative shapes from docs/BUILD-PLAN.md §3.1 plus the
 * N8E API Spec §5.4 additions (api_clients, idempotency_keys — implemented in
 * Phase 6, schema ships now).
 *
 * The immutability trigger on instrument_versions and the response_items
 * expression unique index live in a custom SQL migration
 * (drizzle/0001_immutability_trigger.sql) — never remove them (CLAUDE.md rule 3).
 */
import { sql } from "drizzle-orm";
import {
  bigserial,
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const adminUsers = pgTable("admin_users", {
  id: uuid("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(), // argon2id
  totpSecret: text("totp_secret"), // null until 2FA enrolled
  totpEnabled: boolean("totp_enabled").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
});

export const instruments = pgTable(
  "instruments",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    slug: text("slug").notNull().unique(),
    type: text("type").notNull(),
    title: text("title").notNull(),
    status: text("status").notNull().default("draft"),
    draftDefinition: jsonb("draft_definition").notNull(),
    currentVersion: integer("current_version"),
    theme: jsonb("theme")
      .notNull()
      .default(sql`'{}'::jsonb`),
    settings: jsonb("settings")
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (t) => [
    check(
      "instruments_type_check",
      sql`${t.type} IN ('poll','survey','quiz','feedback','intake')`,
    ),
    check(
      "instruments_status_check",
      sql`${t.status} IN ('draft','live','closed','archived')`,
    ),
  ],
);

export const instrumentVersions = pgTable(
  "instrument_versions",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    instrumentId: uuid("instrument_id")
      .notNull()
      .references(() => instruments.id),
    version: integer("version").notNull(), // 1..n per instrument
    definition: jsonb("definition").notNull(), // IMMUTABLE snapshot
    publishedAt: timestamp("published_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("instrument_versions_instrument_version_uq").on(
      t.instrumentId,
      t.version,
    ),
  ],
);

export const distributions = pgTable(
  "distributions",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    instrumentId: uuid("instrument_id")
      .notNull()
      .references(() => instruments.id),
    kind: text("kind").notNull(), // 'embed' joins in Phase 6
    key: text("key").notNull().unique(), // /s/[key] segment, nanoid 12+
    label: text("label").notNull(),
    opensAt: timestamp("opens_at", { withTimezone: true }),
    closesAt: timestamp("closes_at", { withTimezone: true }),
    responseCap: integer("response_cap"),
    status: text("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("distributions_kind_check", sql`${t.kind} IN ('public','tokenized')`),
    check("distributions_status_check", sql`${t.status} IN ('active','paused','closed')`),
  ],
);

export const tokens = pgTable(
  "tokens",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    distributionId: uuid("distribution_id")
      .notNull()
      .references(() => distributions.id),
    token: text("token").notNull().unique(), // opaque, 24+ chars, constant-time compared
    inviteeEmail: text("invitee_email"),
    inviteeLabel: text("invitee_label"),
    state: text("state").notNull().default("issued"),
    openedAt: timestamp("opened_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [
    check(
      "tokens_state_check",
      sql`${t.state} IN ('issued','opened','partial','completed','void')`,
    ),
    uniqueIndex("tokens_distribution_invitee_uq").on(t.distributionId, t.inviteeEmail),
  ],
);

export const responses = pgTable(
  "responses",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    responseKey: text("response_key").notNull().unique(), // resume handle, httpOnly cookie only
    instrumentId: uuid("instrument_id")
      .notNull()
      .references(() => instruments.id),
    instrumentVersion: integer("instrument_version").notNull(), // PINNED at start
    distributionId: uuid("distribution_id")
      .notNull()
      .references(() => distributions.id),
    tokenId: uuid("token_id").references(() => tokens.id), // null for public
    answers: jsonb("answers")
      .notNull()
      .default(sql`'{}'::jsonb`), // raw truth
    meta: jsonb("meta")
      .notNull()
      .default(sql`'{}'::jsonb`), // no raw IP ever
    status: text("status").notNull().default("partial"),
    score: jsonb("score"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [
    check(
      "responses_status_check",
      sql`${t.status} IN ('partial','completed','disqualified')`,
    ),
    index("responses_instrument_status_idx").on(t.instrumentId, t.status),
    index("responses_distribution_idx").on(t.distributionId),
    index("responses_completed_at_idx").on(t.completedAt),
  ],
);

export const responseItems = pgTable(
  "response_items",
  {
    responseId: uuid("response_id")
      .notNull()
      .references(() => responses.id, { onDelete: "cascade" }),
    questionKey: text("question_key").notNull(),
    optionKey: text("option_key"), // one row per selection for multi-choice
    valueText: text("value_text"),
    valueNumber: numeric("value_number"),
    valueDate: timestamp("value_date", { withTimezone: true }),
    valueJson: jsonb("value_json"),
  },
  (t) => [
    // uniqueness via expression index in custom migration:
    // (response_id, question_key, COALESCE(option_key,''))
    index("response_items_qk_num_idx").on(t.questionKey, t.valueNumber),
    index("response_items_qk_opt_idx").on(t.questionKey, t.optionKey),
  ],
);

export const responseFiles = pgTable("response_files", {
  id: uuid("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  responseId: uuid("response_id").references(() => responses.id),
  questionKey: text("question_key").notNull(),
  s3Key: text("s3_key").notNull(),
  filename: text("filename"),
  sizeBytes: integer("size_bytes"),
  mime: text("mime"),
  scanned: boolean("scanned").default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const auditLog = pgTable("audit_log", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  at: timestamp("at", { withTimezone: true }).defaultNow(),
  actor: text("actor").notNull(), // 'admin' | 'system'
  action: text("action").notNull(), // 'instrument.publish', 'export.csv', 'auth.login', …
  subjectType: text("subject_type"),
  subjectId: text("subject_id"),
  detail: jsonb("detail"),
});

// ——— N8E API Spec §5.4 — machine plane tables (implemented Phase 6, shipped now)

export const apiClients = pgTable("api_clients", {
  id: uuid("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  name: text("name").notNull(), // "n8elabs-cms"
  tokenPrefix: text("token_prefix").notNull(), // "n8e_live_3f9a"
  tokenHash: text("token_hash").notNull(), // argon2id of full token
  scopes: text("scopes").array().notNull(),
  rateLimitPerMin: integer("rate_limit_per_min").notNull().default(120),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
});

export const idempotencyKeys = pgTable("idempotency_keys", {
  key: text("key").primaryKey(),
  clientId: uuid("client_id"),
  response: jsonb("response"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});
