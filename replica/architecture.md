# Architecture: AI Receptionist (working name), a rebuild of Maple's core features

Inputs: `spec.md` (the product spec), `replica/recon.md` (Maple recon), `replica/features.csv`.
Schema: `packages/db/migrations/0001_init.sql` (migration 0001; tested, see "Schema").
Date: 2026-10-21

## Stack

The stack is the one `spec.md` §7.2 already chose. The changes are fewer moving parts (one database that also runs the job queue, two deployables) and managed versions of each piece.

| layer | choice | why |
| --- | --- | --- |
| dashboard | Next.js (App Router) + TypeScript + Tailwind, on Vercel | spec §7.2. The dashboard is a plain client of the API; design tokens come from `/replica-design`. |
| API, telephony, voice gateway | One Fastify (TypeScript, Node 22 LTS) app on Fly.io, run as two process groups: `web` (HTTP + WebSockets) and `worker` | spec's modular monolith. Twilio Media Streams need WebSockets that stay open for the whole call, which serverless can't hold. Fly runs near Twilio and OpenAI (US East) and drains connections on deploy. |
| phone carrier | Twilio Programmable Voice + bidirectional Media Streams | spec §12. The number search and purchase API covers S09; `<Dial>` covers transfers; `voiceFallbackUrl` covers outages. |
| voice model | OpenAI Realtime API, model pinned in `OPENAI_REALTIME_MODEL` | spec §7.2. Speech-to-speech with function calling, and server voice-activity detection for interruptions. |
| POS | Square OAuth, Locations, Catalog and Orders APIs + webhooks, official `square` SDK, `SQUARE_API_VERSION` pinned at 2026-08-19 or later | spec §11. That version is the first with nested modifiers (`child_modifier_list_ids`). |
| database | Postgres on Supabase (15+; 17 preferred) | One database for everything, including the job queue. Managed backups and point-in-time restore. |
| ORM / migrations | No ORM: reviewed SQL migration files (`0001_init.sql`) and small typed repository functions over `pg` | Changed from Drizzle during replica-backend. The schema is the source of truth (triggers, composite keys and RLS do most of the work), a second model of it would only drift, and plain SQL makes the per-transaction `set_config` that RLS needs trivial. |
| auth | Supabase Auth: email one-time code + Google, TOTP MFA required for platform admins | Matches Maple's passwordless login (S01) and spec §15.1. Fastify verifies the JWT against Supabase's JWKS. |
| jobs | pg-boss (a queue stored in the same Postgres) | A job is enqueued in the same transaction as the order write, so no job is lost if the process dies. Swap for BullMQ + Redis only if volume demands it. |
| live dashboard updates | Server-Sent Events from Fastify, fed by Postgres `LISTEN/NOTIFY` | Powers the live order queue (S41) and alert banners with no extra vendor. |
| payments | None for orders (spec §3 non-goal). Platform subscription billing: Stripe Billing later (a could row) | |
| email | Resend: staff alerts, invitations, and SMTP for Supabase Auth codes | |
| SMS | Twilio Messaging for staff alerts. Needs A2P 10DLC registration, which takes 1–4 weeks, so start it in M0. | Caller-facing texts are a could row. |
| files | Supabase Storage, private bucket, signed URLs: call recordings only, and only if enabled | Spec: recordings off by default. |
| secrets | Fly and Vercel environment secrets. Square tokens are AES-256-GCM encrypted in the database, with a `key_version` column for rotation. | spec §15.2. The decryption key exists only in the Fly app. |
| observability | pino JSON logs → Better Stack (or Axiom); Sentry; OpenTelemetry trace IDs (`restaurant_id`, `call_id`, `order_id`); uptime checks on `/healthz` and the media WebSocket | spec §16.3 |
| hosting | Vercel (dashboard) + Fly.io (server) + Supabase (database, auth, storage), each with staging and production | |

There are two deployables and no microservices. Repository layout (a smaller version of spec Appendix A):

```
apps/dashboard      Next.js
apps/server         Fastify: api/, telephony/, voice/ (gateway + tools), webhooks/, worker.ts
packages/db         Drizzle models, tenant-scoped repositories, withTenant() / withSystem()
packages/domain     order state machine, menu validation, hours logic (pure, unit-tested)
packages/pos        PosAdapter interface + square/ and dashboard-ticket/ implementations
packages/contracts  zod schemas shared by API, voice tools and dashboard
```

## The P0 decision, built in

Maple's docs (recon sources 28–29) say Square orders must be paid before Maple submits them; pay-in-store is "not available" on Square. That backs up the spec's §1 warning. The architecture therefore never depends on the answer to the Square test:

- **`PosAdapter`** has two implementations:
  - **`DashboardTicketAdapter`** "submits" by putting the order on the live queue (S41) with a sound alert, plus an SMS/email alert. When staff tap Accept, the order becomes `RECEIVED_BY_RESTAURANT`. This works on day one, but needs Third Space's written approval.
  - **`SquareAdapter`** calls `CreateOrder` with catalog IDs, a `PICKUP` fulfillment, `reference_id` = our order ID, and the order's idempotency key.
- **The database enforces the gate.** `locations.ordering_mode = 'SQUARE'` is impossible unless `pos_feasibility = 'VERIFIED_NATIVE'`, and dashboard tickets need `FALLBACK_APPROVED` (check constraints, tested).
- **Prices are authoritative in both modes.** Even in ticket mode, totals come from Square `CalculateOrder`, which prices and taxes an order without creating it.
- **Ruled out without written approval and a change of scope:** pay-by-link, and recording a fake "external" payment to make the order appear in Square. The fake payment would mark the order paid in Square's books before any money changes hands (FR-SQUARE-008).

## Schema

**Tables: 38, plus 2 views. Access rules: checks in the data layer first, with Postgres row level security as the backstop.** The full SQL is in `packages/db/migrations/0001_init.sql`.

- **How tenancy works:**
  - Every request runs inside `withTenant({restaurantId, userId}, fn)`. That opens a transaction and sets `app.restaurant_id` and `app.user_id`, and every repository function also filters by `restaurant_id`.
  - Row level security is enabled and forced on all 38 tables, with policies for the `app_rw` role. A forgotten `where` clause returns nothing instead of another tenant's data.
  - Cross-tenant system work goes through one `withSystem(fn)` helper: tenant resolution from the called number, webhook ingress, and schedulers.
  - Child rows use composite foreign keys `(parent_id, restaurant_id)`, so a row can't point at another tenant's parent even in system mode.
- **The order rules live in the database too:**
  - Any change to items, modifiers or customer details bumps `orders.version`.
  - An edit after confirmation flips the order back to `DRAFT`.
  - Only a confirmed, fully priced, current version can enter submission states.
  - Submitted content is frozen.
  - Status changes must follow the spec §9 transition table, and every change is logged to `order_events` by a trigger.
  - Every submission attempt must carry the order's current idempotency key.
  - There can be only one open order per call.
- **On delete:**
  - Configuration and menu rows cascade with their location.
  - `calls`, `orders` and `callback_requests` use **restrict**. They're business records, and the retention/offboarding job deletes them deliberately.
  - Menu rows are soft-deleted (`is_deleted`), so order lines can safely `restrict` against them.
  - `audit_logs` has no foreign key on purpose, so it outlives the tenant.
- **Tested:** `schema.sql` was applied to Postgres 18 (PGlite) with **40 checks, 40 passing**. They cover isolation between two tenants, no context returning no rows, cross-tenant writes blocked, the Square gate, one tenant per called number, one tenant per Square location, one owner per restaurant, the full order lifecycle with edit-after-confirm, frozen submissions, idempotency-key binding, the transition log, append-only audit/event tables, one running sync per location, and views respecting tenancy. The test now lives in `packages/db/test` and runs on a real Postgres 18 (see backend.md).

| group | tables |
| --- | --- |
| tenancy and people | `users`, `restaurants`, `locations`, `memberships`, `invitations`, `support_access_grants` |
| location config | `location_settings`, `phone_numbers`, `transfer_targets`, `business_hours`, `special_hours`, `notices`, `faqs`, `pronunciations` |
| Square and menu | `pos_integrations`, `oauth_states`, `catalog_syncs`, `menu_categories`, `menu_items`, `menu_variations`, `modifier_lists`, `modifiers`, `modifier_child_lists`, `item_modifier_lists`, `menu_aliases` |
| calls | `calls`, `call_events`, `call_transcripts`, `transfers`, `callback_requests` |
| orders | `orders`, `order_items`, `order_item_modifiers`, `order_events`, `pos_submission_attempts` |
| platform | `webhook_events`, `alerts`, `audit_logs` |
| views | `location_menu_status` (last sync, stale flag), `usage_monthly` (minutes, transfers, cost by tenant) |

Where the schema departs from spec §13, and why:

| change | why |
| --- | --- |
| Added `locations` under `restaurants` | Maple ties phone number, agent, menu, hours and POS to each location. FR-TENANT-006 wants multiple locations later. It's cheap now and a painful migration later. |
| `restaurant_settings` → `location_settings` | Settings follow the location. |
| Transfer destinations moved out of `restaurant_phone_numbers` into `transfer_targets` | Numbers we own (Twilio) and numbers staff answer are different things. Targets carry intent and hours for conditional transfers. |
| `webhook_events` stores only signature-verified deliveries (no `signature_valid` column) | Otherwise a forged request could claim an event ID before the real delivery arrives and get it deduplicated away. Failed checks go to metrics. |
| No local tax tables | Totals always come from Square `CalculateOrder` (FR-ORDER-007). If Square can't price the order, the AI says so and offers a transfer or callback. |
| `jobs` table → pg-boss's own schema | It's the queue. |
| FAQs gain edit-in-place, `valid_from`/`valid_until`, `source`, `reviewed` | These fix Maple's two weakest knowledge-base points: you can't edit an entry, and stale entries override live settings. |
| Square variations are kept as variations | The AI asks "which size?" instead of offering each size as its own item, as Maple does. |

## API

**Routes: 84** (77 admin endpoints across 68 rows, 6 telephony, 1 Square), plus 12 voice tools and 12 background jobs.

Admin API prefix: `/api/v1`. Every call carries a Supabase JWT in the `Authorization` header (bearer token, no cookies, so no CSRF), and CORS allows only the dashboard's origin. The tenant always comes from the path: load the location or restaurant, then check membership. It never comes from a body field. Roles follow spec §4:

- **OWNER:** everything.
- **MANAGER:** everything except members, ordering mode and feasibility sign-off, recording and retention, and disconnecting Square.
- **STAFF:** the live queue, accepting tickets, callbacks, orders, and the call list with phone numbers masked.
- **SUPPORT:** read-only, and only while an owner's time-limited grant is active.

Every write is audited.

| method path | does | who | input | output | flow |
| --- | --- | --- | --- | --- | --- |
| GET /me | current user, memberships, pending invites | signed in | – | user, memberships | F01 F14 |
| POST /restaurants | create restaurant + first location + settings + owner membership (one system transaction) | signed in | name, location {name, timezone, address} | restaurant, location | F01 |
| GET /restaurants/:rid | restaurant | member | – | restaurant | all |
| PATCH /restaurants/:rid | rename | OWNER | name | restaurant | F01 |
| GET /restaurants/:rid/locations | list locations | member | – | locations | F01 |
| POST /restaurants/:rid/locations | add a location (P1) | OWNER | location fields | location | – |
| GET /locations/:lid | details + menu status + feasibility | member | – | location | F01 F11 |
| PATCH /locations/:lid | address, phone, website, timezone, directions | OWNER MANAGER | partial | location | F11 |
| GET /locations/:lid/onboarding | checklist: number, Square, menu synced, 10+ FAQs, hours, transfer target, test call | member | – | tasks | F01 |
| PATCH /locations/:lid/ordering | set ordering mode + feasibility sign-off note | OWNER | ordering_mode, pos_feasibility, note | location | F01 F03 |
| GET /restaurants/:rid/members | list members | OWNER MANAGER | – | members | F14 |
| POST /restaurants/:rid/invitations | invite by email | OWNER | email, role, location_id? | invitation | F14 |
| DELETE /invitations/:id | revoke invite | OWNER | – | 204 | F14 |
| POST /invitations/accept | accept (email must match the token) | signed in | token | membership | F14 |
| PATCH /restaurants/:rid/members/:mid | change role or revoke | OWNER | role or status | membership | F14 |
| POST /restaurants/:rid/support-grants | time-boxed support access | OWNER | support email, scope, hours, reason | grant | – |
| DELETE /support-grants/:id | end support access | OWNER | – | 204 | – |
| GET /locations/:lid/phone-numbers/available | Twilio number search by area code | OWNER MANAGER | areaCode | numbers | F01 |
| POST /locations/:lid/phone-numbers | buy + set voice, status and fallback URLs | OWNER | e164 | phone number | F01 |
| GET /locations/:lid/phone-numbers | list numbers | member | – | numbers | F01 F13 |
| PATCH /phone-numbers/:id | fallback number, enable/disable | OWNER | partial | phone number | – |
| POST /locations/:lid/test-call/token | Twilio Voice SDK token for a browser test call (flagged `is_test`) | OWNER MANAGER | – | token, ttl | F10 F13 |
| GET /locations/:lid/settings | agent settings | member | – | settings | F10 |
| PATCH /locations/:lid/settings | greeting, voice, languages, ordering, after-hours, transfer, timeouts; recording and retention are OWNER only | OWNER MANAGER | partial | settings | F05 F10 |
| GET, POST /locations/:lid/transfer-targets | list / add. Rejects the AI number and the forwarded public number (loop guard) | OWNER MANAGER | label, e164, priority, intent, active_hours | target(s) | F04 |
| PATCH, DELETE /transfer-targets/:id | edit / remove | OWNER MANAGER | partial | target | F04 |
| GET /locations/:lid/hours | weekly store and ordering hours | member | – | hours | F11 |
| PUT /locations/:lid/hours | replace the whole week atomically; rejects overlaps | OWNER MANAGER | store[], ordering[] | hours | F11 |
| GET, POST /locations/:lid/special-hours | list by range / add a holiday or closure | OWNER MANAGER | on_date, closed or times, note | rows | F11 |
| DELETE /special-hours/:id | remove | OWNER MANAGER | – | 204 | F11 |
| GET, POST /locations/:lid/notices | temporary notices ("closed early today") | OWNER MANAGER | message, starts_at, ends_at | notices | F09 |
| PATCH, DELETE /notices/:id | edit / remove | OWNER MANAGER | partial | notice | F09 |
| GET, POST /locations/:lid/faqs | list / add | OWNER MANAGER | question, aliases, answer, valid_from/until | faq(s) | F09 |
| PATCH, DELETE /faqs/:id | edit in place / remove | OWNER MANAGER | partial | faq | F09 |
| POST /locations/:lid/faqs/templates | add our restaurant starter set as unreviewed drafts | OWNER MANAGER | template id | faqs | F09 |
| POST /locations/:lid/faqs/generate | job: draft entries from 1–3 website URLs (inactive until reviewed) | OWNER MANAGER | urls | job id | F09 |
| GET, POST /locations/:lid/pronunciations | hard-word list | OWNER MANAGER | term, spoken_as | rows | F10 |
| DELETE /pronunciations/:id | remove | OWNER MANAGER | – | 204 | F10 |
| POST /locations/:lid/integrations/square/connect | create OAuth state; return the authorize URL | OWNER MANAGER | environment | url | F01 |
| GET /integrations/square/oauth/callback | check state, exchange code, encrypt tokens, redirect to the location picker | Square redirect | code, state | 302 | F01 |
| GET /locations/:lid/integrations/square/locations | the seller's Square locations | OWNER MANAGER | – | locations | F01 |
| PUT /locations/:lid/integrations/square/location | claim a Square location; start a full sync | OWNER MANAGER | square_location_id | integration | F01 |
| POST /locations/:lid/integrations/square/disconnect | revoke at Square, wipe tokens, switch ordering off if in Square mode | OWNER | – | integration | – |
| GET /locations/:lid/integrations | status, scopes, last success/error, feasibility | member | – | status | F01 F08 |
| POST /locations/:lid/menu/sync | manual resync (max once a minute) | OWNER MANAGER | – | sync | F08 |
| GET /locations/:lid/menu/status | last success, last error, stale flag | member | – | status | F08 |
| GET /locations/:lid/menu | menu read model: categories, items, variations, modifier lists, search | member | view, q, cursor | page | F08 |
| PATCH /menu-items/:id/overlay | hide from the AI / 86 until a time (platform overlay) | OWNER MANAGER | ai_hidden, ai_unavailable_until | item | F08 |
| GET, POST /locations/:lid/menu/aliases | spoken names for items | OWNER MANAGER | item_id, variation_id?, phrase | aliases | F08 |
| DELETE /menu-aliases/:id | remove alias | OWNER MANAGER | – | 204 | F08 |
| GET /locations/:lid/calls | call list; filter by date, outcome, transferred, has order, search; phones masked for STAFF | member | filters, cursor | page | F06 |
| GET /calls/:id | summary, outcome, events, transfers, linked order; transcript only if enabled and MANAGER+ | member | – | call | F06 |
| GET /calls/:id/recording | short-lived signed URL (audited) | OWNER MANAGER | – | url | F06 |
| GET /locations/:lid/calls.csv | export | OWNER MANAGER | filters | csv | F06 |
| GET /locations/:lid/orders | order list by status and date | member | filters, cursor | page | F07 |
| GET /orders/:id | items, modifiers, timeline, submission attempts | member | – | order | F07 |
| POST /orders/:id/accept | ticket mode: `SUBMITTED_TO_POS` → `RECEIVED_BY_RESTAURANT` | STAFF+ | – | order | F03 F07 |
| POST /orders/:id/reconcile | re-run reconciliation with the same key (audited) | OWNER MANAGER | – | order | F12 |
| POST /orders/:id/cancel | cancel per the agreed workflow (audited) | OWNER MANAGER | reason | order | F07 |
| GET /locations/:lid/live | SSE: new tickets, order status, alerts | STAFF+ | – | event stream | F03 F07 |
| GET /locations/:lid/callbacks | callback queue | STAFF+ | status | rows | F04 |
| PATCH /callbacks/:id | mark done / cancelled | STAFF+ | status | row | F04 |
| GET /locations/:lid/alerts | open alerts | member | – | alerts | all |
| POST /alerts/:id/ack | acknowledge | STAFF+ | – | alert | all |
| GET /locations/:lid/analytics | calls, minutes, transfers, orders, conversion, top items | OWNER MANAGER | range | metrics | F06 |
| GET /restaurants/:rid/usage | monthly minutes, model usage, cost estimate | OWNER | month | usage | – |
| GET /restaurants/:rid/audit-log | audit trail | OWNER | filters, cursor | page | – |
| GET /healthz | liveness and readiness (database, queue lag) | public | – | 200 / 503 | – |

**Telephony ingress** (each request's Twilio signature is checked against the full public URL and POST params):

| method path | does | flow |
| --- | --- | --- |
| POST /webhooks/twilio/voice | Resolve the tenant from `To` (system lookup), create the `calls` row, return TwiML. If Ring Staff First is on, `<Dial timeout=20>` the store line first; otherwise `<Connect><Stream>` with a signed one-time token. After hours, ordering is off but the call is still answered. | F02 F03 F05 |
| POST /webhooks/twilio/ring-staff-result | `<Dial>` action after ring-staff-first: answered → outcome `STAFF_ANSWERED`; otherwise connect the AI | F05 |
| POST /webhooks/twilio/transfer-result | `<Dial>` action for AI transfers: record the result. If not connected: a missed-transfer alert, then reconnect the stream and resume (offer a callback) | F04 |
| POST /webhooks/twilio/transfer-whisper | TwiML read to staff before the caller is bridged: a short summary of the reason and any draft (FR-HANDOFF-006) | F04 |
| POST /webhooks/twilio/status | Call status callbacks: finish the call record and enqueue `call.finalize` | all |
| WS /voice/media | Twilio Media Stream ↔ OpenAI Realtime bridge. Verifies the one-time token in the stream's custom parameters. | F02 F03 F04 |

**Square ingress:** `POST /webhooks/square`. It verifies `x-square-hmacsha256-signature` over the *configured* notification URL plus the raw body, inserts into `webhook_events` (unique per event ID), returns 200, then enqueues processing. Events handled: `catalog.version.updated`, `order.updated` / `order.fulfillment.updated` (Square mode only; payloads carry IDs, so we call `RetrieveOrder`), and `oauth.authorization.revoked`.

**Webhooks out:** none in the MVP. A partner API is a could row.

**Twilio outage path:** each number's `voiceFallbackUrl` points at a Twilio-hosted TwiML Bin that dials `fallback_e164`. If our server is down, callers still reach a human (spec §12.4).

### Voice tools (server functions the model can call)

Tool arguments never include restaurant, location or call IDs. The gateway takes those from the trusted `calls` row. Menu references are short opaque handles (`m3`, `v7`) that the gateway maps to Square IDs, so raw IDs never reach the model or the caller.

| tool | does | guards |
| --- | --- | --- |
| `get_restaurant_info({topic})` | hours (open now, today, special hours, notices), address and directions, pickup policy, FAQ match (top 3) | Reads the cache only. Unknown topic → `{known:false}`, and the prompt says to offer a transfer. |
| `search_menu({query, category?})` | up to 5 candidates with variations, prices, and whether a choice is required | Excludes deleted, hidden, sold-out and overlay-86'd items. Returns `stale:true` if the menu is past its freshness limit. |
| `get_item_options({item})` | variations, modifier lists with min/max, options with prices, nested lists | – |
| `update_order_draft({op, line?, item, variation?, modifiers?, qty?, note?, expected_version})` | create or edit the draft (add, remove, change quantity, set modifiers, set note) | Optimistic concurrency on `expected_version`, so a replayed call is a no-op. Writes locally only, never to Square. |
| `set_customer_details({name, phone, phone_source})` | normalise to E.164; return the digits for read-back | `phone_source` must say whether the caller confirmed the caller-ID number (FR-CUSTOMER-002) |
| `validate_order_draft()` | missing required choices, invalid selections, stale-menu flag | – |
| `calculate_order_total()` | Square `CalculateOrder` → totals for this version → `READY_FOR_CONFIRMATION` | Square failure → no total → the AI says it can't confirm the total and offers a transfer or callback |
| `mark_customer_confirmation({version, confirmed})` | `CUSTOMER_CONFIRMED` for exactly this version | The server checks the version is current and the order is in read-back; the database enforces it too |
| `submit_confirmed_order()` | revalidate against the freshest menu, then `PosAdapter.submit` | Allowed only from `CUSTOMER_CONFIRMED`. Returns the verified state and the exact sentence the AI may say. |
| `request_human_transfer({reason})` | pick a target by intent and hours, then the gateway transfers | Never submits a draft just because the call is transferred |
| `request_callback({name, phone, preferred_window?})` | save a callback request + alert | Needs the caller's consent |
| `end_call()` | hang up politely | The server decides the outcome from state, not from the model |

### Jobs (pg-boss, `worker` process)

| job | schedule / trigger | what it does |
| --- | --- | --- |
| `catalog.full_sync` | on connect, manual resync, nightly 03:30 local | Pull ITEM, ITEM_VARIATION, CATEGORY, MODIFIER_LIST, MODIFIER for the chosen Square location; upsert; soft-delete missing rows. One at a time per location (unique index). |
| `catalog.incremental_sync` | `catalog.version.updated`, debounced 20 s per merchant | Search catalog objects changed since the high-water mark |
| `catalog.reconcile` | every 15 min | Cheap change check; run an incremental sync if anything changed. Covers missed webhooks (FR-MENU-008). |
| `catalog.staleness` | every 5 min | `CATALOG_STALE` alert; the voice tools stop taking orders past `menu_stale_max_age_seconds` |
| `square.refresh_tokens` | daily | Refresh tokens expiring within 7 days. On failure: `NEEDS_REAUTH`, ordering off, alert. |
| `order.reconcile` | 30 s, 2 min, 5 min, 15 min after `SUBMISSION_UNKNOWN` | Retry `CreateOrder` with the same key and body; otherwise look the order up by `reference_id`. Still unknown → `FAILED` + critical alert. Never mints a new key. |
| `webhook.process` | per stored event | Apply Square catalog, order and OAuth events idempotently |
| `call.finalize` | at call end | Outcome, duration, `purge_after`, summary (from redacted events; the transcript is used only if enabled) |
| `alerts.fanout` | on alert insert | SSE now, then email and SMS by severity, deduplicated |
| `retention.purge` | daily 04:00 UTC | Delete transcripts, recordings and events past `purge_after`; delete expired OAuth states and invitations |
| `usage.rollup` | nightly | Pull Twilio and OpenAI usage → `calls.cost_estimate_minor` |
| `faqs.generate` | on request (could) | Draft FAQs from URLs as unreviewed entries |

### The live call path

```
caller → Twilio → POST /webhooks/twilio/voice ─┬─ ring staff first? <Dial store 20 s> → answered: done
                                               └─ <Connect><Stream wss://…/voice/media token=…>
voice gateway: Twilio WS ⇄ OpenAI Realtime WS
  session.update: tenant prompt (greeting, AI disclosure, rules) + the tool list
  speech_started from caller → Twilio "clear" + cancel the response + truncate at the last played mark
  tool call → domain service (tenant from the call row) → result → model speaks
  transfer → Twilio REST: update the call with <Dial timeout=25 action=transfer-result><Number url=whisper>
           → no answer → transfer-result reconnects the stream; the AI resumes from saved state and offers a callback
```

## The parts that bite

- **Time zones and daylight saving:**
  - Hours are stored as local wall-clock times plus an IANA zone, and "open now" is computed in that zone.
  - Shifts can cross midnight (`closes_at < opens_at`).
  - Special hours are keyed by local date.
  - On DST change days, 02:00–03:00 doesn't exist or happens twice, so unit-test both.
  - Everything is stored in UTC.
- **Idempotency:**
  - Square `CreateOrder` reuses one key per logical submission, with the same body (`request_hash`). The key can only rotate after a definitive validation error, before resubmission, and the database enforces that.
  - Webhooks from Square and Twilio arrive more than once. Deduplication is on `(provider, provider_event_id)`.
  - The model can repeat a tool call. Mutating tools take `expected_version`, so a repeat does nothing.
- **Races:**
  - The model can emit parallel tool calls, so the gateway runs a call's tools one at a time and the order row is locked (`select … for update`).
  - A menu sync can land mid-call, so the order is revalidated right before submission.
  - Only one catalog sync runs per location (unique index).
  - Ring-staff-first and AI answering can't both "win", because the `<Dial>` action decides.
- **Timeouts:**
  - Square submission has an 8 s budget, with a filler line while it runs.
  - A timeout means `SUBMISSION_UNKNOWN`, then reconciliation. The caller hears only the verified state.
  - Two clarifications that fail (configurable) mean a transfer.
- **Latency:**
  - Tools read from Postgres, never Square, with a p95 target under 500 ms. Square is called only to price and to submit.
  - Fly, Supabase and OpenAI should run in one US East region.
  - Audio: pass G.711 μ-law straight through if the pinned Realtime model accepts it (`audio/pcmu` in the GA session schema). Otherwise transcode 8 kHz μ-law ↔ 24 kHz PCM16 in the gateway. Community reports differ on this, so prove it in M0.
- **Interruptions:** use server voice-activity detection. On `speech_started`, send Twilio `clear`, cancel the in-flight response, and truncate the assistant turn at the last audio mark Twilio confirmed playing.
- **Deploys mid-call:** Fly machines stop taking new streams and drain open ones for up to `max_call_seconds`. Never restart the `web` group during service hours without draining.
- **Rate limits:** Square 429 → exponential backoff with jitter and at most one sync per location. Twilio number search is throttled per user.
- **Multi-tenancy:**
  - The tenant comes from the called number (system lookup) and is stored on the call row. Tools never accept tenant IDs from the model.
  - Row level security is the backstop.
  - Every integration test runs with two tenants.
- **Square auth:**
  - Access tokens expire, so refresh daily ahead of time.
  - On `oauth.authorization.revoked`: `REVOKED`, ordering off, alert.
  - Sandbox and production keep separate apps and credentials.
- **Webhook signatures:**
  - Square signs the URL you *configured*. Behind Fly's proxy, `req.url` isn't it, so use `SQUARE_WEBHOOK_NOTIFICATION_URL`.
  - Capture the raw body before JSON parsing.
  - Twilio signs the full public URL plus the sorted POST parameters.
- **Menu search:** `pg_trgm` over item names and aliases, plus aliases the restaurant edits itself. Hand the model at most 5 candidates. Never let the model invent an item handle.
- **Money:** integer minor units (`bigint`) plus currency. Totals come from Square. Never use floats.
- **Phone numbers:** normalise with `libphonenumber-js` to E.164, read back digit by digit, and keep the caller-ID number separate from the number the caller confirms.
- **Privacy:**
  - Recordings are off and transcripts are opt-in.
  - Retention purge runs daily, and phones are masked in lists.
  - Provide a delete-by-phone admin action for data requests.
  - Review OpenAI and Twilio data retention terms before launch.
  - The greeting discloses that it's an AI.
  - Recording consent needs legal review for Third Space's jurisdiction.
- **Prompt injection:** caller speech is untrusted. Tools validate everything against the database. The prompt contains no secrets or IDs.
- **SMS and email:** 10DLC registration takes 1–4 weeks, so file it in M0. Set up SPF and DKIM for Resend on your domain.
- **Cost:** `max_call_seconds`, a silence hang-up, and per-tenant usage tracking from the first call.

## Build order

**M0: proof of concept (3–5 days, spec Phase 0; scripts, not product)**
- Square Sandbox, then live with Third Space: create an unpaid, catalog-referenced PICKUP order. Then check Dashboard, POS, Order Manager and KDS visibility, behaviour on retry with the same key, and behaviour on timeout. Write up `docs/square-poc-results.md` and get sign-off, which sets `pos_feasibility`.
- Latency prototype: Twilio ↔ Realtime. Test μ-law passthrough, interruptions, a 2-tool order, and a transfer with no answer.
- File 10DLC registration. Agree a fallback with Third Space in writing.

**M1: vertical slice (ugly, about 2 weeks).** A real call answers an hours question, then takes an order with a required modifier from the synced Square Sandbox menu. It reads the order back with a Square-priced total, gets a yes, and the ticket appears in S41, where staff tap Accept. The call then shows in S14.
- Screens: S01, S04 (minimal), S06 (Square connect + location picker), S09 (number), S41, S11, S12 (minimal), S14
- Tables: `users`, `restaurants`, `memberships`, `locations`, `location_settings`, `phone_numbers`, `business_hours`, `pos_integrations`, `oauth_states`, `catalog_syncs`, `menu_categories`, `menu_items`, `menu_variations`, `modifier_lists`, `modifiers`, `modifier_child_lists`, `item_modifier_lists`, `calls`, `call_events`, `orders`, `order_items`, `order_item_modifiers`, `order_events`, `pos_submission_attempts`, `webhook_events`
- Routes:
  - Admin: `GET /me`, `POST /restaurants`, `PATCH /locations/:lid/ordering`, phone-number search and buy, Square connect / callback / locations / location, `POST /menu/sync`, `GET /menu/status`, calls list, orders list / detail / accept, `GET /live`
  - Ingress: `/webhooks/twilio/voice`, `/webhooks/twilio/status`, `WS /voice/media`, `/webhooks/square`
  - Tools: everything except transfer and callback
- Adapter: `DashboardTicketAdapter`. Jobs: `catalog.full_sync`, `call.finalize`.

**M2: must-haves (about 3–4 weeks), by area from `features.csv`**

| area | screens | tables | routes / jobs |
| --- | --- | --- | --- |
| voice and handoff: AI disclosure, interruptions, silence and length limits, after-hours, transfer + timeout + resume, callbacks, outage fallback, prompt-injection tests | S17, S20, S34–S38, S42 | `transfer_targets`, `transfers`, `callback_requests` | settings, transfer-targets, callbacks, `/twilio/transfer-result`, `/twilio/transfer-whisper`, `request_human_transfer`, `request_callback` |
| knowledge: FAQs with edit in place, weekly + special hours | S25, S28 | `faqs`, `special_hours` | faqs, hours, special-hours |
| menu: catalog webhook, reconcile, staleness guard, sync status and last error, menu browser | S23, S29 | – | `catalog.incremental_sync`, `catalog.reconcile`, `catalog.staleness`, `webhook.process`, menu, integrations |
| order integrity: revalidate before submit, reconcile `SUBMISSION_UNKNOWN`, staff alerts, order timeline, unverified-Square banner | S10 banner, S11, S12 | `alerts` | `order.reconcile`, `alerts.fanout`, alerts, `POST /orders/:id/reconcile` |
| tenancy and security: roles, audit log, two-tenant isolation tests, admin MFA, token encryption, signature tests | S43 (basic), S44 | `audit_logs`, `support_access_grants` | members, audit-log, support-grants |
| history and privacy: call detail, structured outcomes, filters, phone masking, recording/transcript off + retention | S14, S15 | `call_transcripts` | `GET /calls/:id`, `retention.purge` |
| testing: test calls never reach the kitchen | S22 (number only) | – | `is_test` path |
| **Square native path, only if M0 passed** | S29 | – | `SquareAdapter`, order webhooks, `POS_VISIBILITY_UNVERIFIED` handling, `square.refresh_tokens` |

**M3: should-haves (about 3 weeks).**
- Screens: invites and full team page (S43); Google sign-in; onboarding checklist (S02, S03); Ring Staff First (S18); languages and voices (S17, S21); pronunciations (S30); menu aliases, the hide-from-AI overlay and dayparts (S24); notices; FAQ templates; analytics (S27).
- Behaviour: missed-transfer SMS; max transfer attempts; kitchen-closed and busy messages; variations offered as choices; post-submission changes through staff.
- Data and tools: CSV export; usage per tenant; browser test call (S22); the manual reconcile button.

**M4: could-haves.**
- AI and calls: generate FAQs from a website, upselling, a keypad menu, transfers by intent, recording playback.
- Orders: scheduled pickup, order analytics, caller confirmation texts.
- Platform: other POS adapters, subscription billing, a partner API, in-app help, number porting, business auto-fill.

**M5: fixes from `/replica-entrepreneur`**, once it has read what Maple's and Loman's users complain about.

Env vars: spec Appendix B, plus `SUPABASE_URL`, `SUPABASE_JWKS_URL`, `TOKEN_ENCRYPTION_KEY` (+ `TOKEN_KEY_VERSION`), `RESEND_API_KEY`, `TWILIO_FALLBACK_TWIML_URL`, `PUBLIC_API_BASE_URL`.
