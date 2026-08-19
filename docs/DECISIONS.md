# DECISIONS — N8E Collect (ADR-lite)

Format per entry: **Context** → **Decision** → **Consequence**. Record any deviation from `docs/BUILD-PLAN.md` here _before_ coding it.

## 2026-08-19 — Multi-milestone session (owner-approved)

**Context:** CLAUDE.md says one milestone per session. The owner explicitly instructed: "Continue with the remaining phases. After each phase, commit and push."
**Decision:** Run consecutive milestones in this session; conventional commit per milestone, push after each milestone/phase.
**Consequence:** PROGRESS.md still logs per milestone; each milestone's Verify steps still run before its commit.

## 2026-08-19 — Verification database in the build sandbox

**Context:** The build sandbox has the Docker CLI but no Docker daemon, so `docker compose` cannot boot Postgres here.
**Decision:** DB-dependent Verify steps run against a native local PostgreSQL 16.13 instance (same major version as the compose stack) at `postgres://n8e@127.0.0.1:5432/…`. The compose file remains the canonical dev stack.
**Consequence:** Compose boot, deploy drills, and anything needing the AWS box must be re-verified on the dev machine / server; PROGRESS.md marks those explicitly.
