# Recon map: Maple (merchant web portal + phone voice agent)

Scope: Maple Voice + Maple Orders, pickup only, on Square. That covers call answering, FAQs, pickup ordering into the POS, staff transfer, call and order history, and the merchant portal that configures all of it. Bookings, waitlist, delivery, payments, drive-thru and kiosk are out of scope (see "Out of scope").
For: your own multi-tenant restaurant AI receptionist SaaS, as described in `spec.md`. The first tenant is Third Space.
Date: 2026-10-21
Method: public sources only (marketing site, help center, docs site, public partner OpenAPI). No Maple account was used, nothing was logged into, and no screenshots were taken because no browser was connected (see `screens/README.md`). Maple's terms were not an issue because no account was involved.

## Why Maple is the target

Several products do what `spec.md` describes. Maple is the closest match and the one with the most public documentation.

| product | fit | notes |
| --- | --- | --- |
| **Maple** (maple.inc) | **closest, chosen** | Restaurant-only AI phone agent. It answers FAQs, takes pickup orders into Square and other POS systems, transfers to staff, and keeps call and order history in a merchant portal. It has a public help center (38 articles), a docs site and a public partner OpenAPI, which is the deepest documentation of any product in this category. |
| Loman (loman.ai) | close | Same pitch: Square menu sync, 86'd items, orders pushed to POS/KDS. It takes card payment during the call, and it has no public help center or docs. |
| Hostie (hostie.ai) | partial | Pushes orders into Square. Its marketing pages are thin, with no settings detail. |
| Slang.ai | partial | Focuses on reservations and FAQs (OpenTable, SevenRooms), not ordering. |
| Square AI voice ordering | partial | Square's own feature, announced Oct 2025. There are no public setup docs, and it isn't a multi-tenant product you could rebuild. |
| SoundHound for Restaurants | partial | A Square App Marketplace app. The caller pays by Square link, then the order is pushed to Square Terminal. |

## Sources

| # | source | URL | notes |
| --- | --- | --- | --- |
| 1 | help center home | https://help.maple.inc | 5 collections, 38 articles |
| 2 | help: AI Phone Ordering Overview | https://help.maple.inc/articles/6848817710-ai-phone-ordering-overview | order flow, settings table, routing table |
| 3 | help: Dashboard Overview | https://help.maple.inc/articles/3592788035-maple-dashboard-overview | sidebar sections |
| 4 | help: Onboarding Process Overview | https://help.maple.inc/articles/9510053682-maple-onboarding-process-overview | 11 onboarding stages |
| 5 | help: Accessing the Portal | https://help.maple.inc/articles/5889524077-accessing-the-maple-portal-app-maple-inc | passwordless login |
| 6 | help: Setting Up Your AI Phone Number | https://help.maple.inc/articles/4344501000-setting-up-your-ai-phone-number | number picker, handoff, forwarding |
| 7 | help: AI Voice Agent Overview | https://help.maple.inc/articles/9354418069-ai-voice-agent-overview | capabilities, settings, recordings |
| 8 | help: Coaching Instructions | https://help.maple.inc/articles/5019805382-customizing-your-ai-agent-s-behavior-with-coaching-instructions | standing rules, managed by support only |
| 9 | help: Responses Outside the KB | https://help.maple.inc/articles/8400721720-handling-ai-responses-outside-the-knowledge-base | fallback = offer transfer |
| 10 | help: Performance and Call Quality | https://help.maple.inc/articles/3536101110-ai-performance-and-call-quality-overview | metrics, filler phrases, QA |
| 11 | help: Supported POS Systems | https://help.maple.inc/articles/5619079560-supported-pos-systems-and-integration-options | 14 POS, connection types, tablet/printer fallback |
| 12 | help: Menu Sync Troubleshooting | https://help.maple.inc/articles/7572278338-menu-sync-troubleshooting | resync control, failure table |
| 13 | help: AI Ordering Troubleshooting | https://help.maple.inc/articles/6132656972-ai-ordering-troubleshooting | 9 failure modes |
| 14 | help: Transfer troubleshooting | https://help.maple.inc/articles/1147507337-why-calls-aren-t-transferring-to-my-staff-or-the-ai-says-the-restaurant-is-busy | transfer mechanics, Ring Staff First |
| 15 | help: Outdated info | https://help.maple.inc/articles/8179459669-the-ai-is-giving-outdated-info-says-we-re-closed-or-delivery-is-paused-even-though-my-settings-are-correct | stale FAQ entries override settings |
| 16 | help: Test before going live | https://help.maple.inc/articles/2176041767-how-to-test-your-ai-agent-before-going-live | no test mode |
| 17 | help: Promotions | https://help.maple.inc/articles/2934718552-setting-up-promotions-and-discounts-for-your-ai-phone-agent | discounts live in the POS |
| 18 | help: Languages | https://help.maple.inc/articles/3531404333-which-languages-can-my-ai-agent-handle | greeting is English only |
| 19 | help: Voice recognition limits | https://help.maple.inc/articles/8782883469-ai-voice-recognition-limitations-and-workarounds | one order per call; last item can drop from read-back |
| 20 | help: Menu recognition | https://help.maple.inc/articles/3895182617-ai-menu-recognition-troubleshooting | aliases only via support |
| 21 | help: Pronunciation | https://help.maple.inc/articles/6427290092-fixing-ai-pronunciation-of-restaurant-and-menu-names | pronunciation dictionary |
| 22 | help: Printer troubleshooting | https://help.maple.inc/articles/6694358528-printer-troubleshooting | Pending orders held from kitchen |
| 23 | help: Toast menu sync | https://help.maple.inc/articles/8857323594-syncing-menus-from-toast-pos-to-maple | Menu Builder, Resync, portal edits overwritten |
| 24 | help: Toast setup | https://help.maple.inc/articles/7455871755-setting-up-toast-pos-integration | integration wizard labels |
| 25 | help: Service fee | https://help.maple.inc/articles/2513346071-understanding-the-service-fee-on-customer-orders | 2.9% + $0.30 on pay-by-link |
| 26 | help: SMS verification | https://help.maple.inc/articles/6003403818-sms-verification-and-carrier-setup | 10DLC, 1–4 weeks |
| 27 | docs: Dashboard Overview | https://docs.maple.inc/dashboard-overview.md | **most UI labels on this map come from here** |
| 28 | docs: Square | https://docs.maple.inc/orders/pos/square.md | **"Pay in store and cash on pickup are not available"** |
| 29 | docs: Payment Methods | https://docs.maple.inc/orders/config/payment-methods.md | pay-in-store support listed per POS |
| 30 | docs: Orders Overview | https://docs.maple.inc/orders/overview.md | order flow, analytics |
| 31 | docs: Voice Configuration | https://docs.maple.inc/voice-core/voice-configuration.md | 25 s transfer timeout, Difficult Words |
| 32 | docs: Store Hours | https://docs.maple.inc/voice-core/store-hours.md | weekly hours, hour gaps |
| 33 | docs: FAQ Setup | https://docs.maple.inc/voice-core/faqs.md | no edit, templates, Generate With AI |
| 34 | docs: Menu Management | https://docs.maple.inc/orders/config/menu-management.md | POS-synced vs manual menus |
| 35 | docs: Orders FAQ | https://docs.maple.inc/orders/faq.md | no edits after placing an order |
| 36 | docs: Partners overview | https://docs.maple.inc/partners/overview.md | org → merchant → location, roles |
| 37 | API: Order lifecycle | https://docs.maple.inc/developer-api/concepts/order-lifecycle.md | 9 order states, 6 payment states |
| 38 | API: Webhook events | https://docs.maple.inc/developer-api/webhook-events.md | event catalog |
| 39 | API: Webhooks | https://docs.maple.inc/developer-api/concepts/webhooks.md | HMAC signing, 9-attempt retries |
| 40 | API: Idempotency | https://docs.maple.inc/developer-api/concepts/idempotency.md | replay-safe decisions |
| 41 | API: OpenAPI spec | https://docs.maple.inc/openapi/developer-api.json | 66 operations; order and menu shapes |
| 42 | pricing | https://maple.inc/pricing | Voice $150/mo, Pro $350/mo |
| 43 | Square integration page | https://maple.inc/integrations/square | via StreamOrders, 5–10 min sync |
| 44 | marketing site | https://maple.inc | positioning |
| 45 | developers page | https://maple.inc/developers | API, MCP, CLI links |
| 46 | Loman home | https://loman.ai | runner-up |
| 47 | Loman + Square | https://loman.ai/blog/voice-ai-phone-agent-square-pos | runner-up |
| 48 | Hostie + Square | https://hostie.ai/integrations/square | runner-up |
| 49 | Square voice ordering news | https://www.restaurantdive.com/news/square-product-update-voice-ordering-ai-assistant/802331/ | runner-up |

Sources not used: the user's own account (there isn't one), an app store listing (Maple is a web portal plus a phone line, so there's no app), a changelog (none found), and walkthrough videos (no browser was available to watch them).

## Core loop

A caller rings the restaurant's normal number. The AI answers and takes a pickup order from the live POS menu, asking for every required choice. It reads the order back, and the confirmed order lands in the POS for the kitchen. Anything the AI can't handle goes to a human.

## Screens

States marked * are inferred, not documented. Channel: **web** = merchant portal, **voice** = the phone call, **sms** = a text.

| ID | screen | route / how to reach | purpose | key components | states seen |
| --- | --- | --- | --- | --- | --- |
| S01 | Login | app.maple.inc | sign in | email field, 6-digit code input, Continue with Google, Resend | default, code sent, code not arriving, wrong email |
| S02 | Home | after login | setup progress | "Pending Tasks" list, "Looking Ahead" list, "Complete onboarding" prompt | onboarding incomplete, complete* |
| S03 | Notifications panel | bell icon, top right | onboarding and setup reminders | badge, list of tasks (Merchant Onboarding, Enable Ordering, POS connection) | badge with count, empty* |
| S04 | Onboarding: business and location | blue rocket icon → Get Started | create merchant and first location | business search (auto-fills from public data), restaurant type dropdown, store name, phone (+1), website, address | empty, auto-filled, saved; "Exit Onboarding" keeps progress |
| S05 | Onboarding: modules | wizard step | choose Voice / Orders / Booking | module cards with checkboxes | none selected*, selected |
| S06 | Onboarding: POS and menu | wizard step / Orders → "Select POS" | connect POS or upload a menu | POS grid, "Continue: Select POS", "Continue Without POS", "I Don't See My Provider", "Upload Menu" / "Upload Menu Later", authorize redirect | connecting, syncing (blue recycle icon), Active, "No items", timeout error |
| S07 | Onboarding: business verification | wizard → Stripe-hosted form | KYC needed for payments | Stripe form (EIN, owner, bank) | in review, verified, failed* (**skip in clone**) |
| S08 | Onboarding: subscription billing | wizard step | card for the monthly plan | card fields, "Secure Checkout" | empty, saved, declined* |
| S09 | Onboarding: create first agent | "Create your first Maple agent" → Get Started | AI number, greeting, handoff | area-code search, number list, "Assign Phone Number", welcome message, handoff number, forwarding instructions | suggested numbers, none available, "Fail to save phone number" error |
| S10 | App shell + location switcher | every page | navigation | sidebar ("Main Menu", "Location Pages"), merchant name, location name (click to switch), Get Help | single location, multi-location |
| S11 | Orders: Track Orders | sidebar → Orders | list phone orders | table: order name, phone, amount, fulfillment (pickup/delivery, ASAP/scheduled), payment status, created at | empty*, filled, Pending, Paid |
| S12 | Order Summary | click an order row | one order's detail | items, modifiers, payment method, fulfillment time, caller phone; resend payment link, mark paid | pending, paid, rejected* |
| S13 | Orders setup | Orders, before ordering is enabled | turn ordering on | 3 steps: "Select POS", "Payment Processing", "Enable Orders" | not started, in progress, enabled |
| S14 | Phone Calls | sidebar → Phone Calls | call log | call cards: caller name, phone, summary, date/time, order-placed flag | empty*, filled, loading* |
| S15 | Call Summary | call card → "View Details" | one call's detail | start time, duration, phone, "Call resolution", "Conversation Summary", audio player (play/download), full transcript | with order, without order, transferred* |
| S16 | AI Agents | sidebar → AI Agents | list agents for the location | agent row, AI phone number | one agent, none (pre-onboarding)* |
| S17 | Agent › Message | agent → Message tab | greeting and languages | "Welcome Message" textarea, Advanced → Languages (English, Spanish, Mandarin; Cantonese and French in beta) | default greeting, edited, multilingual mode |
| S18 | Agent › Call Handling | agent → Call Handling tab | Ring Staff First | "Ring Staff First" toggle, "If Staff Doesn't Answer", "Active Schedule" (Always / During Schedule with day and time windows) | off, on, scheduled |
| S19 | Agent › Orders | agent → Orders tab | ordering rules | "Pickup Orders" toggle, "Pickup Notes", "Scheduled Orders", "Pickup Payment" (Pay by Link / Pay in Store), auto-convert unpaid orders | ordering off, on; pay-in-store unavailable for this POS* |
| S20 | Agent › Actions | agent → Actions tab | transfers and texts | "Transfer to Staff" (number, max attempts, after-hours toggle), "+ Add Action" menu (Send Order Link, Send Booking Link, Custom SMS, Transfer Call) | default action only, several actions, Custom SMS locked until EIN |
| S21 | Agent › Audio & Voice | agent → Audio & Voice tab | pick a voice | 4 voice cards with speaker preview, Advanced → "Ambient Background Audio", "Save Changes" | selected, previewing, saved |
| S22 | Try Your Agent | button, bottom left of agent editor | test call in the browser | web call widget (mic, hang up) | connecting*, live*, ended*, mic blocked* |
| S23 | Menus | sidebar → Menus | browse the synced menu | tabs: Full Menus, Menu Categories, Menu Items, Modifier Groups, Modifier Items; "updated X ago" + resync icon; pagination | syncing, synced, "No items", timeout error, base price only for variants (bug) |
| S24 | Menu / item edit | Menus → Edit | availability windows, descriptions, visibility | "Availability" (menu hours), description field, visibility toggles, bulk update | saved; local edit overwritten on next sync |
| S25 | Knowledge | sidebar → Knowledge | FAQs for the AI | Q&A rows, "+ Add Entry", "+ Add Template", "Generate With AI", "Automatic" / "Manual" labels, delete | empty (fewer than 10 entries recommended against), filled; **no edit, only delete and re-add** |
| S26 | Generate With AI / Template modal | Knowledge → button | bulk-create FAQs | URL textarea (1–3 sites), "Generate FAQs"; template picker (Restaurant Sample FAQs, 34 Qs) | generating*, results to review, error* |
| S27 | Analytics | sidebar → Analytics | performance | date filter (Last 7 / 30 Days…), tiles: "Total Calls", "Total Call Time", "Average Call Time", "Calls Transferred"; "Total Calls Overview" chart; "Key Stats Summary" | empty*, filled |
| S28 | My Location + Store Hours | sidebar → My Location / Locations → Store Hours | details and hours | name, address, phone, website; weekly table, "Add Store Hours", "Open For Business" toggle, "+ Add Hour Gap", "Save Store Hours"; ✓ / ⚠️ / red door icons | day configured, day closed, location closed |
| S29 | POS Management | Orders / POS Integrations → "Access POS Platform" | integration status and resync | POS logo, status, refresh icon, Publish | Active, syncing, error* |
| S30 | QA › Difficult Words | QA Dashboard card / QA Calls → Words tab | pronunciation list | "+ Add Word", word list, trash icon | empty*, filled |
| S31 | Get Help | bottom-left button | support chat | chat launcher | open, closed |
| S32 | Bookings | sidebar → Bookings | reservations | OpenTable feed or upsell card ($80/mo + $50/mo) | upsell, live (**skip in clone**) |
| S33 | Printer configuration | location settings → "Edit Printer Configuration" | kitchen printer fallback | Test tab, test print | test ok, test failed |
| S34 | Call: greeting | voice: caller dials the number | open the call | greeting, optional keypad menu (talk to AI / press for staff / press for SMS link) | open hours, after hours, kitchen closed, busy |
| S35 | Call: question turn | voice | answer an FAQ or menu question | KB lookup, filler phrase ("let me check on that") | answered, unknown → offer transfer |
| S36 | Call: building the order | voice | collect items and choices | item match, clarifying questions for size and required modifiers | item found, ambiguous, not found, 86'd, required modifier missing |
| S37 | Call: read-back and confirm | voice | confirm items and total | full read-back with prices, payment statement | confirmed, changed → re-read, last item dropped (known bug) |
| S38 | Call: transfer | voice | hand off to staff | outbound call to the handoff number, 25 s timeout | connected, no answer → back to AI, busy, "maximum number of transfer attempts" |
| S39 | SMS: payment link + payment page | sms + hosted page | caller pays (Stripe) | link text, card / Apple Pay / Google Pay, tip | sent, reminder at 5/10/20 min, paid, abandoned (**skip in clone**) |
| S40 | SMS: confirmation / staff alert | sms | order confirmation to the caller; missed-transfer alert to staff | text message | sent, failed (landline), blocked pending 10DLC |

Added during architecture. Maple has no equivalent of these, but `spec.md` needs them:

| ID | screen | route / how to reach | purpose | key components | states seen |
| --- | --- | --- | --- | --- | --- |
| S41 | Live orders (kitchen queue) | sidebar → Live, or a staff tablet | the P0 fallback: staff see and accept phone orders | ticket cards, sound alert, Accept, print | empty, new ticket, accepted, uncertain-submission warning |
| S42 | Callbacks | sidebar → Callbacks | callback requests taken when a transfer fails | list, mark done | empty, open, done |
| S43 | Team | settings → Team | members, roles, invites | member table, invite modal, role select | owner only, invited, revoked |
| S44 | Audit log | settings → Audit log | who changed what | table with filters | empty, filled |

## Flows

```
F01 Owner onboards a restaurant
    S01 -> S04 -> S05 -> S06 -> S07 -> S08 -> S09 -> S25 -> S22 / call the number -> go live
    happy path clicks: ~17 documented clicks plus 3 forms, plus carrier call forwarding outside the app,
                       plus a Maple specialist activating the account. Elapsed: a guided same-day session,
                       1–2 test-and-adjust rounds, Stripe KYC review (days), SMS 10DLC (1–4 weeks)
    number to beat: self-serve go-live in one sitting, with no KYC (no payments) and no specialist gate
    edge: POS sync timeout on a big menu, no numbers in the area code, "Fail to save phone number",
          handoff number = forwarded number (loop), EIN won't save

F02 Caller asks a question (hours, parking, menu, price)
    S34 -> S35 -> end
    turns: 1 question, 1 answer
    edge: no KB entry -> offer transfer (S38); a stale FAQ overrides live settings; after hours;
          misheard word ("stews" -> "shoes"); allergen question -> transfer

F03 Caller places a pickup order (the core loop)
    S34 -> S36 -> S37 -> [Square: S39 pay by link] -> S40 -> order shows in S11 -> POS / kitchen
    turns: not published; measure in the pilot (this is the number to beat)
    edge: required modifier missing; item 86'd (5–10 min sync lag); Square variations appear as separate items;
          last item dropped from read-back; caller wants to add items after submission (one order per call ->
          call back or transfer); kitchen closed but store open; busy period (quote a wait, offer online link);
          cash payer -> transfer; payment link never arrives; unpaid link reminders at 5/10/20 min;
          auto-convert unpaid pickup to pay-in-store (not available on Square)

F04 Caller asks for a person
    S34/S35/S36 -> S38 -> staff answers, or no answer after 25 s -> back to AI -> S40 missed-transfer text to backup
    edge: handoff line busy (no call waiting); carrier voicemail picks up at ~20 s; extension numbers unsupported;
          caller ID shows the Maple number, not the caller's; transfer outside business hours

F05 Ring Staff First
    incoming call -> staff line rings ~20 s -> no answer -> S34
    edge: Active Schedule windows; staff line is the forwarded line (loop)

F06 Manager reviews a call
    S10 -> S14 -> S15 (play the recording, read the transcript)
    happy path clicks: 3

F07 Manager checks or releases an order
    S10 -> S11 -> S12 -> resend payment link / mark paid
    happy path clicks: 3
    edge: Pending order held from the kitchen; printer offline (S33)

F08 Menu change reaches the AI
    change in Square -> StreamOrders relay -> Maple (5–10 min) -> S23
    manual: S23 -> resync icon -> wait -> refresh       happy path clicks: 2
    edge: timeout on a large menu, missing modifiers, variant price shows base only, Square reporting categories not synced

F09 Manager adds or changes an FAQ
    S25 -> "+ Add Entry" -> question + answer -> save         clicks: 2–3
    change = delete + add again                                clicks: ~5
    bulk: S25 -> "Generate With AI" -> URLs -> review (S26)

F10 Manager changes the greeting, voice or transfer number
    S16 -> agent -> S17 / S20 / S21 -> "Save Changes" -> S22 "Try Your Agent"
    happy path clicks: 4
    edge: voice change cached until log-out; phonetic spelling needed for the restaurant name

F11 Manager sets store hours
    S28 -> Store Hours -> "Add Store Hours" per day -> "+ Add Hour Gap" -> "Save Store Hours"
    happy path clicks: ~10 for a week
    edge: holidays have no field (Maple says put them in FAQs); menu hours ending before store hours = order cutoff

F12 POS receiver order loop (backend; from the partner API)
    order.validation_requested -> validation_result (valid / invalid + reason; expires) ->
    Maple revalidates before final submission -> payment gate -> order.notification ->
    accept / deny -> ready -> complete
    edge: webhook missed -> POST /orders/{id}/resend; out-of-order events -> reconcile with GET /orders/{id};
          customer cancels -> order.cancelled

F13 Pre-launch test
    S09 number -> S34..S37 -> check S11 and the kitchen ticket
    edge: no test mode; pay-by-link test orders stay Pending if unpaid; pay-in-store test orders hit the kitchen (warn staff)

F14 Invite a teammate (guess: roles are documented, the screen is not)
    S10 -> team/users* -> invite email -> pick a role (Owner / Admin / Manager / Staff) and a scope (merchant or location)
```

## Components

| component | variants | states | used on |
| --- | --- | --- | --- |
| Sidebar nav | main menu, location pages | active item, collapsed* | all web |
| Location switcher | single, multi | open, selected | S10 |
| Notification bell | badge | count, empty | S02, S03 |
| Setup wizard | stepper with steps | in progress, saved, exit | S04–S09, S13 |
| Button | primary, secondary, icon, "+ Add" | default, hover, disabled, loading | all |
| Data table | orders | empty, loading*, paginated | S11, S23 |
| Status pill | Paid, Pending, Active, Automatic, Manual | colour per status | S11, S12, S25, S29 |
| Detail drawer / panel | order, call | open, loading* | S12, S15 |
| Call card | with order, without order | default, hover | S14 |
| Audio player | play, download | playing, paused | S15 |
| Transcript view | speaker turns | scrolling | S15 |
| Tabs | agent editor, menus | active | S17–S21, S23 |
| Toggle | on/off | on, off, disabled | S18, S19, S20, S28 |
| Radio group | Pay by Link / Pay in Store, Always / During Schedule | selected, unavailable | S18, S19 |
| Phone number input | E.164 with +1 | valid, invalid | S04, S09, S20 |
| Number picker | area-code search + result list | results, none, error | S09 |
| Textarea | welcome message, FAQ answer, URLs | default, error* | S17, S25, S26 |
| Voice card | 4 voices | selected, previewing | S21 |
| Action list | Transfer to Staff + added actions | locked (needs EIN) | S20 |
| Weekly hours editor | per day, hour gaps | open, closed, ✓, ⚠️ | S28 |
| Q&A row | manual, automatic | default, deleting | S25 |
| Modal | Generate With AI, templates | open, generating, results | S26 |
| Sync indicator | "updated X ago" + refresh icon | idle, spinning, error | S23, S29 |
| Stat tile | count, duration | default, loading* | S27 |
| Line/bar chart | Total Calls Overview | data, empty* | S27 |
| Date range filter | 7 days, 30 days, custom* | selected | S27 |
| Empty state | no orders, no calls, no items | with CTA | S11, S14, S23, S25 |
| Save feedback | "Save Changes" | saving, saved, error* | S17–S21, S28 |
| Web call widget | Try Your Agent | connecting, live, ended | S22 |
| Help launcher | chat | open, closed | S31 |

## Inferred data model

```
Organization  id, name                                           (partner/reseller level)
              evidence: docs/partners/overview          confidence: high

Merchant      id, organization_id, name, restaurant_type, owner_user_id
              evidence: S04, partners overview          confidence: high

LegalEntity   id, merchant_id, legal_name, ein, bank_ref, kyc_status
              evidence: S07, partners overview          confidence: high   (clone: billing only; no KYC)

Location      id, merchant_id, name, status (active | inactive | paused), timezone, phone,
              website, address (line1, line2, city, region, postal_code, country), plan
              evidence: S28, OpenAPI Location schema    confidence: high

User          id, email, google_sub?, last_login_at       (passwordless OTP)
Membership    user_id, scope_type (merchant | location), scope_id, role (owner | admin | manager | staff)
              evidence: S01, partners overview          confidence: high (fields) / guess (table shape)

Agent         id, location_id, welcome_message, voice_id, languages[], ambient_audio (bool),
              ordering_enabled, pickup_notes_enabled, scheduled_orders_enabled,
              pickup_payment (pay_by_link | pay_in_store), auto_convert_unpaid (bool)
              evidence: S16–S21                         confidence: high

PhoneNumber   id, location_id, e164, purpose (ai | handoff | sms_alert), ring_staff_first (bool),
              ring_schedule (always | during_schedule + windows)
              evidence: S09, S18, transfer troubleshooting  confidence: medium

AgentAction   id, agent_id, type (transfer_to_staff | transfer_call | send_order_link | send_booking_link | custom_sms),
              target_number, max_attempts, allowed_after_hours (bool), intent_condition?
              evidence: S20, voice agent overview ("conditional transfers")  confidence: medium

StoreHours    location_id, weekday, open_for_business (bool), opens_at, closes_at, gaps[] (start, end)
              evidence: S28                             confidence: high

KnowledgeEntry id, location_id, question, answer, source (manual | automatic), created_at
              evidence: S25, S26                        confidence: high   (no updated_at: edit not supported)

CoachingInstruction id, location_id, text, active        (support-managed; no UI)
              evidence: coaching article                confidence: guess

DifficultWord id, location_id, word, phonetic           evidence: S30   confidence: medium

PosConnection id, location_id, provider (square | toast | clover | ...), via (direct | streamorders | marketplace),
              external_merchant_id, status (active | inactive), last_synced_at
              evidence: S06, S29, OpenAPI Connection    confidence: high

Menu          id, location_id, catalog_id, version_id, currency, locale, timezone, availability windows
MenuCategory  id, menu_id, name, position
MenuItem      id, category_id, external_id, name, description, price_minor, price_type,
              stock_status (in_stock | out_of_stock | low_stock), visible_to_ai (bool)
ModifierGroup id, external_id, name, min, max   (min 1 = required)
ModifierOption id, group_id, external_id, name, price_minor
ItemModifierGroup item_id, group_id
TaxRate / Fee / Discount   (from the menu document: method, base, inclusion; fee types; discount types)
              evidence: S23, OpenAPI Menu schema, Toast sync article  confidence: high

Call          id, location_id, caller_phone, caller_name?, started_at, duration_s,
              resolution, summary, recording_url, transcript, order_id?, transferred (bool)
              evidence: S14, S15                        confidence: high

Order         id, location_id, call_id?, status (PENDING | ACCEPTED | AUTO_ACCEPTED | READY | IN_DELIVERY |
              FULFILLED | REJECTED | STORE_CANCELLED | CUSTOMER_CANCELLED),
              payment_status (pending | paid | failed | voided | refunded | partially_refunded),
              fulfillment_type (pickup | delivery), scheduled_for?, customer_name, customer_phone,
              subtotal, tax, surcharge, tip, delivery_fee, total (integer cents), currency,
              external_id (POS order id), payment_link_url?, created_at
OrderLineItem id, order_id, menu_entity_id, name, quantity, base_price, tax
OrderLineModifier id, line_item_id, menu_entity_id, name, quantity, price
              evidence: S11, S12, OpenAPI Order schema, order lifecycle doc   confidence: high

OrderValidation id, order_id, validation_id, status (valid | invalid), reason_code, explanation,
              item_external_ids[], expires_at
              evidence: OpenAPI validation_result         confidence: high

WebhookSubscription id, url, event_types[], secret, status (enabled | disabled), consecutive_failures
WebhookEvent  id, type, payload, attempts, delivered_at
              evidence: webhooks doc                     confidence: high   (clone: inbound Square/Twilio events instead)

Notification  id, location_id, kind (onboarding_task | setup_reminder | pos_setup), done (bool)
              evidence: S02, S03                         confidence: medium

SmsRegistration location_id, ein, legal_name, status (pending | verified | blocked)
              evidence: SMS article                      confidence: medium
```

Relationships: Organization 1-n Merchant; Merchant 1-n Location; Merchant 1-n LegalEntity 1-n Location; User n-n Merchant/Location via Membership; Location 1-1 Agent (docs list "agent" as a location attribute); Location 1-n PhoneNumber; Agent 1-n AgentAction; Location 1-1 PosConnection; Location 1-n Menu 1-n MenuCategory 1-n MenuItem n-n ModifierGroup 1-n ModifierOption; Location 1-n Call 0..1-1 Order 1-n OrderLineItem 1-n OrderLineModifier; Order 1-n OrderValidation; Location 1-n KnowledgeEntry / DifficultWord / StoreHours.

## Where `spec.md` differs from Maple

The architect needs this table most.

| topic | Maple does | spec.md wants | so what |
| --- | --- | --- | --- |
| **Unpaid Square orders** | "Pay in store and cash on pickup are not available" on Square. Square, Smile, SpotOn and Qu "require payment before order submission". Every Square order is prepaid by texted link. | Pay at pickup, no payment on the call | **This is outside evidence for the spec's P0 blocker (§1, FR-SQUARE-007).** A funded competitor with a Square integration chose not to send unpaid orders to Square. Run the Square Sandbox test first, and pick the fallback now. Maple's own fallback for POS systems it can't write to is a tablet or printer. |
| Square connection | Through the StreamOrders relay | Direct Square OAuth | Fewer moving parts, but you own the catalog and order mapping |
| Menu freshness | 5–10 min through the relay, plus a manual resync button | `catalog.version.updated` webhook + periodic sync + freshness guard | Can beat Maple on 86'd items |
| Variations | Each Square variation becomes its own item | Keep variation IDs and ask "which size?" | Better voice UX |
| Recordings | Every call is recorded and transcribed | Off by default; transcripts opt-in | Privacy angle; still store a summary |
| Order confirmation | Read-back (known bug: last item can drop) | Explicit "yes" bound to an order version; any change means re-confirm | Must row |
| Submission safety | Validation request → result expires → revalidate before final submit; decisions replay-safe | Idempotency key, `SUBMISSION_UNKNOWN`, reconcile | Same idea. Maple doesn't show "unknown" states to merchants; the spec does. |
| FAQs | Add and delete only, no edit, no expiry; stale entries override settings | `valid_from` / `valid_until`, structured hours and holidays | Easy win |
| Aliases, coaching, pronunciation | Mostly done by Maple support on the backend | Tenant-editable aliases (FR-MENU-012) | Self-serve is a selling point |
| Onboarding | EIN, bank, Stripe KYC, card on file, 10DLC (1–4 weeks), specialist activation | No payments, so no KYC | Faster go-live is a positioning angle |
| Test mode | None; test orders hit the real kitchen | Staging + Square Sandbox | Must row |
| Callback request | Not documented | `request_callback` tool when transfer fails | Gap in the original |

## Feature matrix

See `features.csv`: 121 rows. Must: 60, should: 33, could: 18, skip: 10.
Maple has 84 of them, has 9 partly, and lacks 28. Those 28 are spec requirements Maple doesn't do, mostly safety, privacy and self-serve gaps, and they're where the clone can win.

## Out of scope (cannot or should not be cloned)

- **Payments:** pay-by-link, the Stripe hosted page, tips, service fee and KYC. These are a spec non-goal (§3).
- **Delivery and Maple Fleet:** Maple Fleet is a partner courier network (First Delivery). Delivery is also a spec non-goal.
- **Reservations and waitlist:** OpenTable, Resy and SevenRooms are partner integrations, and reservations are a spec non-goal.
- **Drive-thru unit and kiosk:** these are hardware.
- **StreamOrders relay:** a partner deal. The clone talks to Square directly.
- **Maple's call data and tuning:** "1M+ restaurant phone calls" of research, QA tooling and tuned prompts are data the app owns.
- **Maple's brand, copy, voices and FAQ template text:** write your own. The 34-question template is reference only.
- **Printer hardware supply:** keep the idea as a fallback, not the hardware business.

## Size

Screens 44 (39 in scope, counting S41–S44 added during architecture), flows 14, entities ~30 (~22 in scope).
Hard parts:
1. **Real-time voice loop.** Twilio Media Streams ↔ OpenAI Realtime with barge-in, filler while tools run, and typed tool calls under ~1.5 s per turn.
2. **Square unpaid pickup orders.** Maple's docs say this isn't supported on Square, so this is a real P0 risk. It needs a Sandbox and live test plus a signed-off fallback before the order flow is built.
3. **Catalog sync and order integrity.** Square variations, nested and required modifiers, 86'd freshness, revalidation before submit, idempotent submission and reconciliation.

Also non-trivial: transfer edge cases (busy lines, carrier voicemail, loops) and tenant isolation.
Size: **L**. The must rows alone match the spec's own 5–8 week MVP estimate for one engineer. The should rows, voice tuning and the pilot push it to about a quarter.
