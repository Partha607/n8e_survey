# N8E Collect — Software Requirements Specification (SRS)

**Document:** SRS-COLLECT-1.0 · **Date:** 19 Aug 2026 · **Owner:** N8E Labs · **Status:** Baseline for v1 development
**Related documents:** Product Spec v0.3 (`claude/product-spec.md`) · Build Plan (`docs/BUILD-PLAN.md`) · N8E API Spec (`docs/N8E-API-SPEC.md`) · Repo conduct (`CLAUDE.md`)

---

## 1. Introduction

### 1.1 Purpose

This SRS states the complete, testable requirements for **N8E Collect v1**, N8E Labs' self-hosted data-collection platform. It is the requirements baseline against which the build plan's phases are verified and v1 is accepted. Audience: the N8E Labs owner/operator and Claude Code as implementing engineer.

### 1.2 Scope

N8E Collect lets the N8E Labs admin create, publish, distribute, and analyze data-collection instruments — polls, surveys, quizzes, feedback forms, registration/intake forms — completed by respondents via links, with all data stored in N8E's own PostgreSQL database on N8E's AWS infrastructure. In scope for v1: phases 0–5 of the build plan (foundation through hardening/launch). Specified here but deferred to post-v1 releases: research-grade features (Phase 6), LLM text coding (Phase 7). Out of scope entirely: forum/community features (separate future spec), multi-tenancy, client accounts, billing, native mobile apps, white-labeling, public third-party API.

### 1.3 Definitions

- **Instrument** — a versioned JSON definition of pages, questions, logic, scoring, and presentation; the single primitive underlying all five instrument types.
- **Instrument version** — an immutable published snapshot of an instrument definition.
- **Distribution** — a channel by which an instrument reaches respondents (public link or tokenized links; embed post-v1).
- **Token** — an opaque single-use credential binding one invitee to one distribution.
- **Response** — one respondent's answer set, pinned to the instrument version answered; stored raw (JSONB) and projected (flattened rows).
- **Engine** — the pure, isomorphic logic/scoring evaluator shared by client and server.
- **BrandFrame** — the mandatory respondent-facing N8E identity block (logo, n8elabs.com link, transparency line).
- **N8E API** — the versioned, namespaced application contract through which all reads/writes flow (see N8E API Spec).
- **Admin** — the single N8E-operated administrator account. **Respondent** — an anonymous or invited member of the public completing an instrument. **Machine client** — a future N8E application holding a scoped service token.
- **Priority:** **M** = Must (v1 blocks without it) · **S** = Should (v1 target, degradable) · **C** = Could (post-v1 / Phase 6+). Each requirement carries its build-plan phase.

### 1.4 References

IEEE 830-style structure adapted; WCAG 2.1; India DPDP Act 2023; OWASP ASVS (informative); conventions per N8E API Spec §4.

---

## 2. Overall description

### 2.1 Product perspective

A single Next.js application exposing three surfaces — respondent runtime (`/s/[key]`, `/p/[key]`), admin app (`/admin`), and the N8E API (`/api/collect/v1`, `/api/core/v1`) — backed by PostgreSQL 16, pg-boss job queue, S3 (uploads, exports, backups), and SES (outbound email), deployed via Docker Compose behind Caddy on one AWS ARM instance at `collect.n8elabs.com`. The N8E API is designed as the future contract for other N8E products (CMS, management apps); v1 implements the human and respondent identity planes, with the machine plane (service tokens) schema-ready and switched on in Phase 6.

### 2.2 User classes

| Class                   | Description                                                                             | Technical level                |
| ----------------------- | --------------------------------------------------------------------------------------- | ------------------------------ |
| Admin                   | One N8E-operated account; builds, distributes, analyzes                                 | High; trainable on internal UI |
| Respondent              | Public; often mobile, often on constrained bandwidth (Northeast India field conditions) | Assume none                    |
| Machine client (future) | N8E apps via scoped service tokens                                                      | n/a (programmatic)             |

### 2.3 Operating environment

Server: Docker on one ARM Linux instance (Lightsail 2GB / EC2 t4g.small), PostgreSQL 16 container, Caddy TLS. Client: evergreen mobile and desktop browsers (last 2 major versions); respondent surface must function on mid-range Android over slow 4G. Dev: Windows + Docker Desktop; all developer-run scripts cross-platform (Node).

### 2.4 Constraints (summary; formal statements in §6)

Tightest AWS budget (~$15–25/mo); permissive-license dependencies only; single admin; server-authoritative enforcement; immutable versions; always-on N8E branding; locked n8elabs.com visual language.

### 2.5 Assumptions & dependencies

n8elabs.com DNS control and brand assets (logo, hex tokens, fonts) available at Phase 0; AWS account with S3/SES; SES production access granted before first email wave (Phase 5); Google Workspace alias collect@n8elabs.com receives replies; response volume in the thousands-per-day class, not millions.

---

## 3. Functional requirements

### 3.1 Authentication & session (FR-AUTH) — Phase 0

- **FR-AUTH-01 (M)** The system shall authenticate the admin with email + password (argon2id-hashed) followed by a mandatory TOTP step.
- **FR-AUTH-02 (M)** The system shall lock the login for 15 minutes after 5 consecutive failed password or TOTP attempts and audit each failure.
- **FR-AUTH-03 (M)** Sessions shall be signed httpOnly SameSite=Lax cookies with 12-hour idle expiry; logout shall invalidate the session cookie.
- **FR-AUTH-04 (M)** All `/admin` routes and admin API endpoints shall reject unauthenticated requests; admin mutations shall pass an origin check.
- **FR-AUTH-05 (M)** TOTP enrolment (QR + manual secret) and re-enrolment shall be available to the authenticated admin; recovery procedure shall be documented in the runbook.

### 3.2 Instrument management (FR-INST) — Phase 1

- **FR-INST-01 (M)** The admin shall create instruments of five types — poll, survey, quiz, feedback, intake — each initialized from a type preset over the single instrument schema.
- **FR-INST-02 (M)** The admin shall edit a draft definition (pages, questions, options, logic, scoring, presentation, settings) without affecting any published version.
- **FR-INST-03 (M)** Publishing shall validate invariants (unique stable keys; logic references resolve; no cycles; ≥1 page with ≥1 question; key-rename detection) and reject with field-level errors on failure.
- **FR-INST-04 (M)** Publishing shall create an immutable numbered version snapshot; the database shall reject UPDATE/DELETE on version rows (trigger-enforced).
- **FR-INST-05 (M)** Publishing over collected responses shall present a human-readable diff and an explicit warning stating the response count on the prior version before confirmation.
- **FR-INST-06 (M)** The system shall support unlimited instruments and unlimited responses, bounded only by storage.
- **FR-INST-07 (M)** The admin shall duplicate any instrument (draft copied as a new instrument) and archive any instrument; hard delete shall be possible only while zero responses exist.
- **FR-INST-08 (M)** Instrument settings shall include: mode (conversational/paged), theme (Veritas Dark/Light), consent text, retention period, optional "conducted for [Client]" line, welcome/thank-you content.
- **FR-INST-09 (S)** Version history shall list all versions with response counts and render a field-level diff between any two versions.

### 3.3 Question types & validation (FR-QST) — Phases 1–2

- **FR-QST-01 (M)** v1 shall support: short text, long text, single choice, multi choice, dropdown, rating, NPS (0–10), Likert matrix, number, date, email, file upload.
- **FR-QST-02 (M)** Per-question validation shall support required, min/max (length or value), regex, and for files: count, size, and MIME allowlist — declared once (Zod) and enforced client-side for UX and server-side as authority.
- **FR-QST-03 (M)** Question and option keys shall be stable identifiers: labels may change freely; a semantic change requires a new key (enforced at publish per FR-INST-03).
- **FR-QST-04 (C, Phase 6)** Ranking, slider, and matrix variants beyond Likert.

### 3.4 Logic & scoring engine (FR-LOG) — Phase 1

- **FR-LOG-01 (M)** The engine shall evaluate ordered rules of the form _when(condition) → action_, with comparators eq/neq/in/gt/lt/gte/lte/answered/not_answered/contains and actions show/hide question, skip to page, disqualify, end.
- **FR-LOG-02 (M)** One pure, isomorphic implementation shall serve respondent client, builder preview, and server; identical golden test vectors shall pass in both environments.
- **FR-LOG-03 (M)** Answers to questions hidden by logic shall be deleted server-side, never merely hidden; a stored response shall never contain an answer to a question invisible under its own answer set.
- **FR-LOG-04 (M)** Disqualification shall set response status and present the disqualification screen; disqualified responses shall be excluded from analytics by default and countable separately.
- **FR-LOG-05 (M)** Quiz scoring (per-option points, total, result bands) shall execute server-side at completion only; the client shall display, never compute, the result.
- **FR-LOG-06 (C, Phase 6)** Piping/recall of earlier answers into labels (`{{q:key}}`), evaluated by the engine.

### 3.5 Builder (FR-BLD) — Phase 1 (polish Phase 6)

- **FR-BLD-01 (M)** A three-pane builder: page/question outline with reorder; type-specific question editor; live preview rendered by the real respondent components.
- **FR-BLD-02 (M)** A logic editor presenting each rule as a readable row ("When [Q] [is] [value] → [action]") with instrument-level evaluation order visible.
- **FR-BLD-03 (M)** Preview shall offer desktop/mobile frames and a logic trace showing which rules fired for the current answer state.
- **FR-BLD-04 (M)** The admin shall be able to build a 10-question, 3-page, 2-rule survey entirely in the UI and publish it (acceptance benchmark, e2e-tested).
- **FR-BLD-05 (C, Phase 6)** Full drag-and-drop placement, template library, multi-language variants.

### 3.6 Distribution (FR-DIST) — Phase 3

- **FR-DIST-01 (M)** The admin shall create multiple named distributions per instrument: public links and tokenized links, each with optional open/close window and response cap.
- **FR-DIST-02 (M)** Distribution keys shall be non-enumerable (≥12-char random); a QR code shall be downloadable per distribution.
- **FR-DIST-03 (M)** Response caps and single-use token completion shall be enforced transactionally at completion; under concurrent load the cap shall never be exceeded and a token shall never complete twice (race-tested).
- **FR-DIST-04 (M)** Respondents who started before a close/cap shall be allowed a configurable grace window (default 30 min) to finish.
- **FR-DIST-05 (M)** Tokens shall be bulk-creatable from CSV (email/label per invitee), individually voidable, and shall track states issued/opened/partial/completed/void; token values shall be shown once at creation and stored hashed-comparable (constant-time).
- **FR-DIST-06 (M)** Paused/closed/capped distributions shall present branded, kind respondent-facing states.
- **FR-DIST-07 (C, Phase 6)** Embed distribution (script/iframe), including on n8elabs.com.

### 3.7 Respondent experience (FR-RESP) — Phase 2

- **FR-RESP-01 (M)** Two rendering modes per instrument: conversational (one question per screen, keyboard letter-select and Enter-advance, animated transitions) and paged (multi-question pages); both mobile-first.
- **FR-RESP-02 (M)** Every respondent screen shall render the BrandFrame: N8E logo (unaltered), link to https://n8elabs.com, and the line "Your responses go to N8E Labs"; instruments may add "conducted for [Client]". This shall not be disableable per instrument.
- **FR-RESP-03 (M)** Answers shall persist via debounced partial saves; a returning respondent (httpOnly resume cookie) shall land on their next unanswered visible question.
- **FR-RESP-04 (M)** Progress indication (ambient bar + position count) shall be shown when enabled in presentation settings.
- **FR-RESP-05 (M)** Welcome, thank-you, disqualified, closed, capped, and paused screens shall all be branded and instrument-configurable where applicable.
- **FR-RESP-06 (M)** File-upload questions shall use presigned S3 uploads with server-enforced constraints; camera capture shall work on mobile.
- **FR-RESP-07 (M)** The respondent surface shall carry no third-party scripts, trackers, or analytics.
- **FR-RESP-08 (S)** Offline blips shall queue unsent patches in memory and flush on reconnect, with a quiet saved-state indicator.

### 3.8 Polls (FR-POLL) — Phase 3

- **FR-POLL-01 (M)** The poll preset shall support one-tap vote and an animated public results page (`/p/[key]`) with aggregate counts only, cached ≤5s, plus a share link.
- **FR-POLL-02 (M)** Poll results pages shall never expose individual responses or respondent metadata.

### 3.9 Analytics (FR-ANLT) — Phase 4

- **FR-ANLT-01 (M)** Admin home shall show per-live-instrument tiles (responses today, completion %, 7-day sparkline) and an attention list (cap near, closing soon, dead-letter jobs).
- **FR-ANLT-02 (M)** Per instrument, a response funnel (started → completed, per-page drop-off) shall be the first visual on the Results tab.
- **FR-ANLT-03 (M)** Per-question visuals shall be selected automatically by type: choice → sorted horizontal bars; rating/NPS → distribution with mean/median (diverging bar for NPS, no gauges); Likert → diverging stacked; text → response list + word frequency; file → table/gallery.
- **FR-ANLT-04 (M)** Segment filters (by answer, distribution, date range) shall re-aggregate server-side in SQL over the projection; charts shall animate between filter states; no raw-response aggregation in the browser.
- **FR-ANLT-05 (M)** All aggregates shall derive from `response_items`, rebuildable from raw JSONB by an idempotent projection job with a manual rebuild command.
- **FR-ANLT-06 (C, Phase 6)** Cross-tabs (question × question matrix) with the same segment model.

### 3.10 Exports (FR-EXP) — Phase 4 (XLSX Phase 6)

- **FR-EXP-01 (M)** CSV export per instrument shall stream asynchronously (job → S3 → signed URL, 7-day expiry) with one column per question key, one column per multi-choice option, matrix as row×scale columns, and version + timestamps per response row.
- **FR-EXP-02 (M)** Exports shall be audited (who, what, when).
- **FR-EXP-03 (C, Phase 6)** XLSX export (typed header sheet + data sheet, exceljs).

### 3.11 Email (FR-EMAIL) — Phase 5 minimal, Phase 6 full

- **FR-EMAIL-01 (M)** All outbound email shall send via Amazon SES as `N8E Labs <collect@n8elabs.com>` with DKIM/SPF/DMARC verified; Gmail SMTP shall never be used for sends; Reply-To shall be the Workspace alias.
- **FR-EMAIL-02 (C, Phase 6)** Tokenized invite waves and reminder emails targeting non-responders (driven by token state), rate-paced, with brand-framed HTML + plain-text parts and a contact/unsubscribe line.

### 3.12 N8E API (FR-API) — Phases 0–5; machine plane Phase 6

- **FR-API-01 (M)** All reads and writes shall flow through the N8E API under product-first versioned namespaces (`/api/collect/v1`, `/api/core/v1`), per the N8E API Spec conventions (envelope, error codes, pagination, timestamps).
- **FR-API-02 (M)** Every endpoint shall be declared via the shared pipeline (`defineRoute`) with Zod schemas that also generate the OpenAPI document; route files shall contain no domain logic.
- **FR-API-03 (M)** Server-side enforcement of validation, logic visibility, caps, token state, and scoring shall be independent of any client behavior.
- **FR-API-04 (M)** Respondent-plane capability shall be limited to the respondent's own response via possession of distribution/response keys; definitions served to respondents shall be stripped of admin-only fields.
- **FR-API-05 (M)** Public endpoints shall be rate-limited; error responses shall use the uniform envelope with stable machine codes and request IDs.
- **FR-API-06 (C, Phase 6)** Machine plane: admin-managed service tokens (scoped, argon2-hashed, revocable, per-client rate limits, last-used tracking), idempotency keys on mutations, signed outbound webhooks (`collect.response.completed`, `collect.distribution.cap-reached`), and a generated typed TS client.

### 3.13 Audit, privacy & data lifecycle (FR-PRIV) — Phases 0–5

- **FR-PRIV-01 (M)** Every admin mutation, auth event, and export shall append to an app-layer append-only audit log, queryable by the admin.
- **FR-PRIV-02 (M)** Every instrument shall carry consent text (editable; sensible default template) presented before or with the first question.
- **FR-PRIV-03 (M)** Raw IP addresses shall never be stored; only a salted, daily-rotating hash may be kept for dedup heuristics.
- **FR-PRIV-04 (M)** A per-instrument retention setting shall drive a scheduled sweep that anonymizes or deletes response data past retention while preserving aggregates.
- **FR-PRIV-05 (M)** A documented, scripted deletion path shall remove a specific respondent's data (by response key, token, or invitee email) across responses, projections, and files.
- **FR-PRIV-06 (M)** Respondent data shall leave the system only to N8E's own S3; never to third parties.

---

## 4. External interface requirements

### 4.1 User interfaces

- **UI-01 (M)** All UI shall conform to the Veritas UI design system (Build Plan §5), which inherits the locked n8elabs.com visual language: editorial dark-first aesthetic; accent-as-signal (Theme Green default, Maroon/Neon-Red alternate); prohibitions on gradients, gradient text, glows, neon blobs, grey-heavy UI, and cyberpunk/synthwave/HUD/CRT/grid-floor styling; logo never recolored, filtered, or redrawn; motion only with reason.
- **UI-02 (M)** Fixed strings shall never be paraphrased: `IN DATA VERITAS`, `FOR INDIA, BY NORTHEASTERN INDIA.`
- **UI-03 (M)** Respondent themes Veritas Dark (default) and Veritas Light shall both be selectable per instrument and both meet the accessibility bar (NFR-A11Y).
- **UI-04 (M)** Brand hex values and typefaces shall be imported from the n8elabs.com repository tokens, not invented.

### 4.2 Software interfaces

- **SI-01 (M)** PostgreSQL 16 via Drizzle ORM; migrations additive within a release.
- **SI-02 (M)** Amazon S3 (uploads/, backups/, exports/) via AWS SDK v3; presigned URLs only; bucket versioning + lifecycle (backups: 90d standard → Glacier 1y, pending confirmation).
- **SI-03 (M)** Amazon SES via AWS SDK v3 (see FR-EMAIL-01); SES production access is a launch dependency.
- **SI-04 (M)** The N8E API (per N8E API Spec) is the sole programmatic interface; OpenAPI document generated from source schemas.

### 4.3 Communication interfaces

- **CI-01 (M)** HTTPS only at `collect.n8elabs.com` (Caddy auto-TLS); HTTP redirects to HTTPS; HSTS enabled.
- **CI-02 (M)** Security headers including a CSP without `unsafe-inline`; no mixed content.

## 5. Non-functional requirements

### 5.1 Performance (NFR-PERF)

- **NFR-PERF-01 (M)** Respondent route (`/s/[key]`) client JS ≤120KB gzipped, CI-gated; ECharts and admin code shall never load on respondent routes.
- **NFR-PERF-02 (M)** Respondent LCP <2.5s on simulated Slow-4G, mid-range Android profile.
- **NFR-PERF-03 (M)** Answer patch round-trip (server processing) p95 <150ms at nominal load; completion transaction p95 <400ms.
- **NFR-PERF-04 (M)** Analytics aggregates for a 5,000-response instrument shall compute in <1.5s server time per query.
- **NFR-PERF-05 (S)** The system shall remain functional at 50 concurrent active respondents on the reference instance.

### 5.2 Reliability & data durability (NFR-REL)

- **NFR-REL-01 (M)** Nightly automated `pg_dump` to S3; failure of the backup job shall surface on the admin home.
- **NFR-REL-02 (M)** A scripted restore drill (fresh container, row-count report) shall exist and pass before launch and be runnable on demand.
- **NFR-REL-03 (M)** Partial responses shall survive app restarts and deploys (no in-memory response state).
- **NFR-REL-04 (M)** All job workers shall be idempotent with retry/backoff and a dead-letter surface.
- **NFR-REL-05 (S)** Single-instance availability target 99.5% monthly; `/api/core/v1/health` checked by an external uptime monitor.

### 5.3 Security (NFR-SEC)

- **NFR-SEC-01 (M)** Server-authoritative enforcement independent of client behavior (restates FR-API-03 as a system property; penetration of client code shall confer no data capability).
- **NFR-SEC-02 (M)** Passwords argon2id; TOTP mandatory; sessions signed; token comparisons constant-time; login throttling per FR-AUTH-02.
- **NFR-SEC-03 (M)** Rate limiting on all public endpoints; request-ID traceability across logs and error envelopes.
- **NFR-SEC-04 (M)** Dependency hygiene: `pnpm audit` clean of criticals at each release; CI license allowlist (MIT/Apache-2.0/BSD/ISC) blocking merge on violation.
- **NFR-SEC-05 (M)** No secrets in the repository; configuration via environment; secrets documented in the runbook.

### 5.4 Privacy & compliance (NFR-PRIV)

- **NFR-PRIV-01 (M)** The system shall support N8E's obligations as data fiduciary under India's DPDP Act 2023: transparent identity (BrandFrame), consent (FR-PRIV-02), retention limits (FR-PRIV-04), deletion (FR-PRIV-05), and no third-party disclosure (FR-PRIV-06).
- **NFR-PRIV-02 (M)** Data residency: all persistent data in N8E's AWS account, single chosen region (ap-south-1 recommended, pending confirmation).

### 5.5 Accessibility (NFR-A11Y)

- **NFR-A11Y-01 (M)** WCAG 2.1 AA contrast in both respondent themes and the admin dark theme.
- **NFR-A11Y-02 (M)** Every respondent flow completable via keyboard alone and via screen reader; automated axe checks in e2e; focus always visible; touch targets ≥44px.
- **NFR-A11Y-03 (M)** `prefers-reduced-motion` shall replace movement with opacity transitions across all surfaces.
- **NFR-A11Y-04 (M)** Lighthouse accessibility score ≥95 on the respondent route at launch.

### 5.6 Usability (NFR-USE)

- **NFR-USE-01 (M)** A respondent shall complete a 10-question conversational survey on a phone with no instruction; no respondent action shall require a manual.
- **NFR-USE-02 (S)** The admin shall create and publish a basic survey within 15 minutes of first exposure, using the builder benchmark instrument (FR-BLD-04).

### 5.7 Maintainability & portability (NFR-MNT)

- **NFR-MNT-01 (M)** Definition of done per Build Plan: tests green in CI, typecheck/lint clean, a11y not regressed, bundle gate green, progress log updated.
- **NFR-MNT-02 (M)** Engine behavior locked by golden vectors; every field bug adds a vector before its fix merges.
- **NFR-MNT-03 (M)** The full stack shall run identically via Docker Compose on the AWS instance and the Windows dev machine; developer scripts cross-platform (Node).
- **NFR-MNT-04 (M)** Old instrument snapshots shall remain parseable indefinitely (`schemaVersion` discipline).

## 6. Design & implementation constraints

- **CON-01 (M)** Dependencies: permissive licenses only (MIT/Apache-2.0/BSD/ISC); no GPL/AGPL; no unpaid commercial components; wrapping does not exempt licensing.
- **CON-02 (M)** Infrastructure: one ARM instance + S3 + SES + DNS; no RDS, Redis, Kubernetes, load balancers, or additional services in v1; indicative budget $15–25/month.
- **CON-03 (M)** Single admin account; no multi-tenancy, client accounts, signup, or billing anywhere in the v1 codebase.
- **CON-04 (M)** Stack fixed: Next.js (TS strict) + PostgreSQL + Drizzle + pg-boss + Tailwind/shadcn + Framer Motion + ECharts (admin only) per Build Plan §2.4; substitutions require a DECISIONS.md entry.
- **CON-05 (M)** Architectural evolution governed by the N8E API Spec §6.3 decision rule: namespaced modular monolith now; no gateways/microservices before a real second consumer.

## 7. Verification & acceptance

- **V-01** Each requirement is verified by the mechanism of its build-plan phase: unit/golden-vector tests (engine, schema), API/service tests incl. race tests (caps, tokens, idempotent projection), Playwright e2e (builder benchmark, respondent journeys incl. keyboard-only and resume, poll flow), CI gates (bundle, license, a11y), and scripted drills (backup/restore).
- **V-02** v1 acceptance = all Phase 0–5 milestones' Verify steps pass **and** one real instrument has been fielded end-to-end: built in the builder, published, distributed by public link and tokenized email invite, answered on mobile, analyzed on the dashboard, exported to CSV — with the restore drill green in the same week.
- **V-03** Requirements marked (C) are explicitly not acceptance criteria for v1; they are the contracted scope of Phase 6+.

### 7.1 Traceability (requirement group → build-plan phase)

| Group                   | Phase | Group                                | Phase                  |
| ----------------------- | ----- | ------------------------------------ | ---------------------- |
| FR-AUTH                 | 0     | FR-POLL                              | 3                      |
| FR-INST, FR-LOG, FR-BLD | 1     | FR-ANLT, FR-EXP-01/02                | 4                      |
| FR-QST, FR-RESP         | 1–2   | FR-EMAIL-01, FR-PRIV, hardening NFRs | 5                      |
| FR-API-01…05            | 0–5   | All (C) items                        | 6+                     |
| FR-DIST                 | 3     | LLM text coding                      | 7 (schema-ready in v1) |

## 8. Future requirements (contracted direction, not v1)

Phase 6: randomization, quotas by segment, piping, invite/reminder waves, cross-tabs, XLSX, drag-drop builder, templates, multi-language, embeds, N8E API machine plane. Phase 7: LLM-assisted open-text coding (additive tables; provider decision open). Phase 8: forum/community (separate SRS). Future N8E products (CMS, management apps) shall consume the N8E API per its spec — no requirement in this SRS may be satisfied in a way that blocks that path.

---

_Fixed strings, never paraphrased: `IN DATA VERITAS` · `FOR INDIA, BY NORTHEASTERN INDIA.`_
