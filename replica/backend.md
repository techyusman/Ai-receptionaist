# Backend

Date: 2026-10-23. Inputs: `replica/architecture.md`, `spec.md`. Code: `apps/server` (API, webhooks, voice gateway,
worker), `packages/db` (migrations, tenant-scoped transactions), `packages/contracts` (types, permissions, input
schemas), `packages/domain` (order rules, shared with the dashboard), `apps/dashboard` (now on the real API).

## Run it

| what | command | needs |
| --- | --- | --- |
| Everything, locally, no accounts | `npm run dev:stack -w apps/server`, then the dashboard command it prints | nothing (embedded Postgres, stand-ins for Supabase sign-in and Square, sample café) |
| Sign in locally | `maya@thirdspace.test` (owner), `jordan@…` (manager) or `sam@…` (staff); code `246810`. Any other address signs up a new restaurant | the dev stack running |
| Tests | `npm test` (domain and db) and `npm test -w apps/server` | nothing; each test file starts its own real Postgres 18 |
| Migrate a real database | `DATABASE_MIGRATE_URL=… APP_DB_ROLE=… npm run migrate -w apps/server` | the database owner's connection string |
| Production processes | `npm start -w apps/server` (web) and `npm run worker -w apps/server` | `apps/server/.env.example` filled in |

## What is real and what is stood in

Everything runs for real against Postgres 18. The outside services are your own accounts, so in tests and
locally they are replaced by stand-ins that speak the same protocol.

| part | in production | in tests and the dev stack |
| --- | --- | --- |
| Database, row level security, triggers, job queue (pg-boss) | Supabase Postgres | embedded Postgres 18 (`embedded-postgres`) |
| Sign-in | Supabase Auth email codes; the API verifies JWTs against the project's JWKS | `src/dev/auth-stub.ts` (same REST endpoints, ES256 keys, code 246810) |
| Square OAuth, catalog, pricing, orders, webhooks | Square's public API with the restaurant's own token (`providers/square-http.ts`) | `src/dev/square-stub.ts`, exercised through the real HTTP client |
| Phone numbers, call control, SMS, browser test-call token | Twilio's SDK (`providers/twilio.ts`) | `FakeTwilio`; request mapping tested through the SDK with a fake HTTP client |
| Speech model | OpenAI Realtime over WebSocket (`providers/realtime-openai.ts`) | a scripted model; the connector tested against a local WebSocket server |
| Email | Resend | printed to the console |

## Checklist

### Auth
- [x] Email sign-in with a one-time code (Supabase); new addresses sign up and create a restaurant at `/welcome`
- [ ] Google sign-in: needs your Google OAuth client added in Supabase, then a button on `/login` (small)
- [x] Session in an httpOnly, secure, SameSite=Lax cookie, renewed in the proxy before it expires
- [x] Sign-out ends the session at Supabase too
- [x] Roles (owner, manager, staff, support-limited) from one permission table (`packages/contracts/src/permissions.ts`), checked by the API on every route and backed by row level security
- [x] Invitations by email: single-use token (only its hash is stored), bound to the invited address, 7-day expiry
- [x] Account deletion that deletes: `DELETE /me` removes the Supabase sign-in, the user row and every membership; an owner must hand over the restaurant first ("Your account" in the user menu)
- [ ] TOTP MFA for platform admins (there is no platform-admin UI yet)

### Database
- [x] Migrations `packages/db/migrations/0001` to `0003`, each applied once by a checksummed runner with an advisory lock
- [x] Row level security forced on all 38 tables; tested with a second tenant on every route (`test/tenancy.test.ts`) and with a query that forgets its WHERE clause
- [x] Seed: `src/dev/seed.ts`, a fictional café with a month of calls and orders, built through the real order code
- [ ] Backups: confirm daily backups and point-in-time recovery are on in your Supabase plan before launch

### Payments
- [x] None for orders (a spec non-goal: customers pay at pickup). The Square P0 question is built in: ordering mode and sign-off are gated in the database
- [ ] Subscription billing for restaurants (Stripe Checkout and Portal): a could-have, not started

### Email and jobs
- [x] Transactional email through Resend (invitations, alerts). Point Supabase's sign-in emails at Resend's SMTP too
- [x] Jobs on pg-boss, queued inside the same transaction as the change (tested: a rolled-back change leaves no job), retries with backoff, a dead-letter queue
- [x] Schedules (UTC): catalog reconcile every 15 minutes, full catalog pass nightly, stale-menu check every 5 minutes, Square token renewal daily, retention purge daily, cost estimate nightly

### Integrations

| service | access | review or wait before launch | rate limits |
| --- | --- | --- | --- |
| Square | `MERCHANT_PROFILE_READ ITEMS_READ ORDERS_READ ORDERS_WRITE` (nothing about payments or customers) | Sandbox and production are separate apps. Before other sellers connect, check Square's terms for OAuth apps used by sellers other than you. **The M0 test (an unpaid PICKUP order visible to staff) still decides `pos_feasibility`.** | back off on 429; one sync per location at a time |
| Twilio | your account's numbers; a messaging service for staff texts | **A2P 10DLC registration takes 1 to 4 weeks: start it now.** Point each number's fallback at a TwiML Bin that dials the restaurant | number search throttled to 30 a minute per user |
| OpenAI Realtime | your API key, model pinned in config | review data-retention terms (ask about zero retention) before real calls | per key; `max_call_seconds` caps cost |
| Supabase | project URL, publishable key, service-role key (server only) | turn on asymmetric JWT signing keys | built-in limits on sign-in codes |
| Resend | API key | verify your sending domain (SPF, DKIM) | per plan |

### Security
- [x] Secrets only in environment variables; `.env*` is ignored and the `.env.example` files list every name with no values. The browser never holds an API token or a Square token
- [x] Every route parses its input with zod schemas from `packages/contracts`; unknown settings keys are refused, never passed to SQL
- [x] Authorisation on every read and write, tested per role and with a second tenant; another restaurant's ids answer 404, never 403
- [x] Rate limits: global per user or IP, and tighter on sign-up, invitations, number purchase, Square connect, menu sync and account deletion. Supabase rate-limits sign-in codes
- [x] Webhooks verify signatures: Square HMAC over the configured URL plus the raw body; Twilio over the full URL plus the form fields. Forged deliveries are never stored
- [x] Square tokens encrypted at rest (AES-256-GCM, bound to their row and column, with key rotation)
- [x] The media stream pass is signed, expires in 60 seconds and works once
- [x] No user data in logs (query strings and auth headers are stripped) or in call timelines (names, numbers and speech are never written there)
- [x] `npm audit --omit=dev`: 0 vulnerabilities. Five high findings exist only in lint tooling (`eslint-config-next` to `braces`); the offered fix downgrades Next's lint config, so it was not applied
- [x] Retention: transcripts and call events are deleted after `retention_days` and callers' numbers and names cleared; a phone-number erasure endpoint handles data requests
- [ ] Privacy policy listing every processor (Supabase, Twilio, OpenAI, Square, Resend, your host): for `/replica-launch`
- [ ] Uploads: none yet (recordings are off and not built)

## Not proven until it runs with real accounts (M0)

Written to the public docs and tested against stand-ins, but only a real account can prove these:

1. Square shows an unpaid, catalog-referenced PICKUP order to staff (the P0 question; until then ordering stays on Live orders).
2. The shape Square expects for nested modifiers (`child_modifier_list_ids`); they are sent flat today.
3. OpenAI's GA `session.update` schema with `audio/pcmu` passthrough, and its event names (`response.output_audio.delta`; the older `response.audio.delta` is handled too).
4. Latency, interruptions and transfers on a real phone line.
5. Supabase issuing ES256 tokens that the API accepts (asymmetric signing keys on).

## Changes from architecture.md

| change | why |
| --- | --- |
| No Drizzle: SQL migrations plus small typed query functions | The schema (triggers, composite keys, RLS) is the source of truth; a second model would drift |
| Tests and the dev stack use embedded Postgres, not PGlite | Real roles, LISTEN/NOTIFY and pg-boss need a real server, and there is no Docker on this machine |
| Menu aliases are removed by item and phrase, not by alias id | The menu read model carries phrases, which is what the dashboard knows |
| The nightly full catalog pass runs at 07:30 UTC for every location | One schedule instead of one per time zone; the 15-minute reconcile covers drift |
| The transfer loop guard refuses only the AI's own numbers | The public number is often the right staff line; the UI warns about forwarding it |
| A test call can be priced by a labelled estimate when Square isn't connected | So a restaurant can try the flow first; the database refuses an estimate on a real order |
| A dashboard test call ends when its order is sent | There is no phone line to hang up |
| `DELETE /me` added | Account deletion (a store requirement, and the right thing) |
| The AI's sentences about an order's fate live in `packages/domain/src/speech.ts` | The voice agent and the dashboard's test call must say exactly the same thing |

## Tests

| suite | result |
| --- | --- |
| `packages/domain` | 29 of 29 |
| `packages/db` (40+ schema invariants on a real Postgres 18, migrations, tenant helpers) | 6 of 6 |
| `apps/server` (131 tests in 46 groups) | 131 of 131 |
| Browser, Edge, dashboard on the real API via the dev stack | 6 scripts, all passing, no console errors |

The server tests cover auth, tenancy and roles, every configuration route, catalog sync, the order lifecycle,
Square OAuth, pricing and submission (including a timeout after the order was created, resolved without a
duplicate), ticket mode, Square and Twilio webhooks, the twelve voice tools as a scripted conversation, the media
gateway (pass, audio, interruptions, transfers, silence and time limits, the model failing), jobs, retention and
erasure, the real pg-boss queue, the providers, the dashboard test call and account deletion.

The browser scripts walk the ordering slice across two devices, agent settings, the Square sign-in round trip,
knowledge, hours and menu edits, team invites, accepting an invitation, a new restaurant signing up, and a ticket
appearing on an open Live orders board with no reload (under a second).

Each test file starts its own throwaway Postgres (WAL segments of 1 MB, fsync off) and removes it afterwards;
folders left by a killed run are swept on the next start.

## Next

`/replica-test`, then M0 with real accounts (the five items above), then `/replica-diff`.
