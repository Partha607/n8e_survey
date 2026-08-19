# CLAUDE.md — N8E Collect

You are building **N8E Collect**, N8E Labs' self-hosted data-collection platform (polls, surveys, quizzes, feedback and intake forms). This file is the source of truth for how to work in this repo. `docs/BUILD-PLAN.md` is the source of truth for _what_ to build and in what order. Where they conflict, this file governs conduct; the plan governs content.

## Working method

- Work **one milestone at a time** from `docs/BUILD-PLAN.md` §11. Never start the next milestone in the same session.
- A milestone is done only when its **Verify** steps have been _run_ and pass. Never claim a check passed without running it. If something could not be verified (e.g., needs the AWS box), say so explicitly.
- After each milestone: conventional commit (`feat(scope): …`, `fix:`, `chore:`), one-line entry in `docs/PROGRESS.md`.
- Any deviation from the plan → short entry in `docs/DECISIONS.md` (context → decision → consequence) _before_ coding it.
- Do not refactor outside the current milestone's blast radius. Leave TODOs referencing milestone numbers instead.

## Hard rules (non-negotiable)

1. **Licensing:** only MIT / Apache-2.0 / BSD / ISC dependencies. Check the license BEFORE installing. No GPL/AGPL, no commercial/paid components, no source copied from non-permissive projects. CI runs a license allowlist; do not add exceptions.
2. **Server is the authority.** All validation, logic evaluation, quota/cap enforcement, token state, and scoring happen server-side. Client-side checks are UX sugar only. Never trust request payloads.
3. **Published instrument versions are immutable.** Never UPDATE/DELETE `instrument_versions` rows (a DB trigger enforces this — do not remove it). Responses always pin and join the version they answered.
4. **Question/option keys are stable identity.** Renaming a label keeps its key. A semantic change requires a NEW key. Publish-time invariants enforce this — never weaken them.
5. **Hidden answers are stripped server-side.** If logic hides a question, its stored answer is deleted on the server, not merely hidden in the UI.
6. **Respondent routes stay lean.** Route group `(respondent)` must not import from `components/admin`, ECharts, or heavy deps. CI enforces ≤120KB gzipped JS on `/s/[key]` — treat a gate failure as a design error, not a number to raise.
7. **Branding is not optional.** Every respondent screen renders `BrandFrame`: N8E logo (never recolored/filtered/redrawn), link to https://n8elabs.com, and the line "Your responses go to N8E Labs". Fixed strings never paraphrased: `IN DATA VERITAS`, `FOR INDIA, BY NORTHEASTERN INDIA.`
8. **Brand bans (from n8elabs.com system):** no gradients, gradient text, glows, neon blobs, grey-heavy UI; no cyberpunk/synthwave/HUD/CRT/grid-floor aesthetics. Accent color is a signal, not a paint bucket. Motion must have a reason; respect `prefers-reduced-motion`.
9. **Privacy:** never store raw IPs (salted daily-rotating hash only). No third-party scripts or trackers on respondent pages. Consent text and retention settings are product features — do not stub them out.
10. **Migrations are additive** within a release; destructive changes ship one release later. Every migration must be runnable on a fresh DB and on the previous release's DB.
11. **No new top-level architecture** (new services, containers, datastores, auth models, multi-tenancy) without a DECISIONS.md entry approved by the owner. This is a single-box, single-admin product by design.
12. **Honest reporting.** Never state that UI was visually verified unless a screenshot/e2e actually ran. Name missing files instead of guessing their contents.

## Commands

- `pnpm dev` — dev server · `pnpm test` — unit (Vitest) · `pnpm e2e` — Playwright · `pnpm lint` / `pnpm typecheck`
- `docker compose -f docker/docker-compose.yml up -d` — local stack (Postgres)
- `pnpm drizzle:generate` / `pnpm drizzle:migrate` — migrations
- Dev machine is **Windows + Docker Desktop**: write cross-platform Node scripts, never bash-only tooling, for anything developers run directly.

## Architecture memory (read the plan for detail)

- **The N8E API is a first-class product** (docs/N8E-API-SPEC.md): product-first versioned namespaces (`/api/collect/v1`, `/api/core/v1`), one envelope, one pipeline (`defineRoute` in `src/lib/api`), HTTP-free services in `src/lib/services`. Route files contain zero logic. Future N8E apps (CMS, management tools) will consume these same contracts — build every endpoint like a second consumer is watching. Do NOT build gateways/microservices for that future (API spec §6.3 decision rule).
- One Next.js app, three surfaces: `(respondent)/s/[key]`, `/admin`, `/api` (N8E API — all writes).
- One engine: `src/lib/engine` is pure and isomorphic; the same golden test vectors run against client and API. Field bugs become new vectors.
- Responses: raw JSONB (`responses.answers`, source of truth) + rebuildable projection (`response_items`) for analytics. Aggregation happens in SQL, never in the browser.
- Jobs: pg-boss inside Postgres (no Redis). Workers are idempotent.
- Email: SES only (as collect@n8elabs.com). Never send via Gmail SMTP.
- Cap/token races: enforced inside the `complete` transaction with row locks — there are tests that prove it; keep them passing.

## Definition of done (every milestone)

Tests written and green in CI · typecheck + lint clean · a11y not regressed (axe in e2e) · bundle gate green · PROGRESS.md updated · honest Verify report.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
