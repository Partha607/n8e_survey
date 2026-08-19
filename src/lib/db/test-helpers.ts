/**
 * DB test helpers. Tests run against a real Postgres (compose locally / CI,
 * or any instance named by DATABASE_URL_TEST). Suites run in parallel
 * workers, so each suite gets its OWN freshly-created database with the real
 * migrations from ./drizzle applied; it is dropped when the suite ends.
 */
import { randomBytes } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import path from "node:path";
import { Pool } from "pg";
import * as schema from "./schema";

export const TEST_DATABASE_URL =
  process.env.DATABASE_URL_TEST ??
  "postgres://n8e:n8e_dev_password@localhost:5432/n8e_collect_test";

export type TestDb = {
  db: ReturnType<typeof drizzle<typeof schema>>;
  pool: Pool & { end: () => Promise<void> };
};

export async function freshTestDb(): Promise<{
  db: ReturnType<typeof drizzle<typeof schema>>;
  pool: { end: () => Promise<void>; query: Pool["query"] };
}> {
  const dbName = `n8e_test_${randomBytes(6).toString("hex")}`;
  const maintenance = new Pool({ connectionString: TEST_DATABASE_URL, max: 1 });
  await maintenance.query(`CREATE DATABASE ${dbName}`);

  const url = new URL(TEST_DATABASE_URL);
  url.pathname = `/${dbName}`;
  const pool = new Pool({ connectionString: url.toString(), max: 10 });
  const db = drizzle(pool, { schema });
  await migrate(db, {
    migrationsFolder: path.resolve(__dirname, "../../../drizzle"),
  });

  return {
    db,
    pool: {
      query: pool.query.bind(pool) as Pool["query"],
      end: async () => {
        await pool.end();
        await maintenance.query(`DROP DATABASE IF EXISTS ${dbName} (FORCE)`);
        await maintenance.end();
      },
    },
  };
}
