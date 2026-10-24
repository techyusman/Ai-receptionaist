# Parity: the clone against Maple

Date: 2026-10-24  Build: e35dd64  Matrix: `replica/features.csv` (121 rows)
Tools: `parity.py` (feature score), `imgdiff.py` (layout score; not run, see below).

## Verdict: not shippable yet

| | |
| --- | --- |
| Overall | **80.4 / 100** (feature score only; no layout score) |
| Feature score | 80.4 (83 features counted; must 3, should 2, could 1, partial counts half) |
| Must-haves | **35 of 44 done**, 9 partial, none missing outright |
| Open bugs | S1 0, S2 0, S3 0, S4 1 (`replica/bugs.md`) |
| Tests | 106 of 106 automated cases pass; 7 manual cases not run (`replica/test-plan.md`) |

Any must-have not done means not shippable, so this is the honest verdict. But the 9 partials split
cleanly:

- **5 are blocked on your accounts, not on code.** The code is built and tested against stand-ins. What's
  missing is a real phone call (Twilio and OpenAI keys) and the Square sandbox test of an unpaid pickup
  order. That is the M0 milestone from the architecture plan.
- **4 need code**, and can be built now.

| must-have | what's done | what unblocks it |
| --- | --- | --- |
| Take pickup orders by phone | the whole tool flow, tested through the dashboard test call and the server's voice tests | your Twilio and OpenAI keys, then a real call |
| Test by calling the real number | the number purchase, forwarding and media stream | the same keys |
| Order sent into Square POS | built and tested against the Square stand-in | M-2: does Square show an unpaid PICKUP order on the POS and kitchen display? |
| Never invents facts; offers a transfer when unsure | tools answer `known:false`, prompt rules, server tests | an evaluation on real calls with the real model |
| Transfer for complaints and allergens | reasons route to the right number (tested) | the same evaluation: does the model choose to transfer? |
| Many calls at once, no busy signal | each call has its own media stream and session | **code:** a concurrent-call load test (spec 16.2) |
| Guided onboarding that saves progress | `/welcome`, then a checklist that ticks itself from real data | **code:** a step-by-step wizard |
| Full menu sync including taxes | items, variations, nested choices, sold-out | **code:** sync Square's tax objects (totals already include tax, from Square's own calculation) |
| Organisation > merchant > location | restaurant and location | **code:** a partner organisation level above restaurants |

## Feature score by area, weakest first

| area | score | features | note |
| --- | --- | --- | --- |
| notifications | 0.0 | 1 | order confirmation text: needs A2P 10DLC registration (1–4 weeks) |
| billing | 0.0 | 1 | subscription billing (could) |
| testing | 50.0 | 2 | real-number test and in-browser phone wait on keys |
| onboarding | 58.3 | 3 | the wizard; address auto-fill (could) |
| auth | 60.0 | 2 | Sign in with Google (should) |
| voice | 68.8 | 11 | judgement needs real calls; filler phrase, ambient audio, keypad menu not built |
| tenancy | 75.0 | 4 | partner organisation level; the location switcher is only seen with 2+ locations |
| platform | 75.0 | 2 | public partner API (could) |
| menu | 83.3 | 13 | taxes; dayparts (should); manual menu builder (could) |
| orders | 84.9 | 18 | Square gate (M0); upsells, promotions, other POS (could) |
| telephony | 86.4 | 4 | load test |
| history | 86.7 | 6 | transcripts are opt-in by design; no recording playback |
| knowledge | 88.9 | 4 | generate FAQs from a website (could) |
| handoff | 91.2 | 7 | model judgement (M0) |
| dashboard, analytics, support | 100.0 | 5 | |

Left out on purpose (10, not scored): payments and pay-by-link, KYC, tips, delivery, reservations, waitlist,
drive-thru hardware, the StreamOrders relay, Maple's call data and tuned models, printer supply.

Ours, not in Maple (28 rows, not scored: 20 built, 5 partly, 3 not started): self-serve go-live (partly),
an audit log, holidays and special hours as data,
editing an FAQ in place, FAQ start and end dates, test orders that never reach the kitchen, a stale-menu
guard, a separate callback-number confirmation, a callback request when a transfer fails, an order timeline
with submission attempts, masked phone numbers, recording and transcripts off by default, a fallback route
when the voice AI is down, and more (full list in `parity.py` output).

## Layout score: not measured

`imgdiff.py` compares the clone's screens with screenshots of the original at the same size and state.
There are no screenshots of Maple: the recon used public text sources only (no account, no browser), so
`replica/screens/` is empty. The clone side is ready: 24 screens (most at both 1440 px and 390 px, some
per role) are in `replica/clone-screens/`. They were taken during the build, so retake the ones you
compare: the test pass changed a few details (accepted tickets, read-only controls).

To get a layout score, save your own views of Maple (a demo they show you, or help-center images) as
`replica/screens/S11.png` etc. The useful ones are S11, S12, S14, S15, S17–S21, S23, S25 and S27. Then:

```bash
python imgdiff.py replica/screens/S11.png replica/clone-screens/S11.png --json > replica/diffs/S11.json
python parity.py replica/features.csv --visual replica/diffs/*.json --markdown
```

Use them for structure only, never to copy. The look changes in `/replica-brand` anyway.

## Behaviour differences

Clone click counts come from the end-to-end tests; Maple's are from its public help pages (recon flows).

| flow | Maple does | clone does | fix or keep |
| --- | --- | --- | --- |
| F01 onboarding | ~17 clicks and 3 forms, then a Maple specialist activates the account; Stripe KYC (days) and SMS 10DLC (1–4 weeks) before everything works | ~30 clicks and 5 forms in one sitting (about a third of them the test order), and no specialist or KYC gate. The setup checklist ticks itself from real data | **keep** the same-day go-live; **fix** the click count with the wizard (top five, #3) |
| F03 phone order | Square orders are prepaid by a texted link; unpaid links get reminders | pay at pickup; the read-back states the total with tax from Square's own calculation | **open**: depends on M-2. If Square hides unpaid pickup orders, use Live orders (built and tested) |
| F03 test order | no test mode: test orders hit the kitchen, so staff have to be warned | a test call in the dashboard; orders are flagged Test and never alert the kitchen | keep |
| F04 transfer | rings 25 s, then back to the AI; a missed-transfer text to a backup | ring time and tries are settings; then back to the AI, which takes a callback request; staff texted if they opted in | keep (staff texts need 10DLC) |
| F06 review a call | 3 clicks; plays the recording and shows the transcript | 2 clicks; summary and steps always, transcript only if switched on, no recordings stored | keep (privacy by default); recording playback stays a could |
| F07 check an order | 3 clicks; resend the payment link, mark paid | 2 clicks; accept, cancel with a reason, a timeline of every step | keep |
| F08 menu change | relay lag of 5–10 min; manual resync is 2 clicks plus a page refresh | Square's webhook starts a sync within seconds, with a 15-min safety check; manual sync is 1 click and the status updates itself | keep |
| F09 change an FAQ | delete and add again (~5 clicks); can generate from a website | edit in place (2 clicks); start and end dates; starter drafts that can't go live with [brackets] left in; no website generation | keep; website generation stays a could |
| F10 greeting or voice | 4 clicks; a voice change sticks until you log out | 2 clicks; new calls use it at once; warns if the greeting doesn't say it's an AI | keep |
| F11 hours | ~10 clicks a week; no holidays (Maple says put them in an FAQ) | ~6 clicks for a working week; holidays and special hours as data, correct across clock changes; separate ordering hours | keep |
| F14 roles | Owner, Admin, Manager, Staff; scope merchant or location | Owner, Manager, Staff; staff belong to one location, managers to all; invitations by email, valid 7 days | keep for now; an Admin role only matters with the organisation level |
| errors | not documented | errors next to the field, or a message that stays until dismissed; a screen that fails keeps its frame and retries by itself | keep (one S4 open: a persistent message can cover a button) |
| remembered | not documented | the chosen location, sound on or off, the theme; the session renews itself | keep |

## Top five to build next

1. **M0 with your accounts** (no new code): a real call with Twilio and OpenAI keys, and the Square sandbox
   test of an unpaid pickup order (manual cases M-1 to M-4). This settles 5 of the 9 must-haves.
2. **Concurrent-call load test** (spec 16.2): many simulated calls through the media gateway with the
   voice stand-in, measuring latency and dropped audio. Settles "many calls at once".
3. **Step-by-step onboarding wizard** that saves progress, on top of the checklist that already exists.
   Also cuts the onboarding click count.
4. **Square tax sync**: store the catalog's tax objects with the menu, so the menu screen and the AI know
   which items are taxed before the read-back.
5. **Partner organisation level** above restaurants (spec FR-TENANT-001). It's the biggest of the five;
   build it when there is a partner to serve, and add an Admin role with it.

After those: Sign in with Google, menu dayparts, and a filler phrase while the AI looks something up (the
three should-haves not started).

## Next step

`/replica-build` for items 2 to 5. Item 1 needs your Square, Twilio and OpenAI accounts. Once the
must-haves are done, `/replica-entrepreneur` to find what to do better than Maple.
