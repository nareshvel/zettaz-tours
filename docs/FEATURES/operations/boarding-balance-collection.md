# Boarding balance collection and partner clearance

**Status:** Web manifest path implemented 11 September 2026.  
**Scope authority:** [finance and offline](../../ARCHITECTURE/finance-and-offline.md), [tenant payments](../../ARCHITECTURE/tenant-payments.md), [passenger clearance](passenger-clearance-requirements.md).

## Outcome

Staff can confirm reservations with a partial or zero guest payment where policy allows, then clear remaining guest balances at boarding—or skip guest collection when partner settlement modes already cover financial clearance.

## Implemented

- Confirm may proceed with less than full guest payment when tenant `minimumPaidPercent` is below 100, or when collection mode is `partner_invoice` or `partner_collects_for_tenant`.
- Booking source (`phone`, `walk_in`, `website`, `partner_reseller`) is channel attribution only. Settlement follows collection mode and ledger facts, not source slug.
- Partner / reseller source shows partner organization, reference, and collection arrangement inline; channel brands such as Viator and GetYourGuide are partner organizations, not separate booking sources.
- Boarding financial clearance (`boardingBalanceSettled`):
  - `partner_invoice` and `partner_collects_for_tenant` clear by policy without a new guest payment.
  - Otherwise guest paid + accepted partner collection credit must cover the quote total.
- Manifest shows guest balance amount when due (`Balance · {money}`), a **Pay** action that opens an on-manifest payment sheet, then advances to **Waiver** and **Board**.
- Partner-settled arrivals that still need a signature show **Waiver** (not a generic continue).
- Booking create/confirm from a departure carries `returnTo` so confirm returns to that departure manifest.

## Pending (do not invent as complete)

- Complimentary and prepaid-as-policy booking flags that clear boarding without a quote total being paid.
- Authorized audited boarding exception (“board with reason” while balance remains).
- Mixed collection (partner portion + guest remainder) with explicit allocation rules.
- Crew mobile on-device Pay sheet (web manifest Pay exists; mobile still server-gates on clearance).
- Public self-serve payment link from boarding.
- Import/WTE/website apply paths must set collection mode explicitly so channel source never silently implies settlement.
- Finance remittance for `partner_collects_for_tenant` still expects later collection claims; boarding clearance by policy does not replace claim recording.
