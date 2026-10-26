# Build log

One line per screen: ID, date, done or partial, what's missing, what was harder than expected. The
data layer is the in-memory fake (`apps/dashboard/src/server/fake`) until `/replica-backend`.

| ID | date | state | missing | harder than expected |
| --- | --- | --- | --- | --- |
| shell | 2026-10-22 | done | – | Next 16 Cache Components: every session read must sit behind its own Suspense boundary, or the build fails. The layout streams sidebar, header and banners separately. |
| domain | 2026-10-22 | done | – | Nested modifiers: child lists open from chosen options, repeatedly, so any depth is checked. Overnight shifts and DST in hours logic. 28 tests. |
| S01 | 2026-10-22 | partial | Real emailed codes and Google sign-in arrive with Supabase Auth; fake code 246810 for now | Same response whether or not the email exists, so the form doesn't reveal accounts. |
| S10 | 2026-10-22 | done | Location switcher only shows with 2+ locations (seed has 1) | Sticky sidebar column needed an inner sticky panel so the background spans long pages. |
| S03 | 2026-10-22 | done | – | – |
| S31 | 2026-10-22 | done | Real support inbox address | – |
| S22 | 2026-10-22 | partial | A live browser call needs Twilio's Voice SDK; the guided test covers the AI's tools only | Running the domain's validateSelection in the browser too, so the AI's clarifying question appears while choosing. |
| S41 | 2026-10-22 | done | Printer hardware integration (prints via the browser for now) | New-ticket chime needs a user gesture first (browser audio rules); announcements go to an aria-live region without re-rendering. |
| S11 | 2026-10-22 | done | – | – |
| S12 | 2026-10-22 | done | Reconcile button (needs the Square adapter) | URL-driven drawer so orders are linkable and Back closes it. |
| S14 | 2026-10-22 | done | – | – |
| S15 | 2026-10-22 | done | Transcripts and recordings are off by default, so there's nothing to show yet | Seed calls had to last longer than their own logged steps. |
| S09 | 2026-10-22 | done | Real number search and purchase (Twilio) with the backend | Fake search kept offering numbers already owned; fixed to exclude them. |
| S29 | 2026-10-22 | partial | Real Square OAuth redirect and token storage with the backend | Location picker lost its default after reconnecting (state initialised before the list arrived). |
| S19 | 2026-10-22 | done | – | The P0 sign-off lives here: owner-only, Square option locked until the test passes. |
| S17 | 2026-10-22 | done | Voice samples need the phone line | Greeting must say it's an AI (spec §15.4): live warning until it does. |
| S18 | 2026-10-22 | done | Enforcement of limits lives in the voice gateway | Empty number fields reached the server as NaN; the form now blocks saving instead. |
| S20 | 2026-10-22 | done | The transfer itself (Twilio Dial + whisper) with the backend | Loop guard: refuses the AI's own number. |
| S21 | 2026-10-22 | partial | Voice samples need the speech provider | – |
| S30 | 2026-10-22 | done | – | – |
| S42 | 2026-10-22 | done | The AI's own capture of callback requests (voice agent) | – |
| S25 | 2026-10-22 | done | – | FAQ dates mean the restaurant's local day; added a DST-safe zonedTimeToUtc to the domain (spring gap and fall overlap tested). Duplicate questions now refused. |
| S26 | 2026-10-22 | partial | Generate FAQs from a website (could) | Starter questions arrive as drafts with [brackets] and can't be saved until filled in. |
| S28 | 2026-10-22 | done | – | Time inputs focus an inner segment, so :focus-visible never matched; added a focus-within ring for date and time fields. |
| S23 | 2026-10-22 | done | Dayparts / menu availability windows | – |
| S24 | 2026-10-22 | done | – | A toast above the drawer takes the first Escape (Radix layer order); the Close button always works. |
| S43 | 2026-10-22 | done | Real invitation emails with the backend | – |
| S44 | 2026-10-22 | done | – | – |
| S02 | 2026-10-22 | done | – | “Phone orders today” first counted a transferred draft; now only orders that reached the restaurant. |
| S04 | 2026-10-22 | partial | One-sitting wizard UI; today it's a checklist that opens each real screen | S07 (KYC) and S08 (card on file) dropped: no payments. |
| S27 | 2026-10-22 | done | Usage and cost per tenant | Chart colours validated with the dataviz validator against our surfaces; deltas hidden when the previous period has no data. |
| S16 | 2026-10-22 | done | – | One agent per location, so the agent “list” is the tabbed editor. |
| S22b chat test | 2026-10-26 | done | A voice version in the browser (needs Twilio) | The chat runs the phone AI's own tools and rules through a text model (Groq free tier by default), so it tests the real thing; a free tier's per-minute limits are waited out, then explained. Transfers can't happen in a chat, so it says where a call would have gone. |
| S34–S38, S40 | – | not started | The voice agent (Twilio + Realtime) and SMS are backend work: /replica-backend | – |
