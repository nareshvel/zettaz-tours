# Overview: the shift briefing

**Replaced the previous Overview on 15 September 2026.** The page is a briefing, not a report: what is running now, what breaks if nobody acts, and what the week looks like. Anything that cannot finish the sentence *"…and then I would do X"* belongs on Reports.

## What was wrong with the old page

Recorded because these are the failure modes to avoid when the page grows again.

1. **Lifetime totals led the page.** "Confirmed bookings — all departure dates" and "Confirmed guests" only ever rise; "Upcoming departures" counted every future departure, so publishing next season inflated it. Three of four tiles could not change anyone's next move.
2. **"What needs attention" was a number, not a queue.** Weather holds + closures + unassigned + unresolved pickups were summed into one integer that linked nowhere — four unrelated problems with no subject and no action.
3. **Half the priority panel restated the sidebar.** Reservations / Day Board / Finance / Team are permanent nav items.
4. **No time horizon anywhere.** Nothing was scoped to today or this week, though the operator's first question is "what is running today".
5. **Money was absent** even though `reports/v1/overview` already computed it.
6. **Role-awareness was a label.** Apart from one branch for `resources`, every role saw the same page; crew saw an empty state.
7. **The reservation table duplicated the Reservations page.** Recency is not priority.
8. **Capacity showed sequence, not risk** — 2/20 tomorrow looked the same as 19/20 next week.
9. **Six parallel fetches** on load for tiles that changed no behaviour.
10. **No new-tenant story** — zeros and an empty list exactly when guidance matters.

## What it is now

**One endpoint.** `GET staff/v1/workspace/briefing` (`bookings.read`) returns the day, today's counts, the decision queue, a 72-hour timeline and seven days of demand. Everything is bounded by the tenant's **local date** — a departure belongs to the day the crew calls it, not to a UTC window.

**Today strip.** A live countdown to the next departure (the page's hero figure, ticking once a second — inside a day it is a running clock, `6:41:09`, because a second hand is what makes it obvious the page is live rather than a screenshot from this morning; beyond a day it degrades to whole days), departures and guests today, boarding progress as a meter, and money still to collect today — the last only for roles that can act on it.

**What happened to "Needs a decision".** The queue panel was removed on 15 September: row for row it repeated the crew and pickup flags already on every Readiness line, and two panels saying the same thing is worse than one. What it uniquely carried moved to the **top-bar bell** (`GET staff/v1/workspace/notifications`), because an expiring compliance document is not what the Overview is for and it follows the reader onto every page.

The briefing's own `queue` is now departure-derived only, so nothing is counted twice. Notification items are filtered server-side by what the reader may act on — documents need `resources.write` / `documents.expiry.manage` / `config.write`, holds need `bookings.read`, balances need a payment permission — so a partner manager is never shown the day's takings. The badge counts only critical and warning items, so a standing "balance due" never inflates it.

Departure-derived kinds (briefing) and standalone kinds (bell):

| Kind | Raised when | Severity |
| --- | --- | --- |
| `weather_hold` / `closed` | departure in the next 3 days is not open | critical |
| `unassigned` | departure within 24h carrying guests has no active assignment | critical |
| `unresolved_pickup` | confirmed booking with no pickup agreed, departing within 48h | critical inside 12h, else warning |
| `expiring_hold` | unconsumed hold on a held booking expiring within the hour | warning |
| `document` | compliance document expired or expiring within 7 days | critical if expired |
| `balance` | confirmed bookings departing today still owing money | info |

**Selling slowly.** Readiness answers *can this run*; this answers *should it*. Departures in the next 14 days under 40% sold, soonest first — the promote-or-cancel decision, which nothing else on the page surfaced. Today is excluded: by the morning of departure that decision has already been made.

**Next 72 hours.** Grouped by local day; each departure shows time, product, a capacity meter, and crew / pickup readiness flags. Flags carry their own word — status is never colour alone.

**Next 7 days.** Guests booked per day. One series, so no legend: the heading names what is plotted, today carries the accent step and the other days a lighter step of the same hue. Only the peak column is labelled; the rest are in the tooltip.

**New tenant.** With no product or departure published, the page says so and points at the catalog instead of rendering a wall of zeros.

**Role shaping.** One page that reorders, rather than five pages that drift apart. `planFor(role, canMoney)` returns the panel order and the row cap:

| Role | Order | Why |
| --- | --- | --- |
| owner, admin | today → demand + money charts → timeline → selling slowly | An owner is not working the queue; they want the week's shape first, then a short list of what needs a person |
| dispatcher, operations_manager | timeline → today → demand | Opens the page to see what is wrong. No money |
| finance | money → today → timeline | Collections first; no crew or pickup readiness |
| reservations | today → demand → selling slowly → timeline | Sell-side: where the week is thin, then holds and balances |
| resource_manager | today → timeline (6 rows) | Readiness flags and expiring documents |
| auditor, partner_manager | today → demand → timeline | Read-only roles get the picture, not the work queue |

Two consecutive charts share a row; every other panel is full width, because a queue row needs the room for its action. The money tile and the money panel appear only with `payment.write` / `payment.correct` / `config.write`.

**Row caps.** List panels show five rows, then a footer with the remaining count and a **View all** button to Departures.

**Mobile.** The tiles are two up below 620px; the countdown and the money tile each span both columns, so neither is orphaned on an odd row. The page action shortens to "Book" — "New reservation" is the whole button at 414px. The tour name under the countdown is clipped with an ellipsis rather than wrapped, so a long name cannot push that tile taller than its neighbours.

**Equal heights.** Two panels sharing a chart row stretch to the taller one, and an empty state inside takes the slack so its message sits centred instead of clinging to the heading. Stacked below 1100px the rule is switched off — with no neighbour to match, it would only leave a tall empty panel under a short message.

**Second chart: the month's money.** Received against outstanding on this calendar month's departures — the window an owner actually thinks in, where a rolling week cut across it arbitrarily, as a single stacked bar with a 2px surface gap between the segments and both values labelled — a two-slice pie is always a worse bar, and the split has to survive greyscale. Validated pair: `#00897c` / `#c9860b`, ΔE 22.6 normal / 12.8 protanopia.

## Chart rules

Deliberately few, because most dashboard charts are decoration:

- A ratio against a limit is a **meter**, never a chart (capacity, boarding).
- A number plus a trend is a **stat tile with a sparkline**, never a full line chart.
- Part-to-whole with two parts is a **stacked bar**, never a pie.
- **No dual-axis charts.** Two measures of different scale are two charts.
- Rejected outright: a pie of booking sources (never changes today's actions — that is a Reports question), gauges, donuts with a number in the hole.

### Palette

Data colours are their own set, validated rather than eyeballed (light surface, categorical and ordinal checks):

| Role | Value | Note |
| --- | --- | --- |
| Data teal | `#00897c` | the single-series hue |
| Data teal, soft | `#6cc2b5` | non-emphasised columns |
| Warning | `#c9860b` | |
| Critical | `#b3342a` | |

`--teal #176c63` **fails as a data colour** — chroma 0.078, below the 0.1 floor — so at mark size it reads grey. It stays a UI chrome colour. The status pair's worst adjacent separation is ΔE 19.6 normal / 12.8 protanopia, above the floor, and every status still ships with an icon and a word.

These are system-owned: **tenant branding must not repaint chart marks**, or the contrast and colour-vision guarantees go with it.

## Payload skew

`normalizeBriefing()` fills in any section the server did not send. In development the web app hot-reloads the moment a file is saved while the API is still serving its previous build, so a payload one field behind the page is a normal state — and a panel reading straight into `data.week.receivedMinor` turns that into a blank screen. The affected panel shows its empty state instead and the rest of the page stays up. The same reasoning covers date parsing: `localDayLabel` and `clockLabel` return an em dash rather than letting `Intl` throw inside a `.map`.

Both defences were added after they had already failed once each — a `generate_series` returning timestamps, and `week` arriving from an API that had not been restarted.

## Not done yet

- The SQL in `briefing` is **unexecuted** — no database is reachable from the development bridge. It typechecks and follows the existing board/report queries, but it needs a real run before it is trusted.
- Sparklines (14-day booking pace) are specified but not built.
- Guide and driver roles still land on `/crew` for web. Owner, admin, dispatcher, and other Day Board roles no longer see **My trips** in the web sidebar; they use Overview and Day Board. Field work stays on Zettaz Crew.
