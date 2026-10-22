# Components

Built on Radix primitives (`radix-ui`) for focus management, keyboard support and ARIA. Icons come from Lucide (ISC licence). The font is Inter (SIL OFL). Everything uses token classes (`bg-surface`, `text-muted`, `border-input`, `ring-focus`). There are no raw hex values or arbitrary sizes, and the Tailwind theme switches the defaults off to enforce that.

**Primitive** = built once in `/design` before any screen (milestone M1). **Composite** = built with its screen in `/replica-build`, from primitives.

Rules for every component:
- Focus is a 2px `ring-focus` with a 2px offset, shown only for keyboard focus (`focus-visible`).
- The minimum hit target is 40×40 on the dashboard and 48×48 on the live queue (S41, used on a tablet).
- Colour is never the only signal. Status always has an icon and text.
- Motion uses `--ds-motion-*` and switches off under `prefers-reduced-motion`.
- Copy is our own. The labels below are the source of truth for `/replica-build`.

## Status vocabulary

Defined once and used by StatusPill, TicketCard, tables and filters.

| domain | value | label | tone | icon |
| --- | --- | --- | --- | --- |
| order | DRAFT | Taking order | neutral | PencilLine |
| order | NEEDS_CLARIFICATION | Needs details | neutral | CircleQuestionMark |
| order | READY_FOR_CONFIRMATION | Reading back | neutral | ListChecks |
| order | CUSTOMER_CONFIRMED | Caller confirmed | accent | CircleCheck |
| order | SUBMISSION_PENDING | Sending… | accent | Loader (spins) |
| order | SUBMISSION_UNKNOWN | Check needed | warning | TriangleAlert |
| order | SUBMITTED_TO_POS | New ticket (ticket mode) / In Square (Square mode) | accent | Bell / Send |
| order | POS_VISIBILITY_UNVERIFIED | In Square, not seen yet | warning | EyeOff |
| order | RECEIVED_BY_RESTAURANT | Accepted | success | CircleCheckBig |
| order | TRANSFERRED_TO_STAFF | Passed to staff | neutral | PhoneForwarded |
| order | ABANDONED | Caller hung up | neutral | PhoneOff |
| order | FAILED | Failed | danger | CircleX |
| order | CANCELLED | Cancelled | neutral | Ban |
| call | INFO_RESOLVED | Answered | success | MessageCircle |
| call | ORDER_SUBMITTED | Order placed | accent | ShoppingBag |
| call | TRANSFERRED | Transferred | neutral | PhoneForwarded |
| call | STAFF_ANSWERED | Staff picked up | neutral | Phone |
| call | CALLBACK_REQUESTED | Callback | warning | PhoneCall |
| call | CALLER_HUNG_UP | Hung up | neutral | PhoneOff |
| call | FAILED | Failed | danger | CircleX |
| menu sync | fresh | Menu up to date | success | RefreshCw |
| menu sync | running | Syncing menu… | accent | RefreshCw (spins) |
| menu sync | stale | Menu out of date | warning | TriangleAlert |
| menu sync | failed | Sync failed | danger | CircleX |
| Square | CONNECTED | Connected | success | Plug |
| Square | NEEDS_REAUTH / REVOKED | Reconnect Square | danger | Unplug |

Tones map to tokens:
- neutral = `bg-surface-muted text-muted`
- accent = `bg-accent-subtle text-accent`
- success = `bg-success-subtle text-success`
- warning = `bg-warning-subtle text-warning`
- danger = `bg-danger-subtle text-danger`

Every pair is in the contrast report and passes AA.

## Primitives

```
Button                                                         primitive
  variants  primary (bg accent / text on-accent), secondary (bg surface, border border, text fg),
            ghost (text fg, hover surface-muted), danger (bg danger / text on-danger)
  sizes     sm 32px, md 40px, lg 48px (lg is the live-queue size)
  states    default, hover, active (translate-y 1px), focus-visible, disabled (50% opacity, no pointer),
            loading (spinner replaces the leading icon, label stays, aria-busy)
  tokens    radius md, text sm/600, gap 2, px 4 (md)
  a11y      real <button>; type="button" unless it submits a form; icon-only must use IconButton
  used on   all
```

```
IconButton                                                     primitive
  variants  ghost, secondary
  sizes     sm 32, md 40, lg 48
  states    as Button
  a11y      required aria-label; Tooltip shows the same text on hover and focus
  used on   S10, S12, S15, S23, S25, S28, S41
```

```
FormField (Label + control + hint + error)                     primitive
  layout    label above (text sm/600 fg), hint below (text xs muted), error replaces hint (text xs danger + icon)
  states    default, error, disabled, required (asterisk + "required" in the accessible name)
  a11y      <label for>, aria-describedby → hint/error, aria-invalid on error; errors appear on blur or submit, never per keystroke
  used on   all forms
```

```
Input                                                          primitive
  sizes     md 40px, lg 48px
  states    default (border input), hover (border fg), focus-visible (ring), invalid (border danger),
            disabled (bg surface-muted), read-only
  tokens    bg surface, text base, radius md, px 3
  used on   S01, S04, S09, S20, S25, S28
```

```
PhoneInput                                                     primitive
  behaviour country fixed per location (+1 default); formats as typed; stores E.164; shows the
            normalised number under the field ("Saved as +1 555 012 3456")
  states    Input states + "This is your AI number. Transfers to it would loop back." (error)
  a11y      inputmode="tel", autocomplete="tel"
  used on   S04, S09, S20
```

```
Textarea                                                       primitive
  states    Input states + character counter (text xs muted, danger past the limit)
  a11y      the counter is aria-live="polite" only within 20 characters of the limit
  used on   S17 (greeting, 400), S25 (answer, 2000), S26 (URLs)
```

```
Select                                                         primitive (Radix Select)
  states    closed, open, highlighted option, selected (check icon), disabled option, invalid
  a11y      type-ahead, arrow keys, Esc closes and returns focus
  used on   S04 (timezone), S17 (language), S20 (intent), S43 (role)
```

```
Checkbox                                                       primitive (Radix Checkbox)
  states    unchecked, checked, indeterminate, focus-visible, disabled
  used on   S05, tables (row select, CSV export)
```

```
Switch                                                         primitive (Radix Switch)
  states    off, on (bg accent), focus-visible, disabled, pending (after the click until the save lands)
  a11y      role="switch" + label; the label says what ON means ("Take pickup orders")
  used on   S18, S19, S20, S24, S28
```

```
RadioGroup / RadioCards                                        primitive (Radix RadioGroup)
  variants  list (compact), cards (title + description, selected = border accent + bg accent-subtle)
  states    unselected, selected, focus-visible, disabled (with a reason line, e.g. "Needs Square sign-off")
  a11y      arrow keys move and select; the group has a legend
  used on   S19 (ordering mode), S20 (transfer strategy), S17 (after-hours mode)
```

```
Tabs                                                           primitive (Radix Tabs)
  variants  underline (page sections), pill (filters)
  states    default, hover, active (text fg + 2px accent underline), focus-visible, disabled
  a11y      arrow keys between tabs; panels are focusable
  used on   S16–S21 (agent editor), S23 (menu views), S11 (order status filters)
```

```
Card                                                           primitive
  variants  flat (border border), raised (shadow card)
  tokens    bg surface, radius lg, p 5
  used on   all
```

```
StatusPill                                                     primitive
  input     {domain, value} → label, tone and icon from the status vocabulary
  sizes     sm (text xs, h 22), md (text sm, h 28)
  tokens    radius pill, tone pairs as listed above
  a11y      text is always present; a spinning icon is aria-hidden
  used on   S11, S12, S14, S15, S23, S29, S41
```

```
Table                                                          primitive
  parts     header (bg surface-muted, text xs/600 muted, sticky), rows (hover surface-muted),
            row = link to the detail drawer, cursor "Load more" footer
  states    loading (5 skeleton rows), empty (EmptyState in the body), error (Banner above), filtered-empty
  mobile    below md, columns marked desktopOnly hide and their values move to a MobileDetail line
            under the first cell (it stays a real <table>; stacked-card CSS drops table semantics)
  a11y      <table> semantics; a row link is the first cell's <a>, not a clickable <tr>
  used on   S11, S14, S23, S42, S43, S44
```

```
EmptyState                                                     primitive
  parts     Lucide icon (muted, 32), title (text lg), one sentence, optional primary action
  copy      S11 "No phone orders yet. They'll appear here as soon as a caller confirms one."
            S14 "No calls yet. Call your AI number to try it."
            S25 "Add the questions your staff answer every day, like parking, allergies and hours. Aim for ten before you go live."
            S41 "All caught up. New phone orders will ring here."
  used on   all lists
```

```
Skeleton                                                       primitive
  tokens    bg surface-muted, radius sm, a pulse animation (none under reduced motion)
  a11y      the container is aria-busy="true"; skeletons are aria-hidden
  used on   all async views
```

```
Dialog + ConfirmDialog                                         primitive (Radix Dialog)
  sizes     sm 400, md 560
  parts     title, description, body, footer (secondary left, primary right)
  states    open, closing, submitting (primary loading, Esc disabled)
  ConfirmDialog  for destructive actions: names the thing ("Disconnect Square from Main Street?")
  a11y      focus trap, Esc closes, focus returns to the trigger, scrim uses --ds-shadow-overlay
  used on   S25, S26, S29, S43
```

```
Drawer (Sheet)                                                 primitive (Radix Dialog, side panel)
  width     --ds-drawer (480), full width below md
  states    open, loading (skeleton), error
  a11y      as Dialog; the URL updates (?order=…), so the drawer is linkable and back closes it
  used on   S12 (order summary), S15 (call summary)
```

```
Toast                                                          primitive (Radix Toast)
  variants  success, error, info
  behaviour bottom-right; 5 s; pauses on hover/focus; errors stay until dismissed
  a11y      role="status" (polite); errors are role="alert"
  used on   saves across S17–S30
```

```
Tooltip                                                        primitive (Radix Tooltip)
  behaviour 300 ms delay; opens on hover and focus; never holds information that isn't available elsewhere
  used on   IconButton, truncated cells
```

```
DropdownMenu                                                   primitive (Radix DropdownMenu)
  states    item default, highlighted, disabled, destructive (text danger)
  used on   row actions (S11, S25, S43), the location switcher
```

```
Banner                                                         primitive
  variants  info (accent-subtle), warning, danger, success. Page-level (full width under the header)
            or inline (in a card)
  parts     icon, title, one sentence, an optional action button, an optional dismiss (not for critical)
  copy      "Square ordering isn't switched on yet. Orders go to Live orders until the Square test is signed off."
            "Square disconnected. Phone orders are paused until you reconnect."
            "The menu hasn't synced for 2 hours, so the AI won't take orders until it does."
  a11y      role="status"; critical uses role="alert" once, not on every render
  used on   S10 (global), S29, S41
```

```
SyncIndicator                                                  primitive
  parts     StatusPill (menu sync) + "Updated 4 min ago" (relative time, absolute in the tooltip) + Resync IconButton
  states    fresh, running (icon spins, button disabled), stale, failed (the tooltip shows the error code)
  used on   S23, S29, S10 (compact)
```

```
StatTile                                                       primitive
  parts     label (text xs/600 muted), value (text xl), delta vs the previous period (text xs; success/danger + arrow icon)
  states    loading (skeleton value), no data ("–")
  used on   S27, S02
```

```
Stepper (setup wizard)                                         primitive
  parts     vertical step list (done ✓ / current / upcoming), content area, footer (Back / Continue),
            "Finish later" link (progress is saved)
  states    step done, current, blocked (with a reason), error
  a11y      aria-current="step"; Continue validates the current step only
  used on   S04–S09, S13
```

```
TicketCard (live order queue)                                  primitive
  parts     age timer ("2 min ago", turns warning at 5 min), customer name + last 4 digits of the phone,
            pickup time (ASAP / time), item lines (qty × name, modifiers indented, notes in italics),
            total, StatusPill, Accept button (lg, primary), Print (IconButton), "Check needed" variant
  states    new (border accent + gentle pulse once), accepted (collapses into the done column),
            check-needed (warning banner inside: "We're not sure this reached Square. Confirm before cooking."),
            test (dashed border + "Test call" pill, no sound)
  sound     a chime on new tickets; needs one click to enable audio (browser rule), with a visible "Sound on" toggle
  a11y      new tickets are announced in an aria-live="assertive" region: "New order for Sam, 3 items"
  used on   S41
```

## Composites (built with their screens)

```
AppShell             sidebar (--ds-sidebar 248) + header (--ds-header 56) + global Banner slot + main (max --ds-content-max)
                     below lg: the sidebar becomes a Drawer opened from a menu IconButton             S10, all
Sidebar nav          groups: Today (Live orders, Calls, Orders, Callbacks), Setup (AI agent, Menu, Knowledge,
                     Hours & location, Square), Insights (Analytics), Settings (Team, Audit log)
                     active = bg accent-subtle text-accent; counts as StatusPill sm                    S10
LocationSwitcher     DropdownMenu at the top of the sidebar; hidden with a single location               S10
SetupChecklist       Card with tasks (done/pending), from GET /onboarding; the bell shows the count       S02, S03
CallRow / CallCard   time, masked caller, StatusPill (call), one-line summary, order chip; opens the S15 drawer   S14
AudioPlayer          play/pause, scrubber, time, download (only if recording is on)                       S15
TranscriptView       speaker turns (Caller / AI), timestamps, tool events folded in muted text             S15
OrderTimeline        vertical list of order_events + submission attempts (HTTP status, key, outcome)      S12
WeeklyHoursEditor    7 rows × shifts (time inputs), "+ Add shift", "Closed" Switch, overnight hint, overlap error  S28
SpecialHoursList     date, closed/hours, note; DatePicker                                                S28
FaqRow               question, answer preview, valid-until chip, source chip (Manual/Template/Generated),
                     an unreviewed state needs a "Review" action before it's used                       S25
NumberPicker         area code Input + result list (RadioCards) + "Search again"                          S09
VoiceCard            name, description, play-sample IconButton, selected state                           S21
TransferTargetList   rows: label, number, intent, hours; add/edit in a Dialog; loop guard error           S20
WebCallWidget        mic permission state, connecting, live (level meter), end; "This is a test call. Orders won't reach the kitchen."   S22
MenuBrowser          Tabs (Categories, Items, Modifier lists) + search + rows with price, sold-out and
                     hidden-from-AI chips; row → item drawer with aliases and the overlay Switches       S23, S24
DateRangeFilter      presets (Today, 7 days, 30 days) + custom; in the URL                                S11, S14, S27
Chart                built in M3 with S27; colours and marks come from /dataviz, not invented here         S27
HelpLauncher         IconButton (CircleQuestionMark) → docs link + email support                                  S31
```

## Layout

- **Content:** max width 1200 at 24px padding; 16px below md.
- **Grid:** 12 columns with a 24px gap; cards stack below md.
- **Breakpoints:** sm 640, md 768, lg 1024, xl 1280.
- **Live queue (S41):**
  - A ticket grid using `repeat(auto-fill, minmax(--ds-ticket-min 300px, 1fr))`.
  - Dark mode by default on that screen (a `data-theme` toggle, remembered per device).
  - No sidebar in tablet mode (`?mode=kitchen`).
- **Density:** tables use 48px rows (40 compact); forms use 16px vertical rhythm between fields.
