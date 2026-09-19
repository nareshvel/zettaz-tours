# Finance money in / money out — later-stage task list

**Status:** Held — do not start until the owner reopens this document  
**Recorded:** 19 September 2026  
**Audience:** any IDE agent  
**Authority on conflict:** [launch-contract.md](launch-contract.md) · [tenant-payments.md](../ARCHITECTURE/tenant-payments.md) · [finance-and-offline.md](../ARCHITECTURE/finance-and-offline.md) · ADR [004](../DECISIONS/004-money.md) · ADR [016](../DECISIONS/016-rock-launch-operations.md)

This is the plan for a tenant **cash and bank picture**: money that actually moved, not only bills and partner balances. It is **not** current sprint work. Current Finance Overview already shows partner AR/AP, recorded expenses, and an **Unpaid expenses** tile that equals recorded amounts until vendor payment exists.

Do **not** invent a cashbook, fake paid amounts, an XCD rate table, Stripe Connect onboarding, or payroll. Do **not** treat “expense entered” as “bank decreased.”

Related live surfaces: Finance Overview / Partners / Expenses / Reports; booking ledger and manifest Pay; Crew Pay (Phase 2). Track B leftovers (accounting export, P&L, partner portal) stay Track B unless this list promotes a slice in writing.

---

## Why this exists

Complete operator banking needs four flows on one strip (same tenant calendar, reporting currency rules unchanged):

| Flow | Direction | Today | Later |
| --- | --- | --- | --- |
| Guests | In (and refunds out) | Booking ledger, Reports, manifest/Crew Pay | Period totals on Finance Overview |
| Partners remitting | In | Partner receipts / allocation on Partners | Overview “received from partners” for the period |
| Partners owed | Out | Partner payables + aging | Unchanged role; keep append-only |
| Vendors / expenses | Out | Bills recorded; unpaid = recorded | Expense **payments** (method, date, reference) so unpaid = recorded − paid |
| Bank / cash | Position | Missing | Optional registers **after** payments exist |

Stripe Connect Checkout, card-present, and FX conversion remain **blocked** on merchant evidence and an approved rate policy (launch contract). They are listed so they are not forgotten; they are not the first slice of this list.

---

## Invariants (every phase)

1. Integer minor units + ISO currency. Never last-write-wins on money.
2. Guest collection, partner remittance, expense payment, and SaaS subscription are **four domains**. Do not net them in one row.
3. Corrections are append-only reversals/supersedes, same as booking payments.
4. Unlike currencies do not settle each other without a recorded rate **on that fact**.
5. Unpaid expenses must not silently stay equal to recorded once payments exist.
6. No Rock-hard-coded banks, rates, or partner terms.
7. Feature-flag unfinished gateway work. Honest empty states, not placeholder business logic.

---

## Phase 0 — already on Overview (done 19 Sep; do not redo)

| ID | Item | Notes |
| --- | --- | --- |
| F0.1 | Period control | Button menu: This week / month / Last month / This year / Last year / Custom. Default **This year**. Tenant timezone. |
| F0.2 | Recorded expenses | Period sum of non-voided expenses in reporting currency (bank rate frozen on the expense). |
| F0.3 | Unpaid expenses | **Equals recorded** until F1. Copy must stay honest. |
| F0.4 | Partner AR / AP / overdue | Snapshot of open partner money (not the expense period filter). |

---

## Phase 1 — Expense payments (first reopen)

**Goal:** A recorded expense is a bill. A payment is a separate append-only fact. Overview Unpaid becomes recorded − paid for the selected period.

**Out of this phase:** bank accounts, guest strip, Stripe, payroll, accounting export.

### Plan

1. **Model**
   - New table (name TBD in migration): `expense_payments` (or `vendor_payments`) with tenant_id, expense_id, amount_minor, currency, paid_at (tenant-local date + timestamptz), method (`cash` / `bank_transfer` / `card` / `other`), reference, recorded_by, optional notes, voided_at + void_reason.
   - Partial payments allowed. Sum of active payments ≤ expense amount in the **same currency**. Cross-currency payment against a bill is blocked until rate policy exists.
   - Void payment like booking payment void: original row stays.
2. **API**
   - `POST/GET` under `finance/v1/expenses/:id/payments` with `payment.write` (confirm permission; do not invent a new grant unless Staff roles need a split).
   - List expenses includes `paid_minor`, `outstanding_minor`, `payment_status`: `unpaid` / `partial` / `paid` / `voided`.
   - Overview expense totals: recorded, paid, outstanding for `dateFrom`/`dateTo` (expense_date basis unless owner later chooses paid_at basis — default **expense_date** for recorded, **paid_at** for cash-out; document the choice in TESTING evidence).
3. **UI**
   - Expenses row: status chip + Pay action (FormDialog: amount defaulting to outstanding, method, date, reference).
   - Overview: Unpaid uses `outstanding_minor`; Recorded stays gross bills; optional third tile **Paid to vendors** (period, paid_at).
   - Empty/error/loading match current Finance polish.
4. **Tests**
   - Tenant isolation; overpay rejected; void restores outstanding; duplicate command id no-op; voided expense cannot accept new payment.
5. **Docs**
   - Evidence under `docs/TESTING/`. Feature note under `docs/FEATURES/` (finance). Update this file’s Phase 1 to done.

**Acceptance:** Enter a bill, pay part, Unpaid drops, Recorded unchanged, audit shows both facts. No bank account required.

---

## Phase 2 — Guest money on the Finance strip

**Goal:** Same period control shows **guest receipts** and **guest balances still due** (confirmed bookings, tenant reporting currency, no FX invention).

### Plan

1. Reuse `reports/v1/overview` commercial fields (`receivedMinor`, `guestBalanceMinor`, `bookedMinor`) or a thin `finance/v1/finance-overview` extension with the same date bounds as expenses.
2. Tiles: **Guest received** / **Guest outstanding**. Link to Reports and Reservations — do not duplicate the reservation table.
3. Refunds: show as reducing received only if the booking ledger already records them; do not invent a refund engine here.
4. Partner-cleared bookings must not appear as guest cash in.

**Acceptance:** Changing This year vs This month moves guest tiles in line with Reports. Partner invoice bookings do not inflate guest received.

---

## Phase 3 — Partner cash in on the strip

**Goal:** Overview shows **received from partners** in the period (receipts actually allocated) vs **still owed** (existing AP/AR snapshot).

### Plan

1. Period filter on **receipt/allocation date**, not on booking date (document clearly).
2. Tile: **Partner remittances received**. Keep existing Partners owe you / You owe partners as open position.
3. Do not auto-spread unidentified deposits (tenant-payments rule).

**Acceptance:** Recording a partner receipt in Partners increases the remittance tile and decreases open receivable without changing guest received.

---

## Phase 4 — Bank / cash registers (after 1–3)

**Goal:** Optional tenant cash and bank accounts so “money left the bank” is a transfer or payment posting, not a bill.

### Plan

1. Tenant-owned accounts: `cash_on_hand`, `bank` (label + currency). No live bank feed in Track A.
2. Every expense payment, guest cash, and partner remittance **must** name an account once accounts exist. Until then, method-only (Phase 1) is enough.
3. Transfers between accounts are append-only pairs. Opening balance is an explicit owner-entered fact, not inferred.
4. Register view: running balance, filters, no silent FX.

**Defer:** card settlement batches, Stripe payout mapping, multi-entity books.

---

## Phase 5 — Blocked / Track B (do not start from this list)

| ID | Item | Blocker |
| --- | --- | --- |
| F5.1 | Stripe Connect Checkout + webhooks | Merchant eligibility, Connect account, ADR 016 |
| F5.2 | Card-present / Terminal | Crew Phase 5 / Track B |
| F5.3 | XCD ↔ USD settlement of mixed balances | Approved rate source |
| F5.4 | P&L, CSV/accounting export, commission engine | Track B; Finance Reports stubs already say “Not in this launch” |
| F5.5 | Partner portal / automated settlement | Track B |
| F5.6 | Payroll (Salaries category is only an expense bucket) | Policy + employment facts |
| F5.7 | Tax authority remittance register | Tax rules beyond hold tax-on-new-quotes |

---

## Suggested reopen order

1. Phase 1 expense payments  
2. Phase 2 guest strip  
3. Phase 3 partner remittance tile  
4. Phase 4 cash/bank registers  
5. Phase 5 only when the matching blocker is closed in writing  

Owner reopens by naming a phase in [agent-current-sprint.md](../HANDOFF/agent-current-sprint.md). Until then, agents continue UI polish, Crew owner tasks, and other Track A epics — not this list.

---

## Current Overview mapping (do not regress)

- **Partners owe you / You owe partners / Overdue partners** — open partner position.  
- **Expenses · {period}** — recorded bills.  
- **Unpaid expenses · {period}** — outstanding bills (today: same as recorded).
