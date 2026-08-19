# N8E Collect

N8E Labs' self-hosted data-collection platform: polls, surveys, quizzes, feedback and intake forms — one engine, one Postgres, unlimited instruments.

`IN DATA VERITAS` · `FOR INDIA, BY NORTHEASTERN INDIA.`

## Source-of-truth documents

- `CLAUDE.md` — repo conduct (how to work here)
- `docs/BUILD-PLAN.md` — what to build, in what order (§11 milestones)
- `docs/N8E-API-SPEC.md` — the N8E API contract
- `docs/SRS.md` — requirements baseline (SRS-COLLECT-1.0)
- `docs/PROGRESS.md` / `docs/DECISIONS.md` — milestone log / ADR-lite deviations

## Development

Requires Node 22+, pnpm 10, Docker (Desktop on Windows).

```sh
pnpm install
docker compose -f docker/docker-compose.yml up -d   # Postgres 16
pnpm dev                                            # http://localhost:3000
```

- `pnpm test` — unit tests (Vitest)
- `pnpm e2e` — Playwright end-to-end tests
- `pnpm lint` / `pnpm typecheck` / `pnpm format`

All developer-run scripts are cross-platform Node — no bash-only tooling.
