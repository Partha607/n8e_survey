# DECISIONS — N8E Collect (ADR-lite)

Format per entry: **Context** → **Decision** → **Consequence**. Record any deviation from `docs/BUILD-PLAN.md` here _before_ coding it.

## 2026-08-19 — Multi-milestone session (owner-approved)

**Context:** CLAUDE.md says one milestone per session. The owner explicitly instructed: "Continue with the remaining phases. After each phase, commit and push."
**Decision:** Run consecutive milestones in this session; conventional commit per milestone, push after each milestone/phase.
**Consequence:** PROGRESS.md still logs per milestone; each milestone's Verify steps still run before its commit.

## 2026-08-19 — License gate: sharp removed; caniuse-lite exemption

**Context:** The allowlist is MIT/Apache-2.0/BSD/ISC. Next.js optionally pulls `sharp` (whose libvips binary is LGPL-3.0) and, like every browserslist-based toolchain, depends on the `caniuse-lite` data file (CC-BY-4.0, attribution-only).
**Decision:** `sharp` is excluded via pnpm `ignoredOptionalDependencies` (we don't use Next image optimization). `caniuse-lite` gets a single package-scoped exemption in `scripts/check-licenses.mjs` — per-package, not per-license, so nothing else can ride in under CC-BY-4.0. Needs owner sign-off; flagged rather than silently allowed.
**Consequence:** CI license gate is green with zero copyleft; if image optimization is ever needed, revisit sharp with an owner decision.

**Addendum (same day):** the mandated toolchain itself carries licenses outside the four-name allowlist — Tailwind 4 requires `lightningcss` (MPL-2.0) and the plan's a11y gate requires axe (MPL-2.0); eslint's tree includes `argparse` (Python-2.0), `language-subtag-registry` (CC0-1.0), `minimatch` (BlueOak-1.0.0). All are permissive/file-scoped, none GPL/AGPL/LGPL, none ship in the product. The gate is therefore two-tier: **product dependencies strictly MIT/Apache-2.0/BSD/ISC** (+ named per-package exemptions); **dev tooling** additionally may use the bounded set {MPL-2.0, Python-2.0, CC0-1.0, BlueOak-1.0.0, CC-BY-4.0}. GPL/AGPL/LGPL fail everywhere. Needs owner sign-off.

## 2026-08-19 — Verification database in the build sandbox

**Context:** The build sandbox has the Docker CLI but no Docker daemon, so `docker compose` cannot boot Postgres here.
**Decision:** DB-dependent Verify steps run against a native local PostgreSQL 16.13 instance (same major version as the compose stack) at `postgres://n8e@127.0.0.1:5432/…`. The compose file remains the canonical dev stack.
**Consequence:** Compose boot, deploy drills, and anything needing the AWS box must be re-verified on the dev machine / server; PROGRESS.md marks those explicitly.
