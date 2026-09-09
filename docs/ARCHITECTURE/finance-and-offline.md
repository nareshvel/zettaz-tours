# Finance and offline sync

**Version 2.0 · 5 September 2026**

Index: [README.md](../README.md) · Money ADR: [004-money.md](../DECISIONS/004-money.md) · Sync ADR: [007-offline-sync.md](../DECISIONS/007-offline-sync.md)

## Ledger rules

- Multiple payment intents/transactions per booking: deposit, installment, balance, add-on, adjustment, refund, chargeback.
- Amounts are integer minor units plus ISO currency.
- Capture booking currency, collection currency, and reporting currency with a recorded `ExchangeRate`.
- Gateway adapter model. Never store raw card data.
- Methods: cash, card terminal, payment link, bank transfer, voucher, invoice, complimentary.
- Balance collection task has a responsible role and a due event.
- A successful check-in payment updates the ledger and booking balance atomically. Failed or pending payments do not mark the balance settled.
- Partner-invoiced, prepaid, and complimentary bookings satisfy financial clearance by policy without a new payment.

Launch gateway, card-present path, and which currency fills which role are open decisions in [launch-contract.md](../STRATEGY/launch-contract.md). The data model must support Stripe in eligible markets and Caribbean processors (for example Powertranz or a bank gateway) without changing booking logic.

## Track A vs Track B finance

For the proposed tenant-facing handling of external hotel/reseller collections, guest clearance, partner obligations and remittance allocation, see [tenant-payments.md](tenant-payments.md). Guest payment evidence is distinct from receipt of partner funds. Detailed accounting/evidence policies remain under review; full commission and automated settlement scope remains deferred.

| Capability | Track A | Track B |
| --- | --- | --- |
| Snapshot totals, payments, refunds, balances | Yes | — |
| Check-in collection + receipt | Yes | — |
| Partner invoice flag and statement lines | Yes | — |
| Commission accrual on confirm / departure / completion / payment | No | Yes — one trigger per contract, frozen after trip complete |
| Credit notes, aging, dispute workflow | Minimal notes | Yes |
| Accounting export | CSV/basic | Mapped to the tenant’s accounting system |

A completed trip cannot silently change partner commission. Adjustments need an approval trail.

## Check-in money

The check-in screen shows amount due, currency, collector, accepted methods, and whether the booking is prepaid, partner-invoiced, complimentary, or guest-collect.

Staff may collect remaining balance with an approved card terminal, payment link, cash, or another tenant-enabled method and issue a receipt immediately.

Offline check-in can capture payment method/reference and evidence locally. Card authorization still requires a supported connection unless an approved offline-terminal process exists.

## Offline conflict matrix

| Record | Offline behavior | Conflict rule |
| --- | --- | --- |
| Assignment, catalog, departure times | Download only | Server authoritative. Device refreshes; local edits to assignments are rejected. |
| Check-in / passenger status | Append commands | Same passenger + same target status + same client command id = one fact. Two different statuses: server applies in client-timestamp order, last **valid** transition wins, both events retained. |
| Waiver signature | Append evidence | Duplicate client id is ignored. Two signatures for one guest: keep both evidence rows; one is current version. Never drop the first silently. |
| Payment / cash | Append ledger line | **Never last-write-wins.** Duplicate `client_command_id` is a no-op. Two different cash amounts are two lines or a quarantined conflict for finance — not an overwrite. |
| Trip-run status | Append events | Server orders by occurred_at / client timestamp; illegal transitions rejected. |
| Photos / media | Eventually consistent | Event syncs first; media retries. Missing media does not roll back the event. |
| Balance display | Cached, read-only | Authoritative balance is server. After sync, device replaces cache. Staff must not “edit balance.” |

Sensitive cached data is encrypted, expires after the assignment window, and is remotely revocable. Crew see only necessary passenger and contact fields.

## Device rules

- Local commands: device-generated IDs and monotonic client timestamps.
- Server returns accepted, rejected, or conflict with a reason.
- Visible offline / queued / synced state on every mutating screen.
- Accidental completion or cancellation of a trip-run is two-step confirmed.
