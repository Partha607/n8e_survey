/**
 * Seed: admin user (from env) + one demo survey instrument.
 * Cross-platform Node script — run with `pnpm db:seed`.
 * Idempotent: re-running updates the admin password hash and skips existing demo data.
 */
import "dotenv/config";
import argon2 from "argon2";
import { sql } from "drizzle-orm";
import { getDb, getPool } from "../src/lib/db/client";
import { adminUsers, instruments } from "../src/lib/db/schema";

const DEMO_DEFINITION = {
  schemaVersion: 1,
  mode: "conversational",
  pages: [
    {
      key: "page_1",
      title: "About you",
      questions: [
        {
          key: "q_name",
          type: "short_text",
          label: "What should we call you?",
          required: true,
          validation: { max: 80 },
        },
        {
          key: "q_region",
          type: "single_choice",
          label: "Which state are you responding from?",
          required: true,
          options: [
            { key: "opt_as", label: "Assam" },
            { key: "opt_ml", label: "Meghalaya" },
            { key: "opt_mn", label: "Manipur" },
            { key: "opt_other", label: "Other" },
          ],
        },
      ],
    },
    {
      key: "page_2",
      title: "Your experience",
      questions: [
        {
          key: "q_nps",
          type: "nps",
          label: "How likely are you to recommend N8E Labs?",
          required: true,
        },
        {
          key: "q_feedback",
          type: "long_text",
          label: "Anything else you want to tell us?",
          required: false,
          validation: { max: 2000 },
        },
      ],
    },
  ],
  logic: [
    {
      id: "rule_1",
      when: {
        op: "and",
        clauses: [{ q: "q_nps", cmp: "lte", value: 6 }],
      },
      action: { kind: "show_question", target: "q_feedback" },
    },
  ],
  presentation: { showProgress: true },
};

async function main() {
  const email = process.env.ADMIN_EMAIL ?? "admin@n8elabs.com";
  const password = process.env.ADMIN_PASSWORD;
  if (!password) {
    console.error("ADMIN_PASSWORD env var is required to seed the admin user.");
    process.exit(1);
  }

  const db = getDb();
  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });

  await db
    .insert(adminUsers)
    .values({ email, passwordHash })
    .onConflictDoUpdate({ target: adminUsers.email, set: { passwordHash } });
  console.log(`admin user ready: ${email}`);

  await db
    .insert(instruments)
    .values({
      slug: "demo-survey",
      type: "survey",
      title: "N8E Demo Survey",
      draftDefinition: DEMO_DEFINITION,
      settings: {
        consentText:
          "By continuing you consent to N8E Labs storing your answers for this survey.",
        retentionDays: 365,
      },
    })
    .onConflictDoNothing({ target: instruments.slug });
  console.log("demo survey instrument ready: demo-survey");

  // sanity: confirm both rows exist
  const counts = await db.execute(
    sql`select (select count(*) from admin_users) as admins, (select count(*) from instruments) as instruments`,
  );
  console.log("seed complete:", counts.rows[0]);
  await getPool().end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
