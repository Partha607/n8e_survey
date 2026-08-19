# PROGRESS — N8E Collect

One line per milestone: date · milestone · status · deviations.

- 2026-08-19 · **0.1 Repo + toolchain** · DONE · Next.js 16.3 (plan says 15+), TS strict, Tailwind 4, ESLint/Prettier, Vitest, Playwright, husky+lint-staged, docker compose (postgres + app dev profile), tokens.css stub, docs in place. Verified: unit + e2e green, lint/typecheck clean, dev server serves. NOT verified here: `docker compose` postgres boot (no Docker daemon in the build sandbox — re-run on the dev machine).
- 2026-08-19 · **0.2 DB layer** · DONE · Drizzle schema for all §3.1 tables + api_clients/idempotency_keys (API spec §5.4), immutability trigger + response_items expression unique index (custom migration), seed script (admin from env + demo survey). Verified: migrate clean on fresh DB, trigger rejects UPDATE/DELETE (unit-tested vs real Postgres 16.13), seed idempotent, typecheck/lint clean.
