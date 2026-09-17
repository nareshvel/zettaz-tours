# Boarding balance collection and partner clearance

**Status:** Web manifest path implemented 11 September 2026. Soft passenger attribution for split boarding payments added 14 September 2026.  
**Scope authority:** [finance and offline](../../ARCHITECTURE/finance-and-offline.md), [tenant payments](../../ARCHITECTURE/tenant-payments.md), [passenger clearance](passenger-clearance-requirements.md).

## Outcome

Staff can confirm reservations with a partial or zero guest payment where policy allows, then clear remaining guest balances at boarding—or skip guest collection when partner settlement modes already cover financial clearance. When two or more travellers share a remaining balance, staff can record each boarding payment against a passenger for receipt clarity while the **booking** ledger and boarding gate stay booking-level.

## Implemented

- Confirm may proceed with less than full guest payment when tenant `minimumPaidPercent` is below 100, or when collection mode is `partner_invoice` or `partner_collects_for_tenant`.
- Booking source (`phone`, `walk_in`, `website`, `partner_reseller`) is channel attribution only. Settlement follows collection mode and ledger facts, not source slug.
- Partner / reseller source shows partner organization, reference, and collection arrangement inline; channel brands such as Viator and GetYourGuide are partner organizations, not separate booking sources.
- Boarding financial clearance (`boardingBalanceSettled`):
  - `partner_invoice` and `partner_collects_for_tenant` clear by policy without a new guest payment.
  - Otherwise guest paid + accepted partner collection credit must cover the quote total.
- Manifest shows guest balance amount when due (`Balance · {money}`), a **Pay** action that opens an on-manifest payment sheet, then advances to **Waiver** and **Board**.
- Soft split pay at boarding: optional `passengerId` on manual payments; Pay sheet opened from a passenger suggests an equal share of the remaining booking balance (last share absorbs rounding). Boarding still unlocks for the whole booking only when the booking balance is settled.
- Partner-settled arrivals that still need a signature show **Waiver** (not a generic continue).
- Booking create/confirm from a departure carries `returnTo` so confirm returns to that departure manifest.
- Reservation details can print / download a booking **receipt** PDF via `ops/v1/print-jobs` (`documentType: receipt`, `sourceType: booking`). The receipt uses a branded layout: tenant display name, business contact lines when configured, logo when a JPG/PNG tenant logo is uploaded, formatted departure time, guest/party/traveller details, charge lines, paid/balance totals, and payment rows (including passenger attribution).

## Scenario matrix

| Scenario | Behaviour |
| --- | --- |
| One payer settles full booking balance at boarding | Supported |
| 2+ guests each pay a share until balance = 0 | Supported (soft attribution + share default) |
| Guest A pays share, Guest B boards before B pays | Blocked for all until booking settled (by design) |
| Deposit/partial then remainder split at boarding | Supported |
| Partner invoice / partner collects | Clears without guest pay |
| Minor opens Pay | Attribution prefers an adult on the same roster when present |
| Void/reversal of attributed payment | Adjustment on original payment; attribution retained on the payment row |

## Pending (do not invent as complete)

- Complimentary and prepaid-as-policy booking flags that clear boarding without a quote total being paid.
- Authorized audited boarding exception (“board with reason” while balance remains).
- Mixed collection (partner portion + guest remainder) with explicit allocation rules.
- True per-passenger owed balances / board-when-own-share-paid.
- Crew mobile on-device Pay sheet (web manifest Pay exists). Phase 2 on production (`02dc7ea`); field pass in progress. See [crew-app-delivery.md](../../STRATEGY/crew-app-delivery.md).
- Public self-serve payment link from boarding.
- Import/WTE/website apply paths must set collection mode explicitly so channel source never silently implies settlement.
- Finance remittance for `partner_collects_for_tenant` still expects later collection claims; boarding clearance by policy does not replace claim recording.
