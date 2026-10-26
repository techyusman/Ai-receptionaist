# Test plan: AI receptionist (Third Space)

Build: see `git log -1`  Date: 2026-10-23  Env: local dev stack (embedded Postgres 18, stand-ins for Supabase
sign-in and Square), seeded café, dashboard production build, Microsoft Edge.

Where a case runs:
- **e2e** a Playwright spec in `e2e/` (named in the case id's prefix: `f03-*.spec.ts` for F03). Every e2e test also
  fails on any console error or 5xx, and screens get an axe WCAG 2.1 AA scan.
- **server** an API-level test in `apps/server/test/` (named). Used where the user is a caller on a phone: there
  is no screen to click, so the tools, webhooks and gateway are driven directly.
- **manual** needs your real accounts (Square, Twilio, OpenAI, Supabase, Resend); checklist at the end.

Results are from the run on 2026-10-26 (`npm run e2e`, `npm test`, `npm run test:server`).

Summary: 115 automated cases, 115 pass (61 browser tests in `e2e/`, 188 server, domain and database tests).
The 7 manual cases (M-1 to M-7) need real Square, Twilio, OpenAI, Supabase and Resend accounts and have not
been run. 15 bugs were found on the way; see `replica/bugs.md`.

## Sign-in and roles (A)

| case | type | steps | expected | auto | result |
| --- | --- | --- | --- | --- | --- |
| A-H1 | happy | sign in as the owner with an emailed code | lands on Overview; no axe violations | e2e | pass |
| A-H2 | happy | sign in as staff | lands on Live orders | e2e | pass |
| A-H3 | happy | open /calls?range=7d signed out, sign in | comes back to /calls?range=7d | e2e | pass |
| A-H4 | happy | sign out from the account menu | back at sign-in; / redirects to sign-in | e2e | pass |
| A-E1 | edge: tampered cookie | replace the session cookie with a forged token | treated as signed out | e2e | pass |
| A-E2 | edge: expired session | set the session's expiry in the past, open a page | page loads; the proxy renewed the session | e2e | pass |
| A-E3 | edge: cookie theft by script | read document.cookie | session cookie is httpOnly and SameSite=Lax, invisible to scripts | e2e | pass |
| A-N1 | negative: wrong code | enter 111111 | "That code didn't work"; still on sign-in | e2e | pass |
| A-N2 | negative: not an email | enter "not an email" | no code step | e2e | pass |
| A-N3 | negative: permission | staff open Agent, Knowledge, Analytics, Team, Square, Test | "You don't have access" on each | e2e | pass |
| A-N4 | negative: permission | a manager opens the audit log | "You don't have access" | e2e | pass |
| A-N5 | negative: forged or expired token, alg none | call the API | 401 | server `api.test` | pass |

## F01 Owner onboards a restaurant

| case | type | steps | expected | auto | result |
| --- | --- | --- | --- | --- | --- |
| F01-H1 | happy | new email signs in, fills /welcome, Create restaurant | arrives at the setup checklist; nothing ticked yet | e2e | pass |
| F01-H2 | happy | Agent > Phone: area code, Search, Add this number | number listed; checklist "number" done | e2e | pass |
| F01-H3 | happy | Square > Connect, approve, pick the location | "Square is connected" banner, menu synced, items listed | e2e | pass |
| F01-H4 | happy | set a week of hours, add a transfer number, approve Live orders, place a test order | each checklist step ticks off | e2e | pass |
| F01-E1 | edge: empty input | Create restaurant with no name | field error, nothing created | e2e | pass |
| F01-E2 | edge: very long input | a 130-character restaurant name | refused with a length message (limit 120) | e2e | pass |
| F01-E3 | edge: emoji and accents | name "Café Ñandú 🥐" | saved and shown exactly | e2e | pass |
| F01-E4 | edge: double click | double-click Create restaurant | one restaurant | e2e | pass |
| F01-E5 | edge: back and refresh | refresh /welcome mid-form; after creating, open /welcome | form survives a refresh; afterwards /welcome sends you home | e2e | pass |
| F01-E6 | edge: loop | add the AI number as a transfer number | refused: it would loop back to the AI | e2e | pass |
| F01-E7 | edge: short area code | type two digits | Search stays disabled | e2e | pass |
| F01-E8 | edge: Square location taken | a second restaurant claims the same Square location | "already connected to another restaurant" | server `square.test` | pass |
| F01-E9 | edge: mobile width | onboarding at 390 px | no sideways scrolling, every field reachable | e2e `mobile` | pass |
| F01-N1 | negative: Square declined or state replayed | callback with error, replayed or unknown state | back to /square with the right message; nothing stored | server `square.test` | pass |
| F01-N2 | negative: permission | a manager tries to buy a number | refused | server `tenancy.test` | pass |

## F02 Caller asks a question (voice)

| case | type | steps | expected | auto | result |
| --- | --- | --- | --- | --- | --- |
| F02-H1 | happy | caller asks the hours | a week of hours from the restaurant's own settings, open-now flag | server `tools.test` | pass |
| F02-H2 | happy | caller asks about parking in other words | the matching FAQ answer (fuzzy match) | server `tools.test` | pass |
| F02-E1 | edge: unknown | a question nobody wrote an answer for | known:false, and the AI offers a person or a call back | server `tools.test` | pass |
| F02-E2 | edge: expired answer | an FAQ whose end date has passed | not used | server `config-routes.test` + `tools.test` | pass |
| F02-E3 | edge: after hours | ask whether they can order | "can't take orders now", callback offered | server `tools.test` | pass |
| F02-E4 | edge: time zones and DST | open-now on both DST change days | correct local answer | `packages/domain` hours tests | pass |
| F02-N1 | negative: prompt injection | the model passes a real database id, SQL or a path instead of a handle | refused; nothing outside the call is reachable | server `tools.test` | pass |

## F03 Caller places a pickup order (the core loop)

| case | type | steps | expected | auto | result |
| --- | --- | --- | --- | --- | --- |
| F03-H1 | happy | test call: search "large oat latte", pick size and milk, add, name and number, read back, yes, send | read-back with a total; ticket on Live orders; staff accept on another device; timeline in Orders; call shows "Order placed" | e2e | pass |
| F03-H2 | happy (voice) | the twelve tools in order, as the model would call them | order sent; the caller is told only what was verified | server `tools.test`, `voice.test` | pass |
| F03-E1 | edge: required choice missing | add a latte with no milk | the AI asks "Which milk"; nothing added | e2e | pass |
| F03-E2 | edge: sold out | search for the sold-out Pumpkin Loaf | not offered | e2e | pass |
| F03-E3 | edge: change after read-back | change quantity after the read-back | the yes is void; must read back again | e2e + server `orders.test` | pass |
| F03-E4 | edge: double click | double-click Send to the restaurant | one ticket | e2e | pass |
| F03-E5 | edge: two tabs | staff watch Live orders while an order is sent elsewhere | ticket appears with no reload | e2e | pass |
| F03-E6 | edge: bad phone | a 7-digit callback number | refused; read back digit by digit | e2e | pass |
| F03-E7 | edge: emoji and accents | customer name "Zoë 🙂" | shown correctly on the ticket | e2e | pass |
| F03-E8 | edge: stale menu | menu not synced for longer than the limit | no read-back, no submit | server `ticket.test` | pass |
| F03-E9 | edge: runs out mid-call | item 86'd between read-back and send | goes back to the caller, nothing sent | server `ticket.test` | pass |
| F03-E10 | edge: slow network | Square times out after creating the order | held as unknown, retried with the same key, no duplicate | server `submit.test` | pass |
| F03-E11 | edge: interruption | caller talks over the AI | audio cleared, turn trimmed at what was heard | server `voice.test` | pass |
| F03-E12 | edge: line drops after yes | close the stream with a confirmed order | still sent | server `voice-failures.test` | pass |
| F03-E13 | edge: mobile width | Live orders and the kitchen screen at 390 px | readable, Accept reachable | e2e `mobile` | pass |
| F03-E14 | edge: live stream refused | the first live stream is refused (API busy or restarting) | the screen reconnects by itself and shows the order placed meanwhile | e2e (BUG-006) | pass |
| F03-N1 | negative: estimate | a real order priced without Square | refused by the database | server `orders.test`, `ticket.test` | pass |
| F03-N2 | negative: permission | staff open the test call | "You don't have access" | e2e (A-N3) | pass |

## F04 Caller asks for a person, F05 Ring Staff First (voice)

| case | type | steps | expected | auto | result |
| --- | --- | --- | --- | --- | --- |
| F04-H1 | happy | caller asks for a person | redirected to the right number after the AI finishes its sentence; whisper tells staff who and why | server `voice.test`, `webhooks-twilio.test` | pass |
| F04-E1 | edge: no answer | transfer times out | back to the AI, callback offered, staff texted if they opted in | server `webhooks-twilio.test` | pass |
| F04-E2 | edge: by reason | allergy question | the allergy number first, then the general one, then give up politely | server `tools.test` | pass |
| F04-H2 | happy (dashboard) | add, edit and remove transfer numbers | saved, listed by priority | e2e | pass |
| F05-H1 | happy | Ring Staff First on, nobody answers in 20 s | the AI takes the call | server `webhooks-twilio.test` | pass |
| F05-E1 | edge: staff answer | staff pick up | call ends as "Staff answered" | server `webhooks-twilio.test` | pass |
| F05-H2 | happy (dashboard) | switch Ring Staff First on and save | saved, survives a reload | e2e | pass |

## F06 Manager reviews a call, F07 checks or releases an order

| case | type | steps | expected | auto | result |
| --- | --- | --- | --- | --- | --- |
| F06-H1 | happy | Calls: filter by outcome, search by name, open a call | the drawer shows the summary and the timeline | e2e | pass |
| F06-E1 | edge: privacy by role | staff open the same call | caller number masked; no transcript | e2e | pass |
| F06-E2 | edge: another restaurant's call | open /calls?call=<their id> | not shown | e2e | pass |
| F06-E3 | edge: long content | a call summary of 300 characters | wraps, nothing overflows | e2e | pass |
| F06-E4 | edge: very long input, broken link | a 96-character search; /calls?call=not-an-id; /orders?order=not-an-id | the screen stays; "Call not found" / "Order not found" | e2e | pass |
| F07-H1 | happy | Orders: views and counts, open an order | the timeline from draft to accepted | e2e | pass |
| F07-H2 | happy | a manager cancels an order with a reason | "Cancelled", reason on the timeline, in the audit log | e2e | pass |
| F07-E1 | edge: double click | staff double-click Accept | accepted once, no error | e2e | pass |
| F07-N1 | negative: reason | cancel with a 1-character reason | refused, field message | e2e | pass |
| F07-N2 | negative: permission | staff try to cancel | not offered; the API refuses too | e2e + server `tenancy.test` | pass |

## F08 Menu change reaches the AI

| case | type | steps | expected | auto | result |
| --- | --- | --- | --- | --- | --- |
| F08-H1 | happy | Menu: search, open an item | variations, choices, prices from Square | e2e | pass |
| F08-H2 | happy | hide an item from the AI, 86 one for today | marked in the list; the test call no longer finds them | e2e | pass |
| F08-H3 | happy | add a spoken nickname | listed; the test call finds the item by it | e2e | pass |
| F08-E1 | edge: nickname clash | a nickname another item already uses | "already means …" | e2e | pass |
| F08-E2 | edge: resync | Square > Sync now | menu status returns to up to date | e2e | pass |
| F08-E3 | edge: Square change | catalog webhook burst | one debounced sync, only changes fetched | server `webhooks-square.test`, `square.test` | pass |
| F08-E4 | edge: deleted in Square | an item removed in Square | disappears from the AI's menu, history kept | server `catalog.test` | pass |

## F09 FAQs, F10 agent settings, F11 hours

| case | type | steps | expected | auto | result |
| --- | --- | --- | --- | --- | --- |
| F09-H1 | happy | add an answer with an end date, edit it in place, delete it | listed with "Until …" in the restaurant's zone; one entry after editing; gone | e2e | pass |
| F09-E1 | edge: duplicate | the same question again, different case and punctuation | refused | e2e | pass |
| F09-E2 | edge: starter drafts | add starter questions, try to save one unchanged | Save disabled until the [brackets] are replaced | e2e | pass |
| F09-E3 | edge: very long input | a 2,000-character answer | counter warns near the limit; 2,001 refused | e2e | pass |
| F09-E4 | edge: emoji and accents | question and answer with accents and emoji | saved and shown exactly | e2e | pass |
| F10-H1 | happy | change the greeting, save, reload | saved | e2e | pass |
| F10-E1 | edge: AI disclosure | a greeting that doesn't say it's an AI | warning shown; the call still discloses it | e2e + server `voice.test` | pass |
| F10-H2 | happy | add a pronunciation; add the same word again | listed; duplicate refused | e2e | pass |
| F11-H1 | happy | add an evening shift on Monday | saved | e2e | pass |
| F11-E1 | edge: overlap | a shift overlapping another | flagged, Save disabled | e2e | pass |
| F11-E2 | edge: holiday | close the location on a date | listed; open-now false that day | e2e + server `config-routes.test` | pass |
| F11-E3 | edge: DST | special hours 01:00–04:00 on 14 March 2027 (clocks change in New York) | stored as local times; correct label | e2e | pass |
| F11-E4 | edge: half-typed input | clear a shift's opening time while editing | the screen stays; Save disabled with a reason | e2e | pass |
| F11-E5 | edge: zero-length special day | a special day that opens and closes at 09:00 | says why it wasn't added | e2e | pass |

## F12 POS order loop, F13 pre-launch test, F14 invite a teammate

| case | type | steps | expected | auto | result |
| --- | --- | --- | --- | --- | --- |
| F12-H1 | happy | submit to Square, then Square shows the order in progress | "Received by restaurant" | server `webhooks-square.test`, `ticket.test` | pass |
| F12-E1 | edge: missed webhook | no acknowledgement for 5 minutes | "Couldn't confirm", warning alert | server `ticket.test` | pass |
| F12-E2 | edge: manual check | a manager asks for an unclear order to be checked again | same key, no duplicate | server `submit.test` | pass |
| F13-H1 | happy | the dashboard test call never reaches the kitchen alerts and is flagged "Test" everywhere | flagged; no kitchen alert; not in analytics | e2e (F03-H1) + server `test-agent.test` | pass |
| F14-H1 | happy | the owner invites someone; they open the emailed link, sign in, accept | listed on the team with their role | e2e | pass |
| F14-E1 | edge: link reused | open the link again and accept | refused | e2e | pass |
| F14-E2 | edge: wrong person | someone signed in with another email opens the link | refused, told which address it was for | e2e | pass |
| F14-E3 | edge: invite revoked | the owner cancels the invite, the person accepts | refused | e2e | pass |
| F14-N1 | negative: invalid email | "not-an-email" | field message | e2e | pass |
| F14-N2 | negative: permission | a manager tries to invite | not offered; the API refuses | e2e + server `tenancy.test` | pass |

## F15 Text the AI like a customer (chat test), and the bigger sample menu

| case | type | steps | expected | auto | result |
| --- | --- | --- | --- | --- | --- |
| F15-H1 | happy | Tandoor & Crust owner: start a chat, ask the hours, search "biryani", ask if the meat is halal, end the chat | greeting; answers from the real tools; each step listed; the chat is a test call in Calls | e2e | pass |
| F15-H2 | happy | a whole pickup order by chat (search, choices, name and number, total, yes, send) | the same tools and rules as a phone call; the order is a test on Live orders | server `test-chat.test` | pass |
| F15-E1 | edge: mobile width | the chat at 390 px | no sideways scrolling, every control reachable | e2e | pass |
| F15-E2 | edge: transfer | the customer asks for a person | the chat says where a call would have gone and ends; nothing is left ringing | server `test-chat.test` | pass |
| F15-E3 | edge: the free AI is busy | the model is rate limited or fails | a short wait, then "try again in a minute"; the chat stays open | server `test-chat.test` | pass |
| F15-E4 | edge: numbers in the transcript | a phone or card number in a message | masked to the last four digits in what is kept | server `test-chat.test` | pass |
| F15-E5 | edge: the bigger menu | spice level required, meal deal asks for a drink, at most five toppings, sold-out size and dish, a tray with no fixed price | each enforced; the sold-out and unpriced never offered; none of the café's items | server `sample-menu.test` + e2e | pass |
| F15-E6 | edge: Pakistani numbers | in the Lahore restaurant, give 0300 1234567 as the callback number; in New York, the same number, then +92 300 1234567 | Lahore stores +923001234567; New York refuses the local form with a US example and takes the +92 form | server `phone.test` | pass |
| F15-N1 | negative: permission | staff open the chat; a manager writes into the owner's chat; another restaurant uses the chat's id | refused | server `test-chat.test` + e2e | pass |
| F15-N2 | negative: no key | the server has no chat model | explains how to add a free key | server `test-chat.test` | pass |

## Cross-cutting (X)

| case | type | steps | expected | auto | result |
| --- | --- | --- | --- | --- | --- |
| X-1 | second user's data | a second restaurant's owner opens Third Space's order, call and FAQ ids | nothing shown | e2e + server `tenancy.test` | pass |
| X-2 | accessibility | axe WCAG 2.1 AA on every screen, desktop and 390 px | no violations | e2e `a11y` | pass |
| X-3 | mobile width | every screen at 390 px | no sideways scrolling | e2e `mobile` | pass |
| X-4 | keyboard only | sign in, move between screens, open and close a drawer | all reachable, focus visible, Escape closes | e2e `keyboard` | pass |
| X-5 | account deletion | an owner tries, a staff member deletes theirs | owner refused; staff signed out and cannot sign back into the team | e2e | pass |
| X-6 | deleted account, token still valid | after deleting an account, use its old token (another device still signed in) | refused (401); the person is not stored again | server `account.test` | pass |

## Manual (needs your accounts)

| case | what to do | expected |
| --- | --- | --- |
| M-1 | Square sandbox: connect, pick a location, check the menu | items, sizes and choices match Square |
| M-2 | Square: send an unpaid PICKUP order (the P0 question) | does it show on the POS, the Order Manager and the kitchen screen? Record it and set the sign-off |
| M-3 | Call the AI number: ask the hours, order a latte with oat milk, confirm | answered correctly; order on Live orders; the AI never says more than was verified |
| M-4 | Interrupt the AI mid-sentence; stay silent; ask for a person | it stops; it checks in, then hangs up; it transfers |
| M-5 | Invite a real address | the email arrives from your domain (not spam); the link works |
| M-6 | Sign-in emails | the code arrives within a minute, from your domain |
| M-7 | Staff alert text | arrives (needs A2P 10DLC) |
