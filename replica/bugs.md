# Bugs found by replica-test

Every bug here was reproduced on the local clone (dev stack: embedded Postgres 18, stand-ins for Supabase
sign-in, Square and Twilio; dashboard production build; Microsoft Edge 1440 px unless noted). Each fix has a
test that failed before it and passes after; the test is named under Evidence.

| id | severity | title | status |
| --- | --- | --- | --- |
| BUG-001 | S1 | A dropped database connection crashes the API and worker | fixed |
| BUG-002 | S3 | Time-zone pickers have no accessible name | fixed |
| BUG-003 | S2 | A restaurant name with an emoji fails with a server error (local Postgres) | fixed |
| BUG-004 | S3 | Adding a phone number fails with "That already exists." in the dev stack | fixed |
| BUG-005 | S2 | A busy shared login gets throttled and the whole dashboard turns into an error page | fixed |
| BUG-006 | S2 | Live orders stops updating for good after one refused connection | fixed |
| BUG-007 | S3 | Accepted tickets on Live orders fail colour contrast | fixed |
| BUG-008 | S3 | Clearing a time in the weekly hours crashes the screen | fixed |
| BUG-009 | S3 | A special day that opens and closes at the same time fails silently | fixed |
| BUG-010 | S3 | A cut-off link to a call or an order shows the error screen | fixed |
| BUG-011 | S3 | Read-only switches and checkboxes are faded below readable contrast | fixed |
| BUG-012 | S3 | A day can be both closed and open; callers hear "closed", the screen lists hours | fixed |
| BUG-013 | S3 | "Delete my account" shows the error screen when sign-in can't be removed | fixed |
| BUG-014 | S2 | A deleted account comes back if its still-valid token is used | fixed |
| BUG-015 | S4 | An error toast sits over the bottom-right of the page until dismissed | open |

### BUG-001: A dropped database connection crashes the API and worker

- Severity: S1
- Flow / case: all (found while running F03 against the dev stack)
- Screen: none (server process)
- Build: 590e364  Browser / device: n/a

Steps
1. Start the API or worker (`npm run dev:stack`).
2. Break the job queue's database connection (restart Postgres, or kill its backend for the queue).

Expected: the queue logs the error and reconnects; calls in progress carry on.
Actual: pg-boss emits an `error` event nobody listens to, Node treats it as an uncaught exception and the
process exits. Every live call on that instance drops.
Evidence: `apps/server/test/queue.test.ts` "BUG-001: a database error inside the queue is logged, not
thrown as an uncaught 'error' event" (failed before: no listener; passes after). Log line after the fix: `{"level":"error","msg":"job queue error","role":"worker","err":"read ECONNRESET"}`.
Suspected cause: `PgBossQueue` never subscribed to `boss.on("error")`.
Status: fixed in 15cb2f9

### BUG-002: Time-zone pickers have no accessible name

- Severity: S3
- Flow / case: F01 / F01-H1, X-2
- Screen: /welcome (S03), /location (S30)
- Build: 590e364  Browser / device: Edge, 1440 px

Steps
1. Sign in with a new email and open /welcome (or open /location as the owner).
2. Run an axe WCAG 2.1 AA scan, or move to the time-zone field with a screen reader.

Expected: the field is announced as "Time zone".
Actual: axe `select-name` (critical): the native `<select>` was not wired to its `<label>`, so screen readers
announce an unnamed combo box.
Evidence: `e2e/f01-onboarding.spec.ts` "F01-E1/E2/E3/E4" (axe scan) failed with select-name; passes after.
Suspected cause: the raw `<select>` skipped the form field's id/aria wiring. Fixed with a `NativeSelect`
primitive that takes it from `FormField` like `Input` does.
Status: fixed in 15cb2f9

### BUG-003: A restaurant name with an emoji fails with a server error (local Postgres)

- Severity: S2
- Flow / case: F01 / F01-E3
- Screen: /welcome (S03)
- Build: 590e364  Browser / device: Edge, 1440 px

Steps
1. Run the dev stack on Windows (`npm run dev:stack`).
2. Sign in with a new email, name the restaurant "Café Ñandú 🥐", press Create restaurant.

Expected: the restaurant is created and the name shows exactly as typed.
Actual: 500. Postgres: `character with byte sequence 0xf0 0x9f 0xa5 0x90 in encoding "UTF8" has no
equivalent in encoding "WIN1252"`.
Evidence: `apps/server/test/api.test.ts` "BUG-003 a double-clicked sign-up"; `e2e/f01-onboarding.spec.ts`
"F01-E1/E2/E3/E4".
Suspected cause: embedded Postgres ran `initdb` with the Windows default encoding. Supabase is UTF-8, so
production was not affected, but nothing stopped a non-UTF-8 database being used. Fixed: `initdb` gets
`--encoding=UTF8 --locale=C`, and migrations now refuse to run on a database that isn't UTF-8.
Status: fixed in 15cb2f9

### BUG-004: Adding a phone number fails with "That already exists." in the dev stack

- Severity: S3 (dev and test environments only)
- Flow / case: F01 / F01-H2
- Screen: /agent/phone (S24)
- Build: 590e364  Browser / device: Edge, 1440 px

Steps
1. Start the dev stack (it seeds Third Space with one phone number).
2. Sign up a new restaurant, open Agent > Phone, search area code 718, press Add this number.

Expected: "Number added", and the number is listed.
Actual: "That already exists." (inline and as a toast). Nothing is added.
Evidence: `e2e/f01-onboarding.spec.ts` "F01-H2" failed with the message; screenshot showed the error under
+1 718 555 0037. Passes after.
Suspected cause: the fake Twilio numbered its purchases `PN000…001`, `PN000…002`, the same id the seed gives
Third Space's number, so the first purchase broke the unique `provider_sid`. Fake ids are now random, as
Twilio's are.
Status: fixed in 15cb2f9

### BUG-005: A busy shared login gets throttled and the whole dashboard turns into an error page

- Severity: S2
- Flow / case: F01 / F01-H4, F03-E5, F03-E13 (Live orders in a rush)
- Screen: every signed-in screen; worst on Live orders (S11) and the kitchen screen (S41)
- Build: 590e364  Browser / device: Edge, 1440 px

Steps
1. Sign in as one person (or share one staff login across several screens, as kitchens do).
2. Use the dashboard quickly: open pages, save settings, place test orders. About 40 page loads a minute.

Expected: pages keep loading; at worst a short wait.
Actual: after ~600 API calls in a minute the API answers 429. The dashboard treats it as a crash: the whole
app, sidebar included, is replaced by Next's bare "This page couldn't load" (React error #441), and
`/api/live` answers 500, so the live stream stops.
Evidence: `e2e/f01-onboarding.spec.ts` "F01-H4" failed with `page error: Minified React error #441` and
`500 on GET /api/live`; the API log showed 634 calls in 45 s with 429s from 40.8 s. Measured: one page load
costs 15 API calls (prefetches cost none), and every live event refreshes every open screen. Regression
test: `apps/server/test/api.test.ts` "BUG-005 a shared kitchen login on four screens through a rush isn't
throttled" (1,000 calls: 400 throttled before, 0 after).
Suspected cause: a per-person limit of 600 a minute sized for one person at one desk, not for the
dashboard's fan-out; and no error boundary anywhere in the dashboard. Fixed: the limit is 3,000 a minute
per person; the dashboard waits and retries a read once on 429; `error.tsx` boundaries keep the sidebar and
header, offer Try again and retry by themselves every 15 s (so an unattended kitchen screen comes back);
`/api/live` answers "come back in 5 s" instead of an error.
Status: fixed in 15cb2f9

### BUG-006: Live orders stops updating for good after one refused connection

- Severity: S2
- Flow / case: F03 / F03-E14 (and F03-E5)
- Screen: Live orders (S11), kitchen screen (S41)
- Build: 590e364  Browser / device: Edge, 1024 px

Steps
1. Sign in as staff and open Live orders.
2. Have the live stream refused once (the API restarting for a deploy, or busy: `/api/live` answered 502).
3. Place an order from the test call.

Expected: the screen reconnects by itself and the new ticket appears.
Actual: nothing appears, ever, until someone reloads the page. The browser treats a non-stream answer as
final and closes the connection for good; nothing re-opened it. A kitchen tablet would sit silent through a
rush.
Evidence: `e2e/f03-order.spec.ts` "BUG-006 a refused live stream comes back by itself and catches up": run
against the old code (the fix stashed, dashboard rebuilt) the ticket never showed within 30 s; with the fix
it shows in about 10 s.
Suspected cause: `/api/live` passed upstream failures on as 502, and `LiveRefresher` had no error handler.
Fixed: the route answers "come back in 5 s" for anything short of signed out, and the refresher re-opens a
closed stream after 10 s and refreshes once on reconnect to catch up on what it missed.
Status: fixed in 15cb2f9

### BUG-007: Accepted tickets on Live orders fail colour contrast

- Severity: S3
- Flow / case: F03 / F03-H1, X-2
- Screen: Live orders (S11), kitchen screen (S41)
- Build: 590e364  Browser / device: Edge, 1440 px

Steps
1. Accept an order on Live orders.
2. Run an axe WCAG 2.1 AA scan.

Expected: no violations.
Actual: `color-contrast` (serious) on the accepted ticket's phone, pickup time and item lines: the card was
drawn at 80% opacity, which pulls muted text below 4.5:1.
Evidence: `e2e/f03-order.spec.ts` "F03-H1/F13-H1" axe scan failed; passes after.
Suspected cause: settled tickets faded with `opacity-80`. Fixed: they sit on the muted surface instead
(muted text on it is 5.79:1 light, 6.48:1 dark).
Status: fixed in 15cb2f9

### BUG-008: Clearing a time in the weekly hours crashes the screen

- Severity: S3
- Flow / case: F11 / F11-E4
- Screen: Hours and location (S30)
- Build: 590e364  Browser / device: Edge, 1440 px

Steps
1. As an owner or manager, open Hours and location.
2. In Weekly hours, clear Monday's opening time (select it and delete it, as you would to retype it).

Expected: the field is empty, Save is disabled and the screen says what's missing.
Actual: the whole screen is replaced by the error screen (before BUG-005's fix: Next's bare error page),
with the page error `Not a 24-hour time: `.
Evidence: `e2e/f11-hours.spec.ts` "F11-E4 clearing a time while editing doesn't break the screen" failed on
the old build with "This screen didn't load" and a page error; passes after.
Suspected cause: the overlap check parsed every shift on each keystroke, and an empty time throws. Fixed:
blank or half-typed times are reported ("Monday needs an opening and a closing time. Fix it to save.") and
never parsed; a shift that opens and closes at the same minute gets its own message.
Status: fixed in 15cb2f9

### BUG-009: A special day that opens and closes at the same time fails silently

- Severity: S3
- Flow / case: F11 / F11-E5
- Screen: Hours and location (S30)
- Build: 590e364  Browser / device: Edge, 1440 px

Steps
1. In Holidays and special days, pick a date, switch off Closed all day, set Opens and Closes to 09:00.
2. Press Add.

Expected: a message saying why it wasn't added.
Actual: nothing happens. No toast, no field message, nothing added.
Evidence: `e2e/f11-hours.spec.ts` "F11-E5" failed on the old build (no message within 10 s); passes after.
Suspected cause: the API returns its error on the `opens` field, and the form only showed errors for
`date`. Fixed: Opens and Closes show their own errors.
Status: fixed in 15cb2f9

### BUG-010: A cut-off link to a call or an order shows the error screen

- Severity: S3
- Flow / case: F06 / F06-E4
- Screen: Calls (S14), Orders (S16)
- Build: 590e364  Browser / device: Edge, 1440 px

Steps
1. Open `/calls?call=not-a-real-id` (a link cut short when pasted into a message does this), or
   `/orders?order=not-a-real-id`.

Expected: the drawer says "Call not found" / "Order not found", as it does for an id that doesn't exist.
Actual: "This screen didn't load". The API answers 400 for a malformed id, and the dashboard treated it as a
failure rather than "not found".
Evidence: `e2e/f06-f07-calls-orders.spec.ts` "F06-E4" failed on the old build waiting for "Call not found";
passes after.
Suspected cause: the drawer loaders passed any id straight to the API. Fixed: an id that isn't a UUID is
not found without asking. Related: the call search box now stops at the API's 80-character limit.
Status: fixed in 15cb2f9

### BUG-011: Read-only switches and checkboxes are faded below readable contrast

- Severity: S3
- Flow / case: F05 / F05-H2, X-2
- Screen: AI agent > Call handling (S20), AI agent > Orders (S21), and anywhere a switch, checkbox or radio
  option is disabled
- Build: 590e364  Browser / device: Edge, 1440 px and 390 px

Steps
1. Sign in as a manager and open AI agent > Call handling; look at "What we keep after a call" (owner-only
   settings, shown read-only). Or, as the owner, open AI agent > Orders and look at "Straight into Square"
   (unavailable until the Square test passes, with the reason in amber).
2. Run an axe scan.

Expected: the settings, and why an option is unavailable, can be read even when they can't be changed.
Actual: the labels, descriptions and the reason are drawn at 50% opacity: axe `color-contrast` (serious).
Evidence: `e2e/f04-f10-agent.spec.ts` "F05-H2" and `e2e/x-screens.spec.ts` "X-2/X-3 every owner screen" at
both widths (`/agent/orders`) failed on the old build; pass after.
Suspected cause: the whole row was faded (`has-disabled:opacity-50`, `opacity-50`). Fixed: only the control
fades (WCAG exempts an inactive control); its words switch to the muted text colour, which passes AA, and
the reason keeps its warning colour (5.91:1).
Status: fixed in 15cb2f9

### BUG-012: A day can be both closed and open; callers hear "closed", the screen lists hours

- Severity: S3
- Flow / case: F11 / F11-E2
- Screen: Hours and location (S30); the voice agent's hours answers
- Build: 590e364  Browser / device: Edge, 1440 px

Steps
1. Add a special day: 31 December, closed all day.
2. Add another for 31 December with hours 10:00–14:00.

Expected: refused, or one replaces the other: a day is either closed or open.
Actual: both are saved and both are listed. On the phone a closure wins, so callers are told the restaurant
is closed while the screen shows it open 10:00–14:00.
Evidence: found by `e2e/f11-hours.spec.ts` "F11-E2/E3" (the list showed "Closed" and "01:00–04:00" for the
same date); `apps/server/test/config-routes.test.ts` "BUG-012 a day can't be both closed and open" failed
(201 for hours on a closed day) and passes after.
Suspected cause: the database only stopped a second closure on the same date. Fixed: the API refuses hours
on a closed day and a closure on a day with hours, with a message under Date. Split hours on one day still
work.
Status: fixed in 15cb2f9

### BUG-013: "Delete my account" shows the error screen when sign-in can't be removed

- Severity: S3 (in the dev stack: every time)
- Flow / case: X-5
- Screen: Your account (S43)
- Build: 590e364  Browser / device: Edge, 1280 px

Steps
1. Sign in as a staff member and open Your account.
2. Press Delete my account, then Delete my account in the dialog, at a moment Supabase can't remove the
   sign-in (an outage; or always in the dev stack, which had no service key).

Expected: a message such as "Your sign-in couldn't be removed right now. Nothing was deleted; try again
shortly." (the API sends exactly that), and the page stays.
Actual: the Server Action fails with a 500 and the screen turns into "This screen didn't load" (React
#441). In the dev stack, account deletion never worked at all.
Evidence: `e2e/f14-team.spec.ts` "X-5" on the old build: `500 on POST /account` and React #441; passes
after.
Suspected cause: the dashboard turned any 5xx from the API into a bare `Error`, and the delete action only
handled input errors, so the API's own message was lost and the error escaped. Fixed: 502/503 become an
`UnavailableError` carrying the API's message, which the delete action and every other action return as a
message; the dev stack sets a service key (the sign-in stand-in accepts any).
Status: fixed in 15cb2f9

### BUG-014: A deleted account comes back if its still-valid token is used

- Severity: S2 (privacy: personal data the person asked us to delete is stored again)
- Flow / case: X-5, X-6
- Screen: none (API); seen as a 500 when signing in again after deleting an account
- Build: 590e364  Browser / device: Edge, 1280 px

Steps
1. A staff member is signed in on two devices. On one, they delete their account.
2. The other device keeps using its session (its access token stays valid for up to an hour).

Expected: the API refuses the token: the account is gone.
Actual: within a minute, `/me` fails (500 in the browser run, 404 from the API) because the server cached
"this person exists"; after that, the next request runs "create the user on first sight" and stores their
email and name again, with nothing to remove them later.
Evidence: `e2e/f14-team.spec.ts` "X-5" (signing in again after deleting: `500 on POST /login`, React #441);
`apps/server/test/account.test.ts` "BUG-014 a deleted account's tokens are refused and never bring the
person back" (failed with 404 instead of 401; a second API instance re-created the row); passes after.
Suspected cause: nothing recorded that an account had been deleted, and the "seen recently" cache skipped
the user check. Fixed: migration `0004_deleted_users.sql` keeps the deleted id only (no name or email);
the API refuses those tokens ("This account was deleted.") and never re-creates the row; the cache now
lives in the access service and forgets a person when they delete their account; `/me` answers 401 if the
row has gone. The sign-in stand-in now gives an email a new id after deletion, as Supabase does.
Status: fixed in 15cb2f9

### BUG-015: An error toast sits over the bottom-right of the page until dismissed

- Severity: S4
- Flow / case: F11-E2 (seen there); any form whose error has no field
- Screen: every screen with a form near the bottom-right
- Build: 590e364  Browser / device: Edge, 1440 px

Steps
1. On Hours and location, mark 31 December closed twice (before the fix below, that error was a toast).
2. Try to press Add in the special days form.

Expected: the form stays usable.
Actual: error toasts stay until dismissed (on purpose, so nobody misses one), and this one sat over the
Add button; the click went to the toast. Dismissing it (or pressing F8 and Escape) frees the button.
Evidence: `e2e/f11-hours.spec.ts` "F11-E2/E3": `<li> from <div role="region" aria-label="Notifications (F8)">
subtree intercepts pointer events`.
Suspected cause: persistent toasts in the bottom-right corner. This case is fixed (a duplicate closure is
now shown under Date, like the other same-day conflicts); the general overlap remains. Suggestion: show
form errors inline wherever the API can name the field, and keep toasts for errors with no place on screen.
Status: open (workaround: dismiss the toast)

## To check (not reproduced)

- Square's sandbox may not show an unpaid PICKUP order on the POS or kitchen display (the P0 question in the
  recon). Needs a real Square sandbox: manual case M-2.
