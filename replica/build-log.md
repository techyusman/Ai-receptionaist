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
