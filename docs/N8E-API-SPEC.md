# N8E API — Specification & Implementation Guide (v1)

**Version:** 1.0 · **Date:** 19 Aug 2026 · **Owner:** N8E Labs
**Repo home:** `docs/N8E-API-SPEC.md` · **Companions:** `docs/BUILD-PLAN.md` (what to build, when), `CLAUDE.md` (conduct)
**Scope:** this document defines what the N8E API _is_, how a request flows through it, the conventions every endpoint must follow, how to implement it in the N8E Collect codebase, and how it grows into the company-wide API that future N8E apps (CMS, management tools) flow through.

---

## 1. What the N8E API is

The N8E API is N8E Labs' **proprietary application contract**: the single, authoritative interface through which N8E software reads and writes N8E data. "Proprietary" means N8E owns the contract, the naming, and the behavior — the implementation underneath is permissively-licensed open source throughout (per the licensing policy in the build plan §2.4 / product spec §3), and that is not a contradiction: the _API_ is the product-shaped thing N8E owns; the libraries are commodity parts.

Three duties, in priority order:

1. **Authority.** Every write to N8E data passes through it. It enforces validation, logic, quotas, token state, scoring, and audit — clients (browsers today, apps tomorrow) are presentation only. No app, script, or future product touches Postgres directly except through this layer's services.
2. **Contract stability.** Endpoints follow one set of conventions (§4) and are versioned, so a consumer written today keeps working while the platform evolves underneath.
3. **Reusability.** The API is structured as **product namespaces over a shared core**, so future N8E products plug in beside Collect rather than being bolted onto it.

### 1.1 The one-sentence architecture

> Today the N8E API is a well-disciplined module _inside_ the Collect app (a modular monolith on one box); its namespacing, auth, and conventions are designed so that tomorrow the same contracts can be served to many N8E apps — and extracted to `api.n8elabs.com` — without rewriting a single consumer.

### 1.2 Namespace map

```
/api/core/v1/…       shared platform services (product-agnostic)
    auth/…           admin session, TOTP; later: service-token management
    files/…          presigned S3 upload/download flows
    audit            append-only audit query
    health           liveness/readiness

/api/collect/v1/…    the Collect product namespace
    instruments/…    admin: CRUD, publish, duplicate, distributions, analytics, export
    s/[key]…         respondent runtime: resolve, start
    r/[responseKey]… respondent runtime: patch, complete, files
    p/[key]/results  public poll results

/api/cms/v1/…        FUTURE product namespace (reserved, not built)
/api/<app>/v1/…      any future N8E management app (reserved pattern)
```

**Rule:** product-first, then version — each product versions independently (`collect/v1` can reach `collect/v2` while `cms/v1` stays put). `core/v1` is the shared floor every product stands on. Nothing ships outside a namespace.

---

## 2. How it works — the request lifecycle

Every request, human or machine, admin or respondent, passes the same pipeline. This is the mechanic to internalize; every endpoint is this pipeline plus a handler.

```
 1. Edge        Caddy: TLS, gzip/brotli, forwards to Next
 2. Routing     Next route handler at src/app/api/<ns>/v1/…
 3. RequestId   generate ULID; attach to logs + response header + error envelope
 4. Rate limit  token bucket keyed by (route class, client identity or IP-hash)
 5. AuthN       resolve identity: admin session cookie | service token (Bearer)
                | respondent context (distribution key / response key) | anonymous
 6. AuthZ       scope check: does this identity hold the scope this route declares?
                (admin session ⇒ all collect:* + core:*; tokens carry explicit scopes)
 7. Validate    parse body/query with the endpoint's Zod schema — the SAME schema
                that generates its OpenAPI entry and its TS client types
 8. Handle      thin handler calls a domain service in src/lib/services/…
                (services are pure of HTTP: they take (ctx, input), return domain
                results or throw typed domain errors)
 9. Audit       mutating calls append to audit_log inside the same transaction
10. Envelope    success → { data, meta? } · failure → { error } (§4.3); requestId always present
```

Two identity planes, deliberately separate:

- **Humans:** the single N8E admin, via httpOnly SameSite=Lax session cookie + TOTP (build plan §7). CSRF = SameSite + origin check on mutations. Browsers never hold bearer tokens.
- **Machines (the future-apps plane):** `Authorization: Bearer n8e_live_<random>` **service tokens** — created by the admin, argon2-hashed at rest (only the prefix stored recognizably), scoped (§4.5), revocable, individually rate-limited, fully audited. This is the plane the CMS and every future management app will use. The table ships in the schema now; the endpoints ship in Phase 6 (build plan §11) — there is no machine consumer before then.

Respondent endpoints are a third, narrower context: no account, no token — identity is possession of a valid distribution/response key, and capability is limited to exactly that response.

---

## 3. Data surface — what the API exposes (and hides)

The API never exposes raw tables; it exposes **resources** with deliberate shapes:

| Resource                | Backed by                            | Notes                                                                                                                         |
| ----------------------- | ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| `Instrument`            | instruments (+current version info)  | Admin shape includes draft; respondent shape is the _stripped published definition_ only (no internal notes, no admin labels) |
| `InstrumentVersion`     | instrument_versions                  | Read-only by contract, immutable by trigger                                                                                   |
| `Distribution`, `Token` | distributions, tokens                | Token values returned ONCE at creation, never again                                                                           |
| `Response`              | responses (+items)                   | Admin reads; respondent can only append to their own via response key                                                         |
| `Analytics aggregates`  | response_items via src/lib/analytics | Chart-ready shapes; raw SQL never leaves the server                                                                           |
| `Export`                | jobs + S3                            | Async: create → poll status → signed URL                                                                                      |
| `AuditEvent`            | audit_log                            | Read-only, admin only                                                                                                         |
| `File`                  | response_files + S3                  | Only presigned, short-lived URLs; the API never streams file bytes                                                            |

Hiding rules that future apps inherit: internal IDs are UUIDs (no sequential leakage); respondent PII fields (invitee email/label) appear only in admin-scoped reads; nothing anonymous can enumerate (`/s/[key]` resolves a key, never lists).

---

## 4. Conventions — the N8E API constitution

Every endpoint in every namespace, forever. Deviations require a DECISIONS.md entry.

### 4.1 Resources & paths

Plural nouns, kebab-case paths, UUID ids: `GET /api/collect/v1/instruments/{id}`. Actions that aren't CRUD are POST sub-paths: `…/instruments/{id}/publish`, `…/duplicate`. No verbs in resource names, no RPC-style grab-bags.

### 4.2 Requests

JSON bodies, camelCase keys, ISO-8601 UTC timestamps. Query params for filtering (`?status=live`), sorting (`?sort=-createdAt`), and cursor pagination (`?cursor=…&limit=50`, max 200). Machine clients SHOULD send `Idempotency-Key` on mutations; the server stores key→result for 24h and replays the original result on retry (required for the future-apps plane; the admin UI may omit it).

### 4.3 Responses — one envelope

```jsonc
// success
{ "data": { … } | [ … ], "meta": { "nextCursor": "…", "requestId": "01J…" } }
// failure — always this shape, always a stable machine code
{ "error": { "code": "instrument/version-immutable", "message": "Published versions cannot be modified.",
             "fieldErrors": { "pages[2].questions[0].key": "duplicate key" }, "requestId": "01J…" } }
```

Error codes are namespaced strings (`auth/…`, `instrument/…`, `distribution/…`, `response/…`, `core/…`), registered in one file (`src/lib/api/errors.ts`), documented in the generated OpenAPI. HTTP status mirrors the class: 400 validation, 401 unauthenticated, 403 scope, 404, 409 conflict (caps, immutability, idempotency clash), 429, 500.

### 4.4 Versioning & change policy

Major version in the path per product. **Additive changes** (new endpoints, new optional fields, new enum values marked extensible) do not bump. **Breaking changes** (removing/renaming fields, changing semantics) require `v2` served alongside `v1` for a deprecation window. The OpenAPI document is the changelog's source of truth; CI diffs it and fails on undeclared breaking changes (oasdiff or equivalent permissive tool).

### 4.5 Scopes

`<product>:<capability>`: `collect:read`, `collect:write`, `collect:respond` (implicit respondent plane), `core:files`, `core:audit:read`; future `cms:read`, `cms:write`. Route handlers _declare_ required scopes in their definition — enforcement is pipeline, not per-handler code.

### 4.6 Webhooks (Phase 6+, contract reserved now)

Outbound events (`collect.response.completed`, `collect.distribution.cap-reached`) POSTed to admin-registered URLs, HMAC-SHA256 signed (`X-N8E-Signature`), retried with backoff. This is how future apps _react_ to Collect without polling.

---

## 5. How to build it — implementation guide

### 5.1 Module layout (inside the Collect repo)

```
src/lib/api/
├─ pipeline.ts      # defineRoute(): composes requestId → rateLimit → authN → authZ(scopes)
│                   #   → zod-validate → handler → envelope; ONE place, used by every route file
├─ envelope.ts      # ok(data, meta) / fail(err) helpers — the only way responses are made
├─ errors.ts        # ApiError class + the full registered code table
├─ auth.ts          # resolveIdentity(): session | service token | respondent | anon
├─ scopes.ts        # scope constants + check
├─ ratelimit.ts     # in-memory token buckets (per identity/IP-hash + route class)
├─ idempotency.ts   # key store (Postgres table, 24h TTL sweep)
└─ openapi.ts       # builds the OpenAPI doc from route definitions (zod-openapi)

src/lib/services/   # domain logic, HTTP-free: instruments.ts, distributions.ts,
                    # responses.ts, analytics.ts, exports.ts, files.ts, audit.ts
```

### 5.2 The route pattern (every endpoint looks like this)

```ts
// src/app/api/collect/v1/instruments/[id]/publish/route.ts
export const POST = defineRoute({
  scope: "collect:write",
  params: z.object({ id: z.string().uuid() }),
  handler: async (ctx) => publishInstrument(ctx, ctx.params.id), // service does the work
});
```

Route files contain _no_ logic — `defineRoute` gives you the pipeline, the service gives you the behavior, and the same Zod objects feed validation, OpenAPI, and the generated client. That triple-duty is the entire trick: **one schema, three artifacts, zero drift.**

### 5.3 Services contract

`(ctx, input) → result | throw ApiError` where `ctx = { db|tx, identity, requestId, audit(), now() }`. Services never import Next, never touch `Request`/`Response`, and take an injectable transaction — which is what makes them callable from route handlers today, from pg-boss workers already, and **from a future CMS process in-process or over HTTP without change**. Transactional invariants (cap/token races) live in services, tested at service level.

### 5.4 Schema additions (beyond build plan §3.1)

```sql
api_clients (            -- Phase 6 implementation; table ships in Phase 0 schema
  id uuid PK, name text NOT NULL,            -- "n8elabs-cms"
  token_prefix text NOT NULL,                -- "n8e_live_3f9a" (recognizable, loggable)
  token_hash text NOT NULL,                  -- argon2id of full token
  scopes text[] NOT NULL,
  rate_limit_per_min int NOT NULL default 120,
  created_at timestamptz default now(), revoked_at timestamptz, last_used_at timestamptz
)
idempotency_keys ( key text PK, client_id uuid, response jsonb, created_at timestamptz )
```

### 5.5 Contract testing & artifacts

Per-endpoint spec tests assert envelope shape, error codes, and scope enforcement (a `collect:read` token calling a write endpoint must 403 — tested generically across all routes by iterating the route registry). `pnpm api:openapi` emits `openapi.json`; `pnpm api:client` generates the typed TS client into `clients/ts/` (`@n8e/api-client`) — unpublished for now, and **the CMS's first dependency later**. CI: OpenAPI build + breaking-change diff + generic scope tests are green before any milestone completes.

### 5.6 Build order (maps to build plan §11)

- **Phase 0.2/0.3:** tables incl. `api_clients` + `idempotency_keys`; `pipeline.ts`, `envelope.ts`, `errors.ts`, `auth.ts` (session + respondent planes only).
- **Phase 1–5:** every Collect endpoint built _only_ via `defineRoute` + services; OpenAPI generation runs from Phase 1 so the doc grows with the product.
- **Phase 6:** service-token endpoints + admin UI (create/scope/revoke), idempotency store, webhooks, published client package. This is the moment the machine plane switches on — when its first real consumer exists.

---

## 6. The multi-app future — CMS and beyond

**Is it possible to run the CMS and other management apps through the N8E API? Yes — this document is shaped so the answer stays yes.** Concretely:

### 6.1 What a new product reuses on day one

Identity for machines (service tokens + scopes), the pipeline and envelope, files (core/v1/files → S3), audit, jobs conventions, the OpenAPI/client toolchain, and the conventions constitution (§4). A new product = a new namespace + its own services + its own tables — _zero_ new architecture.

### 6.2 What integration looks like, concretely

- The CMS (say `cms.n8elabs.com`, its own app) holds a service token scoped `cms:* collect:read`. It renders a poll inside a website it manages by calling `GET /api/collect/v1/instruments/{id}` (stripped definition) — or simply embeds Collect's Phase-6 embed widget. A management app files respondents' uploads through `core/v1/files`. A reporting app listens to `collect.response.completed` webhooks.
- New CMS endpoints (`/api/cms/v1/pages`, `…/media`) follow §4 and live first as a namespace **inside whichever app is cheapest to run them in** — the modular monolith extends before it fragments.

### 6.3 Evolution stages — and the decision rule

1. **Now:** one app, one box; N8E API = disciplined module (namespaces, pipeline, contracts).
2. **Second consumer arrives:** CMS runs as its own app (same or second box) and talks to Collect **over HTTPS with a service token**. No extraction — Collect _is_ the collect-API server; core stays where it is.
3. **Only if pain demands it** (deploy coupling, independent scaling, a third+ product): extract `api.n8elabs.com` as its own service — the routes move, services move with them, contracts don't change, consumers don't notice. Caddy path-routing can even make `api.n8elabs.com/collect/v1` live before extraction by proxying to the Collect box.

**The decision rule (binding):** extract on _pain_, not on ambition. The classic failure here is building the grand company API gateway before a second consumer exists — you'd pay platform tax on day one of a one-product platform, on a $15/month budget. Discipline now (namespaces, envelope, services, scopes) buys the option; the option is exercised only when the CMS is real.

### 6.4 Non-goals (now)

No API gateway, no microservices, no GraphQL, no OAuth2 authorization server, no public third-party developer API, no SDKs beyond the generated TS client. Each becomes thinkable _after_ a second consumer exists — most will still be unnecessary.

---

_The N8E API is the contract; Collect is its first tenant. Build the contract like the CMS is watching._
