# N8E Collect — End-to-End Build Plan for Claude Code

**Version:** 1.0 · **Date:** 19 Aug 2026 · **Owner:** N8E Labs · **Companion:** `CLAUDE.md` (repo conventions file, shipped alongside this plan)
**Product spec reference:** N8E Forum project → `claude/product-spec.md` (v0.3). Where this plan and the spec disagree, the spec's _decisions_ win; this plan's _engineering detail_ wins.

---

## 0. How to drive Claude Code with this plan

This document is written to be executed phase-by-phase by Claude Code on the N8E dev machine (Windows + Docker). Working method:

1. Create the repo, drop `CLAUDE.md` (provided separately) at the root, and keep this plan at `docs/BUILD-PLAN.md`.
2. Work **one milestone at a time**. Prompt pattern: _"Read docs/BUILD-PLAN.md §11, Phase N, Milestone N.M. Implement it completely. Then run the verification steps listed for that milestone and report results honestly."_
3. Never let a session span milestones. Small, verified increments beat heroic sessions.
4. Every milestone in §11 has **Tasks**, **Acceptance criteria**, and **Verify** steps. A milestone is done only when Verify passes — Claude Code must run the checks, not claim them.
5. After each milestone: commit with a conventional message (`feat(engine): …`), and update `docs/PROGRESS.md` (one line per milestone: date, status, deviations).
6. If a milestone forces a design deviation, record it in `docs/DECISIONS.md` (ADR-lite: context → decision → consequence) before coding on.

**Hard rules that override everything else** (mirrored in CLAUDE.md):

- Permissive-license dependencies only (MIT/Apache-2.0/BSD/ISC). No GPL/AGPL. No unpaid commercial code. Check the license _before_ `npm install`.
- The server is the authority: validation, logic, quotas, token state are enforced server-side; the client is UX only.
- Published instrument versions are immutable. Responses always reference the version they answered.
- Respondent bundle stays light (§8.1 budget). The admin app never leaks into respondent routes.
- Every instrument surface carries the N8E logo + n8elabs.com link + data-transparency line. Not optional, not per-instrument.

---

## 1. Product summary (locked decisions)

N8E Collect is N8E Labs' self-hosted data-collection hub: polls, surveys, quizzes, feedback forms, registration/intake forms — one engine, one Postgres, unlimited instruments. Internal tool, not a SaaS: **one admin account** (N8E-operated, TOTP 2FA), respondents reached **only via links** (public or tokenized), all data stored in N8E's own DB. Always-on N8E branding and transparency ("Your responses go to N8E Labs"). Stack: **Next.js (TypeScript) + PostgreSQL, Docker on AWS**, tightest budget (~$15–25/mo). Email out via **Amazon SES** as collect@n8elabs.com; replies to the Google Workspace alias. LLM text-coding layer deferred (API or local model, later). Forum/community features deliberately last, separate spec.

---

## 2. System architecture

### 2.1 Overview

```
                        ┌─────────────────────────────────────────────┐
                        │        AWS · one ARM instance (Docker)      │
                        │                                             │
 Respondents ──HTTPS──▶ │  Caddy ──▶ Next.js app ──▶ Postgres 16      │
 (public/token links)   │   TLS      ├ /s/[key]      ├ core schema    │
                        │            ├ /admin        ├ pg-boss queue  │
 N8E Admin ────HTTPS──▶ │            └ /api (N8E API)└ projections    │
                        │                 │                           │
                        │                 ├──▶ S3 (uploads, backups)  │
                        │                 └──▶ SES (invites/reminders)│
                        └─────────────────────────────────────────────┘
                                     collect.n8elabs.com
```

One codebase, three surfaces, strict separation:

| Surface            | Route                                  | Audience     | Notes                                                          |
| ------------------ | -------------------------------------- | ------------ | -------------------------------------------------------------- |
| Respondent runtime | `/s/[key]` (+ `/p/[key]` poll results) | Public       | Anonymous or tokenized. Lean bundle. No admin code.            |
| Admin app          | `/admin/**`                            | N8E only     | Auth-gated (session + TOTP). Builder, dashboards, exports.     |
| N8E API            | `/api/**`                              | Both, scoped | All writes. Server-authoritative validation/logic/quota/token. |

### 2.2 Request flows (canonical)

**Response submission:** respondent runtime posts answer patches to `/api/r/[responseKey]` as the respondent progresses (partial save) → server validates the patch against the _pinned instrument version_ + evaluates logic server-side (a patch touching a question that logic hides is rejected) → on final submit, server marks response complete, enqueues `project-response` job → job flattens JSONB into `response_items`.

**Publish:** admin edits a draft → `POST /api/instruments/[id]/publish` → server snapshots the definition into an immutable `instrument_versions` row, bumps `current_version`, and the draft continues from the snapshot.

**Tokenized entry:** link carries opaque token → server checks state (`issued|opened|partial|completed|void`) → single-use enforcement at _submission_ (opening twice is fine; completing twice is not) → response row binds `token_id`.

### 2.3 Repository structure (single Next.js app — no monorepo)

pnpm workspaces add ceremony this project doesn't need; shared code lives in `src/lib` and is imported by both client and server. Claude Code handles a single-app repo far more reliably.

```
n8e-collect/
├─ CLAUDE.md                    # repo conventions (source of truth for Claude Code)
├─ docs/
│  ├─ BUILD-PLAN.md             # this file
│  ├─ PROGRESS.md               # milestone log
│  └─ DECISIONS.md              # ADR-lite deviations
├─ src/
│  ├─ app/
│  │  ├─ (respondent)/s/[key]/  # respondent runtime (lean route group)
│  │  ├─ (respondent)/p/[key]/  # public poll results
│  │  ├─ admin/                 # admin app (dashboards, builder, settings)
│  │  ├─ api/                   # N8E API route handlers
│  │  └─ layout.tsx             # root; respondent group gets its own minimal layout
│  ├─ lib/
│  │  ├─ schema/                # instrument JSON schema: Zod + TS types (shared)
│  │  ├─ engine/                # logic evaluator + scoring (shared, isomorphic, pure)
│  │  ├─ db/                    # drizzle schema, migrations, queries
│  │  ├─ api/                   # N8E API pipeline: defineRoute, envelope, errors, auth, scopes, ratelimit, openapi (docs/N8E-API-SPEC.md)
│  │  ├─ services/              # HTTP-free domain services: instruments, responses, analytics, exports…
│  │  ├─ auth/                  # session, TOTP, argon2
│  │  ├─ jobs/                  # pg-boss workers (projection, email, export, backup)
│  │  ├─ email/                 # SES client + MJML-free HTML templates
│  │  ├─ storage/               # S3 (uploads, exports, backups)
│  │  └─ analytics/             # aggregation queries, chart-data shapers
│  ├─ components/
│  │  ├─ respondent/            # question controls, conversational shell, paged shell
│  │  ├─ admin/                 # admin UI kit usage, builder panels, chart wrappers
│  │  └─ ui/                    # shadcn/ui generated primitives
│  └─ styles/                   # tokens.css, tailwind config
├─ e2e/                         # Playwright specs
├─ docker/                      # Dockerfile, docker-compose.yml, Caddyfile, backup script
└─ drizzle/                     # generated SQL migrations
```

### 2.4 Tech stack (licenses verified before install — CLAUDE.md rule)

| Concern       | Choice                              | License      | Why                                                               |
| ------------- | ----------------------------------- | ------------ | ----------------------------------------------------------------- |
| Framework     | Next.js 15+ (App Router, TS strict) | MIT          | One codebase, three surfaces; RSC keeps respondent bundle lean    |
| DB            | PostgreSQL 16 (Docker)              | PostgreSQL   | JSONB + relational projections; no RDS (budget)                   |
| ORM           | Drizzle ORM + drizzle-kit           | Apache-2.0   | SQL-transparent, light, great migration story                     |
| Validation    | Zod                                 | MIT          | One schema → TS types + client UX + server authority              |
| Forms         | react-hook-form                     | MIT          | Respondent + builder forms                                        |
| UI kit        | Tailwind CSS 4 + shadcn/ui          | MIT          | Admin surface; tokens-first theming                               |
| Motion        | Framer Motion (`motion`)            | MIT          | Conversational transitions; respects reduced-motion               |
| Drag & drop   | dnd-kit                             | MIT          | Builder reorder (Phase 1: list reorder; Phase 6: full DnD)        |
| Charts        | Apache ECharts + thin React wrapper | Apache-2.0   | Animated, brushable, themeable; the analytics ceiling             |
| Auth session  | jose (JWT cookie) or iron-session   | MIT          | One admin — no Auth.js needed; less surface                       |
| TOTP          | otplib                              | MIT          | 2FA for the single admin credential                               |
| Password hash | argon2 (node-argon2)                | MIT          | Modern KDF                                                        |
| Jobs/queue    | pg-boss                             | MIT          | Queue inside Postgres — no Redis container (budget)               |
| Email         | AWS SDK v3 (SES)                    | Apache-2.0   | Invites/reminders as collect@n8elabs.com                          |
| Storage       | AWS SDK v3 (S3)                     | Apache-2.0   | Uploads, exports, DB backups                                      |
| Exports       | SheetJS CE? → use `exceljs` instead | exceljs: MIT | SheetJS CE license is quirky; exceljs is cleanly MIT (CSV native) |
| State (admin) | TanStack Query + Zustand            | MIT          | Server cache + builder local state                                |
| Unit tests    | Vitest + Testing Library            | MIT          | Engine + schema + API                                             |
| E2E tests     | Playwright                          | Apache-2.0   | Respondent flows, builder flows                                   |
| Lint/format   | ESLint + Prettier                   | MIT          | CI-enforced                                                       |
| TLS/proxy     | Caddy 2                             | Apache-2.0   | Auto-TLS for collect.n8elabs.com                                  |

**Explicitly rejected:** Redis (extra container, pg-boss suffices), Auth.js (multi-provider machinery for one account), SurveyJS Creator (commercial), any GPL/AGPL package, Kubernetes/ECS (budget), Prisma (heavier runtime than Drizzle; either is acceptable but the plan standardizes on Drizzle).

---

## 3. Data model

### 3.1 Tables (Drizzle → SQL; authoritative shapes)

```sql
-- One row in practice; schema allows more for recovery scenarios
admin_users (
  id uuid PK default gen_random_uuid(),
  email text UNIQUE NOT NULL,
  password_hash text NOT NULL,          -- argon2id
  totp_secret text,                     -- null until 2FA enrolled
  totp_enabled boolean NOT NULL default false,
  created_at timestamptz NOT NULL default now(),
  last_login_at timestamptz
)

instruments (
  id uuid PK,
  slug text UNIQUE NOT NULL,            -- short, url-safe, admin-editable pre-publish
  type text NOT NULL CHECK (type IN ('poll','survey','quiz','feedback','intake')),
  title text NOT NULL,
  status text NOT NULL default 'draft' CHECK (status IN ('draft','live','closed','archived')),
  draft_definition jsonb NOT NULL,      -- working copy (InstrumentDefinition)
  current_version int,                  -- FK-ish → instrument_versions.version
  theme jsonb NOT NULL default '{}',    -- theme overrides within brand constraints
  settings jsonb NOT NULL default '{}', -- consent text, retention days, conducted_for, mode
  created_at timestamptz NOT NULL default now(),
  updated_at timestamptz NOT NULL default now(),
  archived_at timestamptz
)

instrument_versions (
  id uuid PK,
  instrument_id uuid NOT NULL REFERENCES instruments,
  version int NOT NULL,                 -- 1..n per instrument
  definition jsonb NOT NULL,            -- IMMUTABLE snapshot (InstrumentDefinition)
  published_at timestamptz NOT NULL default now(),
  UNIQUE (instrument_id, version)
)
-- Immutability enforced by trigger: BEFORE UPDATE/DELETE → RAISE EXCEPTION.

distributions (
  id uuid PK,
  instrument_id uuid NOT NULL REFERENCES instruments,
  kind text NOT NULL CHECK (kind IN ('public','tokenized')),   -- 'embed' in Phase 6
  key text UNIQUE NOT NULL,             -- the /s/[key] path segment (nanoid, 12+ chars)
  label text NOT NULL,                  -- admin-facing ("Field wave 1", "Website link")
  opens_at timestamptz, closes_at timestamptz,
  response_cap int,                     -- server-enforced
  status text NOT NULL default 'active' CHECK (status IN ('active','paused','closed')),
  created_at timestamptz NOT NULL default now()
)

tokens (
  id uuid PK,
  distribution_id uuid NOT NULL REFERENCES distributions,
  token text UNIQUE NOT NULL,           -- opaque, 24+ chars, constant-time compared
  invitee_email text, invitee_label text,
  state text NOT NULL default 'issued' CHECK (state IN ('issued','opened','partial','completed','void')),
  opened_at timestamptz, completed_at timestamptz,
  UNIQUE (distribution_id, invitee_email)
)

responses (
  id uuid PK,
  response_key text UNIQUE NOT NULL,    -- respondent's resume handle, stored in an httpOnly cookie scoped to the distribution path (never in the URL); see §4 start endpoint and §6.1
  instrument_id uuid NOT NULL REFERENCES instruments,
  instrument_version int NOT NULL,      -- PINNED at start; joins to instrument_versions
  distribution_id uuid NOT NULL REFERENCES distributions,
  token_id uuid REFERENCES tokens,      -- null for public
  answers jsonb NOT NULL default '{}',  -- { [questionKey]: value } raw truth
  meta jsonb NOT NULL default '{}',     -- ua, locale, page timings, referer (no IP stored raw — see §10)
  status text NOT NULL default 'partial' CHECK (status IN ('partial','completed','disqualified')),
  score jsonb,                          -- quiz: { total, bands, perQuestion }
  started_at timestamptz NOT NULL default now(),
  completed_at timestamptz
)
-- Indexes: (instrument_id, status), (distribution_id), (completed_at)

response_items (                        -- PROJECTION: rebuildable, never source of truth
  response_id uuid NOT NULL REFERENCES responses ON DELETE CASCADE,
  question_key text NOT NULL,
  option_key text,                      -- one row per selection for multi-choice
  value_text text, value_number numeric, value_date timestamptz, value_json jsonb,
  -- uniqueness via expression index (option_key is null for non-choice answers):
  -- CREATE UNIQUE INDEX ON response_items (response_id, question_key, COALESCE(option_key,''));
)
-- Indexes: (question_key, value_number), (question_key, option_key)

response_files (
  id uuid PK, response_id uuid REFERENCES responses,
  question_key text NOT NULL, s3_key text NOT NULL,
  filename text, size_bytes int, mime text,
  scanned boolean default false, created_at timestamptz default now()
)

audit_log (
  id bigserial PK, at timestamptz default now(),
  actor text NOT NULL,                  -- 'admin' | 'system'
  action text NOT NULL,                 -- 'instrument.publish', 'export.csv', 'auth.login', …
  subject_type text, subject_id text, detail jsonb
)
```

### 3.2 Instrument definition schema (`src/lib/schema` — the heart)

Single Zod schema, exported types, versioned with `schemaVersion` so old snapshots stay parseable forever:

```ts
InstrumentDefinition = {
  schemaVersion: 1,
  mode: 'conversational' | 'paged',
  pages: Page[],                    // Page = { key, title?, questions: Question[] }
  logic: Rule[],                    // ordered; see §3.3
  scoring?: ScoringSpec,            // quizzes: per-option points, bands
  presentation: { showProgress, shuffleSeedStrategy?, welcome?, thankYou?, conductedFor? },
}

Question = {
  key: string,                      // stable, unique per instrument, NEVER reused for a different meaning (rename = new key; enforced at publish)
  type: 'short_text'|'long_text'|'single_choice'|'multi_choice'|'dropdown'|
        'rating'|'nps'|'likert_matrix'|'number'|'date'|'email'|'file',
  label: string, help?: string, required: boolean,
  options?: Option[],               // { key, label } — keys stable like question keys
  validation?: { min?, max?, regex?, maxFiles?, maxSizeMb?, accept? },
  matrix?: { rows: Option[], scale: Option[] },   // likert
}
```

**Publish-time invariants (server-enforced, tested):** unique keys; logic references only existing keys; no forward-reference cycles; a renamed label keeps its key, a _semantic_ change requires a new key (publish diff warns loudly); at least one page with one question.

### 3.3 Logic & scoring engine (`src/lib/engine` — pure, isomorphic)

One implementation, imported by respondent client (instant UX), builder preview, and API (authority). Zero DOM/DB imports — pure functions over `(definition, answers)`.

```ts
Rule = { id, when: Condition, action: Action }
Condition = { op:'and'|'or', clauses: Clause[] }
Clause = { q: questionKey, cmp:'eq'|'neq'|'in'|'gt'|'lt'|'gte'|'lte'|'answered'|'not_answered'|'contains', value? }
Action = { kind:'show_question'|'hide_question'|'skip_to_page'|'disqualify'|'end', target? }
```

Semantics locked here (do not improvise): rules evaluate in order after every answer change; hidden questions are _server-stripped_ — their answers are deleted, never just visually hidden, so a respondent flipping an earlier answer can't smuggle contradictory data; `disqualify` sets response status and shows the disqualification screen; scoring runs only at completion, server-side. The engine ships with a **golden test-vector file** (JSON in/out pairs) — every bug found in the field becomes a new vector.

---

## 4. N8E API surface

> **Canonical contract:** `docs/N8E-API-SPEC.md` defines what the N8E API is, its request pipeline, conventions (envelope, versioning, scopes, idempotency), implementation guide (`defineRoute` + services), and the multi-app evolution path (CMS and future N8E apps flow through the same API). This section is the Collect endpoint inventory; the spec governs shape and conduct. Canonical paths are **product-first, versioned**: `/api/collect/v1/…` for the product, `/api/core/v1/…` for shared services (auth, files, audit, health) — the tables below omit the prefix for readability.

All writes go through the N8E API. Route handlers are thin; domain logic lives in `src/lib`. Uniform error envelope `{ error: { code, message, fieldErrors? } }`. Admin routes require session cookie; respondent routes require a valid distribution key or response key. Rate limiting (in-memory token bucket keyed by IP hash + route; sufficient for one box) on all public endpoints.

### Admin (session-gated)

| Method & path                                        | Purpose                                                                                           |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `POST /api/auth/login` → `POST /api/auth/totp`       | Password step, then TOTP step; issues httpOnly session cookie                                     |
| `POST /api/auth/logout`                              | Kill session                                                                                      |
| `GET/POST /api/instruments`                          | List (with live stats) / create from type preset                                                  |
| `GET/PATCH/DELETE /api/instruments/[id]`             | Read / update draft+settings / archive (hard delete only while zero responses)                    |
| `POST /api/instruments/[id]/publish`                 | Validate invariants → snapshot version → set live                                                 |
| `POST /api/instruments/[id]/duplicate`               | Copy draft as new instrument                                                                      |
| `GET/POST /api/instruments/[id]/distributions`       | List/create links                                                                                 |
| `PATCH /api/distributions/[id]`                      | Pause/close/edit caps & windows                                                                   |
| `POST /api/distributions/[id]/tokens`                | Bulk-create tokens (CSV of invitees)                                                              |
| `GET /api/instruments/[id]/analytics/summary`        | Funnel, counts, completion, per-question aggregates (chart-ready shapes from `src/lib/analytics`) |
| `GET /api/instruments/[id]/analytics/question/[key]` | Drill-down + segment filter params                                                                |
| `POST /api/instruments/[id]/export`                  | Enqueue CSV (Phase 5) / XLSX (Phase 6) job → signed S3 URL                                        |
| `GET /api/audit`                                     | Audit log, paged                                                                                  |

### Respondent (public, rate-limited)

| Method & path                        | Purpose                                                                                                                                    |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET /api/s/[key]`                   | Resolve distribution → instrument version definition (branding, mode, pages) + open/closed/cap state. Token variant validates token state. |
| `POST /api/s/[key]/start`            | Create `responses` row (pins version, binds token), sets httpOnly resume cookie scoped to path                                             |
| `PATCH /api/r/[responseKey]`         | Answer patch: validate types + run engine server-side + strip hidden answers + persist. Idempotent.                                        |
| `POST /api/r/[responseKey]/complete` | Final validation of _all_ required/visible questions, scoring, token → completed, cap check (transactional), enqueue projection            |
| `POST /api/r/[responseKey]/files`    | Presigned S3 upload flow for `file` questions (size/mime enforced server-side)                                                             |
| `GET /api/p/[key]/results`           | Poll public results (aggregates only, cached 5s)                                                                                           |

Design notes Claude Code must respect: **cap and single-use checks happen inside the `complete` transaction** (`SELECT … FOR UPDATE` on distribution/token) — not at start — so racing respondents can't overshoot a cap; a respondent who started before close may finish within a grace window (setting, default 30 min); definitions served to respondents are stripped of admin-only fields (internal labels, notes).

---

## 5. Design system — "Veritas UI"

Extends the locked n8elabs.com visual language. The binding brand rules carry over verbatim: **clean, minimal, modern, editorial, sophisticated, dark, premium, technical, human, intentional**; accent is a signal, not a paint bucket; **no gradients, gradient text, glows, neon blobs, grey-heavy UI**; hard bans on cyberpunk/synthwave/HUD/CRT/grid-floor aesthetics; the logo is a fixed asset — never recolored, filtered, or redrawn; motion must have a reason; data visualization is the visual language. Fixed strings never paraphrased: `IN DATA VERITAS`, `FOR INDIA, BY NORTHEASTERN INDIA.`

### 5.1 Tokens (`src/styles/tokens.css` — CSS custom properties; Tailwind maps to them)

- **Color.** Neutral ramp built on a near-black editorial base (surface stack: `--bg`, `--surface-1..3`, hairline borders at low-alpha white). Accent: **Theme Green** (default, from n8elabs.com Theme 1) with a **Maroon/Neon-Red** alternate (Theme 2) — one accent active at a time, used for: primary actions, selection state, live/recording indicators, chart emphasis series. Semantic: `--ok --warn --danger --info`, muted, desaturated to sit inside the editorial palette. Exact hex values: **pull from the n8elabs.com repo tokens during Phase 0** (`[TK: import brand hex from n8elabs-website repo]`) — do not invent new brand colors.
- **Type.** Two-face system mirroring the site: an editorial grotesk for UI/body, a mono for data (keys, counts, timestamps, chart axes — mono digits are part of the "technical" voice). Scale: 12/13/14/16/18/22/28/36 with tight, deliberate line-heights; tabular numerals everywhere data appears.
- **Space & radius.** 4px base grid; radii 8 (controls) / 12 (cards) / 999 (pills). Hairline borders over shadows; at most one elevation level of soft shadow in dark mode.
- **Motion.** Durations 120ms (state) / 200ms (reveal) / 320ms (page transition); one spring config for conversational advance (gentle, no bounce-for-bounce's-sake). Every animation maps to a _reason_ (feedback, orientation, continuity). `prefers-reduced-motion` swaps transforms for opacity, everywhere, verified in e2e.
- **Dark/light.** Admin: dark-first (brand-native), light optional later. Respondent: two built-in themes — **Veritas Dark** (default, brand-native) and **Veritas Light** (for instruments where field conditions demand it, e.g. outdoor mobile) — chosen per instrument in settings; both AA-checked.

### 5.2 Two component kits, one language

**Respondent kit (`components/respondent/`)** — its own small world; imports tokens + engine only, never admin components:
QuestionShell (label/help/error/required), ChoiceCard (tap target ≥44px, radio & checkbox modes, keyboard letters A–Z), DropdownSheet (bottom-sheet on mobile), RatingScale (numeric + emoji/icon variants), NPSScale, LikertMatrixGrid (mobile: one row per screen in conversational mode), Slider (snap + haptic-feel tick), RankList (tap-to-rank, Phase 6 drag), TextField/TextArea (autosize), DatePicker (native input first — lightest), FileDrop (camera-friendly on mobile), ProgressAmbient (thin top bar + "3 of 12"), WelcomeScreen, ThankYouScreen, DisqualifiedScreen, PollResultsLive (animated bars after voting), **BrandFrame** — the non-optional N8E logo + n8elabs.com link + "Your responses go to N8E Labs" transparency line + optional "conducted for [Client]" slot.

**Admin kit (`components/admin/`)** — shadcn/ui primitives restyled by tokens: AppShell (glass-capsule top bar echoing the site nav, logo left, env badge, account right), StatTile (mono numerals + sparkline), FunnelBar, ChartCard (ECharts wrapper: brand theme registered once, transitions on filter change, empty/loading/error states), SegmentBar (active filters as removable chips), DataTable (virtualized), BuilderPanels (§8.3), DiffView (version compare), TokenTable (state chips), ExportButton (job status inline).

### 5.3 Accessibility & performance bar (release-gating, not aspirational)

WCAG 2.1 AA contrast in both themes; every respondent flow completable by keyboard alone and by screen reader (axe checks in e2e); focus visible always; touch targets ≥44px; `prefers-reduced-motion` honored. Performance budget for `/s/[key]`: **≤120KB gzipped JS**, LCP <2.5s on simulated Slow-4G mid-range Android — enforced by a CI bundle-size check (fails the build if exceeded). ECharts is _never_ shipped to respondent routes (poll results use a hand-rolled animated bar — a few hundred bytes).

---

## 6. Frontend plan

### 6.1 Respondent runtime (`app/(respondent)/s/[key]`)

- **Server component** resolves distribution → serves definition + theme + brand frame; **client island** runs the answering session.
- A small **session state machine** (XState is unnecessary — a reducer is enough): `loading → welcome → answering(page/question idx) → validating → complete | disqualified | closed`. The engine (§3.3) recomputes visibility after every answer; navigation targets come from it, never from component logic.
- **Conversational mode:** one question per screen; Enter/letter-key advance; spring transition (old question exits up, new enters from below — continuity, not spectacle); ambient progress. **Paged mode:** classic multi-question pages for long research/intake; same components, different shell.
- **Partial save:** every answer fires a debounced `PATCH` (350ms); resume via httpOnly cookie → returning respondent lands on their next unanswered visible question. Offline blips tolerated: patches queue in memory and flush; the UI shows a quiet "saved" tick (mono, small — the brand voice).
- **Polls:** vote → optimistic transition to `PollResultsLive` with animated counts (respectful of reduced-motion) → share link.
- **Quizzes:** score/band revealed on ThankYouScreen from the server's `complete` response — never computed client-side.

### 6.2 Admin app (`app/admin`)

- **Home:** StatTile grid per live instrument (responses today, completion %, 7-day sparkline), attention list (cap near, wave underperforming, closing soon), recent activity from audit log.
- **Instrument workspace** (tabs): **Build** (§6.3) · **Preview** (respondent runtime embedded in device frame, desktop/mobile toggle, logic trace panel showing which rules fired — the builder's debugger) · **Distribute** (links, QR download, token waves + CSV upload, caps/windows) · **Results** (§6.4) · **Settings** (consent text, retention days, theme, conductedFor, mode).
- **Version history:** list of published versions; DiffView between any two; responses-per-version counts.

### 6.3 Builder (Phase 1 form-based; Phase 6 drag-drop)

Three-pane layout: page/question outline (left, dnd-kit reorder), question editor (center: type-specific fields, validation, options with stable keys), live mini-preview (right, the _real_ respondent components — no drift between preview and truth). Logic editor: per-rule builder rows ("When [Q] [is] [value] → [skip to] [page]") backed by the same Rule schema, with an instrument-level logic list showing evaluation order; publish runs invariants (§3.2) and shows a human-readable diff + "N responses were collected on v3" warning before creating v4.

### 6.4 Analytics UI

Per instrument: **funnel** (started → completed, drop-off by page — the first chart, because it tells you if the instrument is broken); per-question auto-visuals (choice → horizontal stacked bars sorted by count; rating/NPS → distribution + mean/median strip with NPS gauge treatment banned — a plain diverging bar reads better and fits the brand; likert → diverging stacked; text → response list + word-frequency until Phase 7 LLM coding; file → gallery/table). SegmentBar filters (by answer to question X, by distribution, by date range) re-query server aggregates — **aggregation happens in SQL over `response_items`, never in the browser** — charts animate between states. Cross-tabs land in Phase 6 as a question×question matrix view.

---

## 7. Backend plan

- **Auth (§9 detail):** password (argon2id) + TOTP; session = signed httpOnly SameSite=Lax cookie, 12h idle expiry; login throttled (5 fails → 15 min lock); all auth events audited.
- **Submission pipeline:** PATCH validation = Zod per-question check + engine visibility check + strip-hidden; COMPLETE = full required-visible validation + scoring + transactional cap/token enforcement + audit + enqueue projection. Projection worker upserts `response_items` idempotently (delete+insert per response in one tx). A `rebuild-projection --instrument X` job supports schema evolution and disaster recovery.
- **Jobs (pg-boss):** `project-response`, `send-invite-wave`, `send-reminders` (Phase 6), `generate-export`, `nightly-backup` (pg_dump | gzip → S3, then prune per lifecycle), `retention-sweep` (anonymize/delete per instrument retention setting). All workers idempotent; failures retry with backoff; dead-letter surfaces on admin home.
- **Email (SES):** domain-verified DKIM/SPF/DMARC; sender `N8E Labs <collect@n8elabs.com>`; Reply-To the Workspace alias; templates are simple brand-framed HTML (logo, accent rule line, plain text part); every invite email carries the unsubscribe/contact line; SES sandbox exit is a Phase 5 checklist item.
- **Files:** presigned S3 PUT with server-issued constraints (mime allowlist, size cap); keys namespaced `uploads/{instrument}/{response}/{question}/`; downloads only via short-lived signed URLs from the admin app.
- **Exports:** CSV streams from `response_items` join (one column per question key, multi-choice as one column per option, matrix as row×scale columns); XLSX (Phase 6) via exceljs with a typed header sheet + data sheet; artifacts land in S3, signed URL returned, auto-pruned after 7 days.

---

## 8. Security, privacy & compliance

- Server-authoritative everything (validation, logic, quota, tokens, scoring). Constant-time token comparison. Rate limiting on all public routes. CSRF: SameSite=Lax + origin check on admin mutations. Security headers (CSP without `unsafe-inline` — Next config), no third-party scripts on respondent pages, no analytics trackers (we _are_ the analytics).
- **DPDP posture:** every instrument carries consent text (settings; default template provided) + the BrandFrame transparency line; per-instrument retention setting drives `retention-sweep` (anonymize answers, keep aggregates); IPs are never stored raw (only a salted daily-rotating hash in `meta` for dedup heuristics); respondent data leaves the box only to S3 (same account) and never to third parties; data-deletion path documented (`docs/RUNBOOK.md`): delete by response_key/token/email across responses + items + files.
- **Backups:** nightly job + weekly restore _drill_ (Phase 5 makes this a script: restore latest dump into a scratch container, count rows, report) — a backup that's never been restored is a hope, not a backup.
- **Audit:** every admin mutation + auth event + export logged; log is append-only at the app layer.

---

## 9. Infrastructure & DevOps

- **Compute:** one ARM instance (Lightsail 2GB or EC2 t4g.small) running Docker Compose: `app` (Next standalone build), `postgres:16` (named volume), `caddy` (auto-TLS, reverse proxy, gzip/brotli). pg-boss workers run inside the app container (a second lightweight `worker` process via the same image, `node worker.js`).
- **DNS:** `collect.n8elabs.com` A record → instance elastic/static IP.
- **S3:** two prefixes in one bucket (`uploads/`, `backups/`) + versioning + lifecycle (backups: 90d standard → Glacier 1y — confirm retention, spec §9 open question). IAM user scoped to that bucket + SES send only.
- **Deploy:** GitHub Actions → on tag: typecheck, lint, unit, e2e (against compose), bundle-size gate → build image → push GHCR → SSH deploy script (`docker compose pull && up -d`, then `drizzle-kit migrate` one-shot container). Rollback = previous image tag + migrations written to be backward-compatible one step (CLAUDE.md rule: additive migrations; destructive changes in a later release).
- **Ops:** container healthchecks; uptime ping (external free tier) on `/api/health` (checks DB + queue); logs via `docker logs` + weekly logrotate; disk alarm at 80%. Windows dev machine runs the same compose file (documented in README; no WSL-specific hacks in scripts — use Node scripts, not bash, for cross-platform tasks).

## 10. Testing strategy

| Layer  | Tool                             | What must be covered                                                                                                                                                             |
| ------ | -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Engine | Vitest + golden vectors          | Every rule op, order-dependence, hidden-answer stripping, disqualify, scoring bands; vectors grow with every field bug                                                           |
| Schema | Vitest                           | Publish invariants: dup keys, dangling logic refs, key-rename detection                                                                                                          |
| API    | Vitest + test Postgres (compose) | Auth flow, patch validation, complete transaction (cap race test with concurrent completes), token single-use race, projection idempotency                                       |
| E2E    | Playwright                       | Conversational + paged full runs (keyboard-only variant), resume flow, poll vote→results, builder create→publish→respond→see analytics round-trip, axe a11y scan, reduced-motion |
| Perf   | CI script                        | Respondent route bundle ≤120KB gz; Lighthouse CI on /s/ demo instrument                                                                                                          |

Definition of done for any milestone = its tests exist and pass in CI, not just locally.

---

## 11. Phased build plan (the execution contract)

> Each milestone: **Tasks** → **Acceptance** → **Verify** (commands/checks Claude Code must actually run). Milestones are sized for one focused Claude Code session. Order within a phase is binding — later milestones assume earlier ones.

### Phase 0 — Foundation (repo that runs, deploys, and won't rot)

**0.1 Repo + toolchain.** Init Next.js 15 TS-strict + Tailwind 4 + ESLint/Prettier + Vitest + Playwright; `docker/docker-compose.yml` (app dev target, postgres, caddy-less locally); tokens.css stub; CLAUDE.md, docs/ scaffolding.
_Accept:_ `pnpm dev` serves; `pnpm test` green; compose boots postgres.
_Verify:_ run all three; commit hooks (lint-staged) fire.

**0.2 DB layer.** Drizzle schema for all §3.1 tables + `api_clients` and `idempotency_keys` (API spec §5.4; implemented Phase 6, schema ships now) + immutability trigger on `instrument_versions`; first migration; seed script (admin user from env, one demo survey instrument).
_Accept:_ `drizzle-kit migrate` clean on fresh DB; trigger rejects UPDATE on versions (tested).
_Verify:_ migration up on empty container; unit test for trigger passes.

**0.3 Auth + API pipeline.** `src/lib/api` foundation per API spec §5.1–5.2 (defineRoute, envelope, errors, requestId, rate limit; identity planes: session + respondent). Login (argon2 + throttle) → TOTP enrol/verify (otplib, QR) → session cookie; `/admin` gate middleware; audit events.
_Accept:_ full 2FA flow works; 5 bad passwords lock 15 min; session survives restart (signed cookie, no server store).
_Verify:_ Playwright: login happy path + lockout + TOTP-wrong path.

**0.4 Skeleton deploy.** Dockerfile (standalone output), full compose with Caddy, GH Actions pipeline, deploy script; health endpoint.
_Accept:_ tagged commit auto-deploys to the AWS box over SSH; https://collect.n8elabs.com/api/health returns ok.
_Verify:_ real deploy of the skeleton; rollback drill to previous tag.

### Phase 1 — Instrument engine core

**1.1 Schema package.** Full Zod `InstrumentDefinition` + types + publish invariants + type presets (poll/survey/quiz/feedback/intake defaults).
_Accept:_ invariant suite green incl. key-rename detection. _Verify:_ `pnpm test src/lib/schema`.

**1.2 Logic + scoring engine.** §3.3 semantics, golden vectors (≥30 covering every op + ordering + stripping + disqualify + scoring).
_Accept/Verify:_ vectors green; mutation-style spot checks (flip an op, a vector fails).

**1.3 Instrument CRUD API + versioning.** Routes per §4 admin table, all via `defineRoute` + services (no logic in route files); OpenAPI generation (`pnpm api:openapi`) wired from here on (instruments, publish, duplicate, archive); publish snapshots + diff summary; audit.
_Accept:_ publish→edit→publish yields v1,v2; v1 immutable; delete blocked once responses exist.
_Verify:_ API tests incl. immutability + archive rules.

**1.4 Builder v1.** Three-pane form-based builder + logic rule rows + settings tab; publish flow with diff + warning; outline reorder (dnd-kit list).
_Accept:_ an admin can build the demo survey (10 questions, 2 rules, 3 pages) from scratch in the UI and publish it.
_Verify:_ Playwright builder spec does exactly that.

### Phase 2 — Respondent runtime

**2.1 Serve + start.** `/s/[key]` resolve (open/close/cap states, stripped definition), start endpoint, resume cookie, BrandFrame on every screen.
**2.2 Question components.** Full respondent kit (§5.2) with keyboard + a11y + both themes; Storybook-less: a `/admin/kitchen-sink` internal page renders every control for eyeball QA.
**2.3 Conversational + paged shells.** State machine, transitions, progress, partial-save PATCH loop, resume-to-next-unanswered.
**2.4 Server authority.** PATCH/COMPLETE validation, engine parity (same vectors run against the API), hidden-answer stripping, scoring on complete, projection worker + rebuild job.
_Phase accept:_ full respondent journey on mobile viewport, keyboard-only, and screen-reader pass; kill the tab mid-survey and resume; answers of hidden questions provably absent from DB.
_Verify:_ Playwright suite + API race/parity tests + bundle gate ≤120KB.

### Phase 3 — Distribution

**3.1 Public links.** Distribution CRUD UI, QR generation (client-side, MIT lib), caps/windows enforced in complete-tx, paused/closed respondent states (branded, kind).
**3.2 Tokenized links.** Token bulk create (CSV upload), state machine, single-use-at-complete race test, token table UI with state chips, void action.
**3.3 Poll preset end-to-end.** One-tap vote flow, `PollResultsLive` animated public results page (`/p/[key]`), 5s cache, share link.
_Phase accept:_ cap of N is never exceeded under 2N concurrent completes (test proves it); a token completes exactly once; poll results update live for a second voter.
_Verify:_ race tests + Playwright poll spec.

### Phase 4 — Analytics & exports (admin becomes worth looking at)

**4.1 Aggregation layer.** `src/lib/analytics` SQL aggregates per question type + funnel + per-page drop-off; chart-shape functions unit-tested against seeded fixtures.
**4.2 Dashboards.** Home (tiles, attention list) + Results tab (funnel first, auto-visuals per type, ECharts brand theme, animated filter transitions, SegmentBar).
**4.3 CSV export.** Streaming export job → S3 signed URL; column layout per §7; audit.
_Phase accept:_ seeded 5k-response instrument renders every chart correctly and <1.5s server time per aggregate; CSV opens clean in Excel/Sheets with correct multi-choice/matrix columns.
_Verify:_ fixture-based aggregate tests; manual chart QA on kitchen-sink data; export diff against fixture.

### Phase 5 — Hardening & launch

**5.1 Privacy & consent.** Consent text setting + default template, transparency line QA in both themes, retention-sweep job, deletion runbook + script, IP-hash-only check.
**5.2 Security pass.** Headers/CSP audit, rate-limit tune, dependency audit (`pnpm audit` + license re-scan), backup+restore drill scripted, uptime monitor, SES domain verification + sandbox exit, invite template.
**5.3 Launch checklist.** Real instrument fielded to a small friendly audience; PROGRESS.md review; tag v1.0.
_Phase accept:_ restore drill passes on a fresh container; a real survey collects real responses end-to-end including an emailed invite; Lighthouse a11y ≥95 on respondent route.

### Phase 6 — Research grade (post-v1, prioritized then, not now)

**Machine plane of the N8E API** (API spec §5.6: service tokens + scopes + admin UI, idempotency store, webhooks, published typed client `@n8e/api-client` — switched on when the first machine consumer, e.g. the CMS, exists) · Randomization (seed-per-response, order stored in meta for analysis) · server quotas by segment · piping/recall (`{{q:key}}` interpolation, engine-side) · SES invite waves + reminder-to-nonresponders (token states drive it) · cross-tabs UI · XLSX · drag-drop builder polish · template library · multi-language instruments (definition holds locale variants; distribution picks) · embeds (script tag + iframe, includes n8elabs.com).

### Phase 7 — LLM open-text coding (deferred by decision)

Design constraint honored now: free text lives clean in `response_items.value_text`; coding results will be additive tables (`text_codes`, `response_text_codes`) — nothing in v1 blocks it. Provider (API vs local) decided when this phase opens.

### Phase 8 — Forum / community (separate spec, later)

Reuses Postgres + admin shell + auth. Explicitly out of scope for this plan.

---

## 12. Risks & guardrails

| Risk                                                                                | Guardrail                                                                                                         |
| ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Scope creep into SaaS features                                                      | §1 non-goals; CLAUDE.md forbids multi-tenancy/auth expansion without spec change                                  |
| Version/response drift (the classic month-4 bug)                                    | Immutable versions + trigger + pinned `instrument_version` + publish diff warnings + tests                        |
| Client-trusted logic                                                                | Engine parity tests: same vectors client & server; server strips hidden answers                                   |
| Respondent bundle bloat                                                             | CI 120KB gate; ECharts banned from respondent routes; route-group isolation                                       |
| One-box data loss                                                                   | Nightly S3 backups + scripted restore drill (Phase 5 gate)                                                        |
| License contamination                                                               | CLAUDE.md pre-install license check; CI license scanner (`license-checker` allowlist)                             |
| Single admin credential                                                             | TOTP mandatory, throttle, audit; recovery documented in RUNBOOK                                                   |
| Email → spam                                                                        | SES + DKIM/SPF/DMARC only; never Gmail SMTP for sends                                                             |
| Premature platformization (building the grand company API before a second consumer) | API spec §6.3 decision rule: namespaces/contracts now, extraction only on real pain                               |
| Brand drift ("sexy" → noisy)                                                        | §5 inherits n8elabs.com bans (no gradients/glows/etc.); kitchen-sink page reviewed against brand rules each phase |

---

_Fixed strings, never paraphrased: `IN DATA VERITAS` · `FOR INDIA, BY NORTHEASTERN INDIA.`_
