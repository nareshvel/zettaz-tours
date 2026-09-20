# Finance System — Master Plan

**Version:** 2.0  
**Date:** 16 September 2026  
**Status:** Approved for implementation  
**Supersedes:** `finance-slim/` folder, `finance-page-redesign-plan.md`, `finance-polish-evidence.md`  
**Reads alongside:** `ARCHITECTURE/finance-and-offline.md` (ledger rules, offline sync, payment correction rules)

---

## 1. Vision & Mental Model

Finance is not a partner-commission module. It is the **foundation of the business's accounting system**. Every section of the app that involves money — guest payments, partner commissions, collections, operating costs, salaries — feeds into this module. The architecture must support that from day one, even if not every section is fully built at launch.

### Design principles

**Entity-centric, not transaction-type-centric.**  
Organize around partners, categories, and accounts — not around which tab a transaction type lives in. A finance manager thinks "Partner X owes me money" not "let me check the collections tab and then the commissions tab."

**Work queue first.**  
Every morning, the question is: "What needs my attention today?" The Overview page answers that before anything else. Details live one click away.

**Plain language over accounting jargon.**  
"They owe you $4,560" not "Receivable — AR balance." Tooltips for field-level guidance, not inline essays.

**Running balance as truth.**  
A chronological ledger per partner, per category — the single register that tells the complete story without switching views or doing mental arithmetic.

**Foundation first, features later.**  
The URL structure, data model, and navigation must accommodate the full accounting vision even if many sections are stubs at launch. Restructuring navigation after tenants go live is expensive.

**Stable single base currency.**  
All amounts in the tenant's configured base currency. Multi-currency conversion is future scope and must not block launch.

---

## 2. Partner Payment Patterns

Four real-world patterns exist. All must be supported by the data model. The UI adapts per partner based on which pattern applies.

### Pattern A — OTA / Platform (partner collects, pays tenant net)
*Examples: Viator, GetYourGuide, Airbnb Experiences, Rezdy, FareHarbor marketplace*

- Passenger pays the **platform**, not the tenant.
- Platform deducts its commission, remits **net** to tenant on a schedule (monthly, bi-weekly).
- Tenant receives a remittance statement; may or may not issue a formal invoice.
- Money owed **to** tenant = gross booking value × (1 − partner rate).
- Finance workflow: Record expected payout → receive remittance → reconcile → flag discrepancies.

### Pattern B — Referral / Agency (tenant collects, pays partner commission)
*Examples: hotel concierge, dive shop, local travel agency, affiliate*

- Passenger pays **tenant** normally (card, cash, link).
- Tenant owes partner a referral fee: percentage or flat amount per booking.
- Settlement: tenant generates statement → issues payment or receives commission invoice.
- Money owed **to** partner = booking value × commission rate (or flat fee).
- Finance workflow: Commission accrues per booking → settlement period → pay partner.

### Pattern C — Wholesale / Net-Rate (partner pays tenant net, marks up to passenger)
*Examples: wholesale tour operator, DMC, corporate travel desk*

- Partner buys seats at a negotiated net price; marks up to their passenger.
- Tenant invoices partner. The passenger is the partner's customer.
- Money owed **by** partner = contracted net rate × pax count.

### Pattern D — Flat-Fee (either direction)
- Fixed amount per booking or per pax, regardless of tour value.
- Can combine with Patterns A, B, or C.
- Example: "$5 per passenger booking fee owed to agency."

### Commission direction (the key field)
```
commission_direction:
  "partner_owes_tenant"  → Patterns A (OTA settlement) and C (wholesale invoice)
  "tenant_owes_partner"  → Pattern B (referral/agency commission)
```
This single field drives the entire accounting treatment.

---

## 3. Full Finance Navigation Structure

```
/finance                    → redirect to /finance/overview

/finance/overview           → Work queue + net position + recent activity
/finance/partners           → Partner account center (list)
/finance/partners/:id       → Individual partner account ledger
/finance/expenses           → Operating expense ledger
```

**Sidebar nav label:** Finance  
**Sub-items:** Overview · Partners · Expenses

Aging and expense summary live under **Insights → Reports**. `/finance/reports` redirects to `/reports`.

---

## 4. Page Designs

### 4.1 Finance Overview (`/finance/overview`)

**Default landing page.** Finance managers open this every morning.

**Section A — Work queue (top, most prominent)**  
Shows only items requiring action, sorted: overdue → due soon → pending review.  
Each card: partner name / expense category · what's needed · amount · days outstanding · one-click to destination.

```
🔴  Caribbean Charters       Settlement overdue — 41 days           $3,200
🟡  Island Tours Ltd          Invoice sent — awaiting payment         $1,850  (due in 4 days)
⚪  Blue Horizon Travel       3 collection claims awaiting review       $960
⚪  Blue Horizon Travel       8 bookings ready to settle             $2,100
```

Empty state: "All caught up — no actions required."

**Section B — Net financial position**  
Three plain-language numbers:
- Partners owe you: $X (receivable, N partners)
- You owe partners: $X (payable, N partners)  
- Overdue: $X (N settlements — shown in amber/red if > 0)

**Section C — Recent activity feed**  
Last 10 transactions across all partners. Date · partner · event · amount. Gives owners/accountants confidence the system is current.

---

### 4.2 Partner Accounts (`/finance/partners` and `/finance/partners/:id`)

**Partner list page**

Each row:
- Partner name + payment model badge (OTA / Reseller / Wholesale / Affiliate)
- Current balance in plain English: "They owe you $4,560" / "You owe them $1,200" / "Settled"
- Status indicator: clean · pending action · overdue
- Commission structure summary: "20% — net payout" / "15% referral fee"
- Last activity date

**Per-partner account view** (the core of the design)

*Account summary strip*  
Partner name · model · commission terms · settlement schedule · payment terms · base currency · last settled date.

*Pending action panel (contextual — only shows what applies)*
| State | Action shown |
|---|---|
| Unverified collection claims | "Review N claims" |
| Unsettled bookings | "Generate settlement for N bookings" |
| Settlement in draft | "Issue invoice" |
| Invoice sent | "Record payment received" / "Record payout received" (OTA) |
| Overdue | "Settlement overdue — take action" |
| Nothing pending | "Account is current ✓" |

*Transaction register (chronological ledger)*  
Every financial event for this partner in one list. Columns: Date · Description · They owe you (Dr) · You owe them (Cr) · Running balance.

```
Sep 01   Collection claim C-045 (verified)                  +$1,200          $1,200
Sep 08   Collection claim C-051 (verified)                    +$850          $2,050
Sep 12   Commission — Booking TRS-089 (referral)                       −$240  $1,810
Sep 15   Settlement Sep 1–14, 2026 (draft → invoiced, #INV-041)               $1,810
Sep 28   Payment received — INV-041                                  −$1,810      $0
```

Filter bar (minimal): All · Claims · Settlements · Payments · Date range

*Settlement history (below register or collapsible)*  
Each settlement card shows: period · status stepper (draft → invoiced → sent → paid) · amount · invoice number · due date · payment ref · contextual action buttons.

---

### 4.3 Expenses (`/finance/expenses`)

**Purpose:** Operating cost ledger — the foundation for non-partner financial tracking.

**Expense list**  
Filterable by: category · date range · amount range.  
Sortable by: date (default) · amount · category.  
Totals by category shown at top.

**Add expense form**  
- Date (required)
- Amount (required)
- Category (dropdown — configurable in Settings → Finance)
- Vendor / Payee (free text)
- Description / Notes
- Reference number (invoice, receipt #)
- Receipt upload (stub — UI present, backend deferred to Track B)

**Expense categories (default set — tenant-configurable)**  
Fuel & Transport · Equipment & Machinery · Maintenance & Repairs ·  
Office & Administration · Software & Licenses · Marketing & Advertising ·  
Insurance · Professional Services · Salaries & Wages *(stub — PayTime integration Track B)* · Other

**Why build this now:**  
- Creates the expense ledger that feeds future P&L reports
- PayTime salary expenses will auto-flow into "Salaries & Wages" with no structural changes
- Correct category → account mapping from day one prevents data migration pain later

---

### 4.4 Reports (Insights → `/reports`)

Partner aging and expense summary are catalog entries on the Reports hub, not a Finance tab. Overview links to those reports. P&L, partner PDF, and commission summary remain later.

---

## 5. What Already Exists (Do Not Rebuild)

### APIs already implemented
```
GET    /finance/v1/partner-claims                               list all claims
POST   /finance/v1/partner-claims/:id/decision                 accept / reject claim
GET    /finance/v1/partner-statements                           obligation ledger lines
GET    /finance/v1/partner-finance-summary                      summary (receivable, payable, overdue)
GET    /finance/v1/partners/:id/bookings/unsettled              unsettled bookings per partner
GET    /finance/v1/partners/:id/settlements                     settlement history
POST   /finance/v1/partners/:id/settlements                     generate settlement
PATCH  /finance/v1/partners/:id/settlements/:sid               advance settlement status
```

### Permissions already defined
- `partner.manage` — create/update partners, generate/advance settlements
- `partner.collection.record` — record a collection claim
- `partner.collection.verify` — accept/reject a claim (finance/owner only)
- `partner.statement.read` — read statement lines
- `payment.correct` — void / reverse a payment (finance/owner only)

### Collection modes on bookings (immutable after confirmation)
- `guest_pays_tenant` — partner is attribution only; no obligation created
- `partner_collects_for_tenant` — accepted claim creates obligation, may credit guest balance
- `partner_invoice` — obligation created at confirmation; no guest payment inferred

### Key invariants (never break)
- Partner claims are not payment rows — acceptance never creates booking revenue
- Accepted claims are append-only with reason; decisions are immutable
- Commission snapshot is frozen at booking attribution time — rate changes don't affect past bookings
- Payment corrections (void/reversal) are append-only; original records are never deleted

---

## 6. New APIs Needed

### Settings — Expense categories
```
GET    /staff/v1/finance/expense-categories     list tenant categories
POST   /staff/v1/finance/expense-categories     create category
PUT    /staff/v1/finance/expense-categories/:id update
DELETE /staff/v1/finance/expense-categories/:id archive
```

### Expenses
```
GET    /staff/v1/finance/expenses               list expenses (filter: category, date, amount)
POST   /staff/v1/finance/expenses               record expense
GET    /staff/v1/finance/expenses/:id           get expense
PUT    /staff/v1/finance/expenses/:id           update expense
DELETE /staff/v1/finance/expenses/:id           void expense (soft delete + audit)
```

### Finance overview
```
GET    /staff/v1/finance/overview               work queue + net position + recent activity
GET    /staff/v1/finance/aging                  partner aging report
```

### Partner detail (needed for per-partner ledger view)
```
GET    /staff/v1/partners/:id                   partner detail (includes commission config)
GET    /staff/v1/partners/:id/ledger            full transaction register (paginated)
```

---

## 7. Database Tables Needed

### `expense_categories` (new)
```sql
CREATE TABLE expense_categories (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name        text NOT NULL,
  code        text,                    -- e.g. "FUEL", "MAINT" — for future accounting export
  sort_order  int NOT NULL DEFAULT 0,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON expense_categories(tenant_id, is_active);
```

### `expenses` (new)
```sql
CREATE TABLE expenses (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  category_id     uuid NOT NULL REFERENCES expense_categories(id),
  amount_minor    bigint NOT NULL,           -- integer minor units, base currency
  currency        char(3) NOT NULL,
  expense_date    date NOT NULL,
  vendor          text,
  description     text,
  reference       text,                      -- invoice #, receipt #
  receipt_path    text,                      -- document library path (stub)
  recorded_by     uuid NOT NULL,             -- staff user id
  voided_at       timestamptz,
  void_reason     text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON expenses(tenant_id, expense_date DESC);
CREATE INDEX ON expenses(tenant_id, category_id);
```

---

## 8. Settings Changes

### Settings → Partners (move from Finance tab)
The Partners management (add/edit partner organizations, commission terms, settlement schedule) belongs in **Settings → Partners**, not buried in the Finance module. Finance shows the financial activity *against* those partners; Settings is where you configure the relationship.

Relevant settings per partner:
- Name, type (OTA / Reseller / Wholesale / Affiliate)
- Commission: type (% / flat per booking / flat per pax / net rate) · rate or amount · direction
- Settlement schedule (monthly / bi-weekly / per booking / manual)
- Settlement day (for monthly)
- Payment terms (net-30, net-60, custom)
- Requires formal invoice toggle
- Contract reference + notes
- Active / Archived status

### Settings → Finance (new section)
- Base currency (read-only — set at tenant onboarding)
- Expense categories (CRUD — default set pre-populated on tenant creation)
- *(Future: chart of accounts, accounting export format)*

---

## 9. Implementation Task List

**Status 19 September 2026:** Phases 0–3 and 5 (aging + remaining stubs) are live. Phase 4 Settings → Partners is wired. Collection claim UI is on the partner account. Expense category manager is on Expenses. Expense Summary is a live report. Expense **payments** are [money-in-out Phase 1](../../STRATEGY/finance-money-in-out-later.md). Accounting export remains specified in [accounting-export.md](accounting-export.md) — CSV/QBO API not built.

### Phase 0 — Foundation (routing & navigation)
- [x] Add Finance sub-navigation: Overview · Partners · Expenses
- [x] Wire routes in `workspace.tsx`
- [x] Redirect bare `/finance` to overview (unknown segment defaults to overview)
- [x] Page shells for each section

### Phase 1 — Finance Overview page
- [x] API work queue, net position, recent activity
- [x] UI work queue, net position, activity, empty state

### Phase 2 — Partner Accounts
- [x] Partner list, ledger, settlements
- [x] Collection claim record / accept / reject on the partner account

### Phase 3 — Expenses
- [x] Categories + expenses + vendors
- [x] Category manager UI (config.write)
- [x] Expense payments (vendor cash-out)

### Phase 4 — Settings → Partners
- [x] Settings tab Partners (commission terms); Finance remains the ledger

### Phase 5 — Reports
- [x] Partner aging and expense summary on Insights → Reports (`/reports/:slug`)
- [ ] P&L, partner statement PDF/CSV, commission summary — Track B / [accounting-export.md](accounting-export.md)


---

## 10. Track A vs Track B (launch boundary)

### Track A — Build for launch
Everything in Phase 0 through Phase 5 above.

### Track B — Deferred (design for, don't build)
| Feature | Why deferred |
|---|---|
| Receipt / document uploads | Document library storage backend not yet scoped |
| Multi-currency conversion | Currency source and FX rules not confirmed |
| PDF invoice generation | Document generation infrastructure (Comms epic) |
| Automated email delivery | SMTP/template system (Comms epic) |
| PayTime salary integration | PayTime module not yet at integration readiness |
| Automated OTA payout reconciliation | Requires OTA webhook payloads (Viator, GYG APIs) |
| Accounting export (QuickBooks/Xero format) | Track B contract item |
| Overdue reminders / dunning | Comms epic dependency |
| Partner portal login | Track B contract item |
| P&L / full reporting | Requires complete booking revenue feed |
| Double-entry ledger (debit/credit both sides) | Single-entry running balance sufficient for Track A |

---

## 11. Open Decisions (resolve before implementation of each phase)

| # | Question | Phase | Owner |
|---|---|---|---|
| 1 | For OTA partners: does tenant want to track **gross** (what passenger paid platform) or just the **net** received? | Phase 2 | Owner |
| 2 | Should "per booking" settlement trigger on booking confirmation or on departure completion? | Phase 2 | Owner |
| 3 | Do expense categories need to be **tenant-configurable at launch** or can we ship a fixed default list and make it configurable in Phase 2? | Phase 3 | Owner |
| 4 | When a settlement goes overdue, should the work queue show it after N days, or immediately on due date? | Phase 1 | Owner |
| 5 | Should the Finance Overview be visible to all finance-role users, or only owner + admin? | Phase 0 | Owner |

---

## 12. File Map — What Goes Where

| Path | Purpose |
|---|---|
| `apps/web/components/finance-overview.tsx` | Finance Overview page (new) |
| `apps/web/components/finance-partners.tsx` | Partner account center (redesign) |
| `apps/web/components/finance-expenses.tsx` | Expenses ledger (new) |
| `apps/web/components/finance-reports.tsx` | Aging + expense summary bodies used by Insights → Reports |
| `apps/web/components/finance.tsx` | Page shell — nav + section routing |
| `apps/web/app/globals.css` | All finance CSS (existing + new sections) |
| `apps/web/components/workspace.tsx` | Route wiring — all /finance/* paths |
| `docs/FEATURES/finance/PLAN.md` | This document |
| `docs/ARCHITECTURE/finance-and-offline.md` | Ledger rules, offline sync, payment corrections (keep, do not change) |
