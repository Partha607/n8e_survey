/**
 * DB test helpers. Tests run against a real Postgres (compose locally / CI, or
 * any instance named by DATABASE_URL_TEST). Each suite gets a fresh schema:
 * drop + recreate `public`, then apply the real migrations from ./drizzle.
 */
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import path from "node:path";
import { Pool } from "pg";
import * as schema from "./schema";

export const TEST_DATABASE_URL =
  process.env.DATABASE_URL_TEST ??
  "postgres://n8e:n8e_dev_password@localhost:5432/n8e_collect_test";

export async function freshTestDb() {
  const pool = new Pool({ connectionString: TEST_DATABASE_URL, max: 10 });
  await pool.query("DROP SCHEMA IF EXISTS public CASCADE");
  await pool.query("CREATE SCHEMA public");
  await pool.query("DROP SCHEMA IF EXISTS drizzle CASCADE");
  const db = drizzle(pool, { schema });
  await migrate(db, {
    migrationsFolder: path.resolve(__dirname, "../../../drizzle"),
  });
  return { db, pool };
}
