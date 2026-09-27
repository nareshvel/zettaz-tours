# Zettaz Tours — Reports Review & Remaining Work Plan

Prepared 27 Sep 2026 · Review only, no code changed · Sources: `apps/api/src/reports.ts`, `apps/web/components/reports*.tsx`, `docs/FEATURES/reporting-minimum.md`, `docs/HANDOFF/agent-current-sprint.md`, `.cursor/plans/centralized_reports_hub_*.plan.md`, working tree state.

---

## 1. Urgent: mistakes in our own recent work

| # | Issue | Impact | Fix |
|---|---|---|---|
| 1.1 | `globals.css` was restored to HEAD, but HEAD does **not** contain the new Email Templates redesign CSS (`.email-kind-tab`, `.email-var-chip`, `.email-preview-iframe` etc. = 0 matches). | Settings → Email templates will render unstyled. | Re-append only the email-templates CSS block to the **end** of `globals.css` (append, never replace a range). |
| 1.2 | Four files uncommitted (`administration.tsx`, `email-templates-settings.tsx`, `contracts.ts`, `test/fixtures.ts`). | Easy to lose again; the CSS wipe happened because there was no checkpoint. | Commit after 1.1 is verified. Rule going forward: commit before any bulk CSS edit. |
| 1.3 | Bulk CSS edits via Python `str.replace` over ranges wiped ~1,900 lines twice. | Broke Skip link, reports, login, waiver editor. | Never range-replace in `globals.css`. Longer-term: split into per-surface CSS files (`reports.css`, `settings.css`, …) imported from `globals.css`. 16k-line single file is the root risk. |
| 1.4 | Reports desktop view shows **both** the daily table and the mobile day cards (screenshot). | Duplicate data on desktop. | Confirm the `@media` rule that hides `.report-daily-cards` above phone width survived; hide table on phone, cards on desktop. |
| 1.5 | Aside ↔ content gap: `.workspace-main` uses `margin-left: 285px` while the sidebar is ~280px wide *plus* a floating 14px inset, and `max-width: calc(100% - 292px)` differs from `width`. | Visible dead strip; inconsistent across breakpoints (252px at one breakpoint). | Define one `--sidebar-width` token and use it in sidebar width, main margin, skip-link `left`, and breakpoints. |

---

## 2. Period overview — data correctness findings

These are real numbers issues, visible in your screenshot (Booked $6,479.10, Received $1,008.21, Guest balance $5,695.14 — balance + received > booked, which should not happen).

| # | Finding | Why it matters | Recommendation |
|---|---|---|---|
| 2.1 | **Received** sums settled payments for *all* bookings in range, including cancelled/other states; **Booked** and **Balance** only count confirmed. | Numbers don't reconcile; an accountant will spot it immediately. | Either filter received to confirmed, or show received split: "on confirmed / on cancelled (refund due?)". Add a reconciliation line: Booked − Received − Partner credit = Balance. |
| 2.2 | "38 total · 16 confirmed · 2 cancelled" — 20 bookings in other states are unexplained. | User can't tell what the 20 are (held? pending payment? no-show?). | Show a state breakdown (confirmed / pending / held / no-show / cancelled). |
| 2.3 | Currency comes from `tenants.base_currency` (fallback **XCD**) but UI & docs say "tenant reporting currency" (shows USD). Sums add `totalMinor` across bookings regardless of each booking's currency. | Silent mixed-currency totals once a tenant takes USD + XCD bookings. | Read `config.reportingCurrency`; exclude or separately list bookings in other currencies ("3 bookings in XCD not included") until FX policy exists. |
| 2.4 | Payment adjustments exclude the whole payment instead of netting refunds. | Partial refunds disappear from received. | Net `amount − adjustments`. |
| 2.5 | Daily table only lists dates that have departures (26 Sep missing). | Looks like a bug/gap. | Generate a full date series (`generate_series`) so zero days show. |
| 2.6 | Date basis = departure date only. | Finance usually wants "booked on" and "paid on" too. | Add a basis toggle: Departure date / Booking date / Payment date. |
| 2.7 | Guests counted via `holds.seats`. | Wrong if holds are amended/expired after confirmation. | Use booking party size snapshot. |
| 2.8 | No automated test for the arithmetic (only tenant isolation). | Regressions invisible. | Add fixture test: known bookings/payments → exact totals. |

---

## 3. Reports page UX improvements

**Layout (from screenshot)**

- KPI tiles render as plain text lines ("Confirmed bookings16 38 total…") — style as a 4-card metric row with label / big number / sub-line, and make each clickable into the filtered Reservations list.
- "Needs review" exceptions: render as 4 compact chips with counts; highlight non-zero in amber; each links to Day Board / Departures filtered (e.g. *Unassigned departures 27 → Departures?filter=unassigned*).
- Toolbar: put period menu, CSV, print on the same line as the title; show the resolved range beside the menu ("21–27 Sep 2026 · USD · America/Antigua").
- Catalog column: the "Later" group takes half the column. Collapse it into a single "Coming later (5)" disclosure.
- Add a small trend: bar chart of daily guests/bookings above the table (no library needed — CSS bars).
- Compare-to-previous-period delta on each KPI (▲ 12% vs last week).
- Remember last report + period per user (localStorage).
- Empty-state and loading skeleton for each report.

**Behaviour**

- Deep links carry filters in the URL (`/reports/period-overview?from=…&to=…`) so reports can be shared/bookmarked.
- CSV includes a header block (tenant, range, currency, generated at, generated by).
- Print: add tenant logo and "Generated … by …" footer.

---

## 4. Remaining reports — scope for each

Current catalog: **Live** = Period overview, Expense summary, Partner aging. **Later** = P&L overview, Commission summary, Partner statement PDF, Accounting export, Sales by product.

Suggested order (value ÷ effort, respecting Track A rules):

| Order | Report | Group | Data exists? | Scope | Blockers |
|---|---|---|---|---|---|
| 1 | **Sales by product** | Money | Yes — bookings + price snapshots + catalog | Per product/option: bookings, guests, booked value, received, avg price, cancellation %, occupancy (seats sold / capacity). Filters: period, basis, channel. | Same currency rule as 2.3 |
| 2 | **Commission summary** | Partners | Yes — `partner_obligations`, claims | Per partner: bookings referred, gross, commission accrued, paid, outstanding. Drill to partner ledger. | Commission rule source must be the stored obligation, not recalculated |
| 3 | **Partner statement PDF** | Partners | Yes (ledger) | Server-rendered PDF via existing `pdf.ts` (not print agent): opening balance, lines, closing balance, tenant branding. Plus "email to partner" later. | Reuse aging/ledger query |
| 4 | **Booking sources / channel mix** (new, from plan) | Operations | Yes — booking source/integration channel | Bookings & value by channel (direct, partner, OTA import). | none |
| 5 | **No-show & cancellation report** (new) | Operations | Yes — boarding/no-show state | Rate by product/day, reasons. | none |
| 6 | **Accounting export** | Money | Partial | CSV journal per `docs/FEATURES/finance/accounting-export.md`: revenue, payments, partner payables, expenses, mapped to account codes set in Settings. No QBO OAuth yet. | Needs chart-of-accounts mapping in Settings |
| 7 | **P&L overview** | Money | Partial | Revenue (recognised on departure date) − commissions − expenses by category. Clearly labelled "management P&L, not tax". | Needs 2.3 FX policy + accounting export mapping; do last |
| — | Audit log / Customers | People & compliance | Yes | Catalog **links** only (per plan), no duplicate report. | — |

Keep out (Track B): warehouse, report builder, scheduled email reports, QBO live sync, print-agent report PDFs.

Each new report should ship with: registry entry, permission check, shared toolbar, CSV, print CSS, tenant-isolation test **and** arithmetic test, evidence doc in `docs/TESTING/`.

---

## 5. Other pending items from the sprint board

**Owner actions (not engineering)**
- Crew app App Store rejection 5.1.2(i): set App Privacy → Tracking = No, reply in Resolution Center. Do not add ATT.
- Owner visual passes outstanding: Overview, Reports, Customers, Finance, Assets, Staff & access, Document library, Audit, Profile, Tenant settings (General, Taxes, Guest stays, Partners).
- Physical print-agent pairing test.

**Engineering, in queue**
- Commit + deploy pending local commits; confirm VPS SHA (board says prod migrations through 089; local has 095–097 for platform console — held).
- Email templates: fix 1.1, commit, then test real send for all 4 kinds (only booking confirmation path confirmed wired in `notifications.ts`; verify payment/waiver/cancellation also read overrides).
- Staff & access remaining polish (owner-named next surface) → Subscription (profile billing) → Zettaz Pay.
- Payment integrations tab is still a placeholder.

**Held (do not start)**
- Platform console (paused 22 Sep), Finance money in/out phases 2–4, Crew GPS, Track B items, subscription banners.
- Dependency-blocked: Stripe eligibility, XCD→USD rate, Rock printers, Rock waiver legal text, WP payload reconciliation.

---

## 6. Recommended sequence

1. Fix 1.1 → commit (today).
2. Section 2 correctness fixes on Period overview + arithmetic test (1–2 days) — before any owner visual sign-off, since numbers are currently not reconcilable.
3. Section 3 UX polish on the shared shell (1–2 days) — benefits every report.
4. Sales by product → Commission summary → Partner statement PDF (≈1–2 days each).
5. Channel mix, no-show report.
6. Accounting export, then P&L once FX/reporting-currency policy is decided.
