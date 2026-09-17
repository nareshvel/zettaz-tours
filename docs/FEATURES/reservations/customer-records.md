# Customer records and history

## Purpose

Give reservation staff one tenant-scoped customer view without confusing a reusable customer identity with the immutable facts of a particular booking.

## Implemented boundary

- A customer is created or reused by normalized email within one tenant. The original display name, email and latest non-empty phone remain searchable.
- Every booking retains its own lead-traveler, purchaser and optional emergency-contact snapshots. Updating the reusable customer record cannot rewrite those historical facts.
- The purchaser defaults to the lead traveler but can be recorded as another person. Emergency contact requires name, phone and relationship when supplied.
- Passengers remain separate roster records. Hotel/cruise stay and pickup disposition remain booking facts.
- The customer list searches name, email or phone and highlights the number of linked bookings. Repeated email addresses resolve to one record (repeat-guest cue). Same name or phone with a different email remains a separate record.
- Customer detail shows the shared guest email/phone, linked bookings, and a timeline of travel dates, payments, waivers, customer-message requests, amendments and cancellations. Purchaser and emergency-contact snapshots stay on reservation detail, not on this shared identity.
- `bookings.read` is enforced by the API. Tenant row-level security and composite foreign keys prevent cross-tenant links or reads.

## Deferred decisions

Manual merge/split, alternate email addresses, customer consent/preferences, retention/anonymization and incident history require tenant privacy and retention policy. They must not be inferred from duplicate names or phone numbers.

## Acceptance evidence

- Existing persistent bookings are backfilled without changing their lead-traveler snapshot.
- Two bookings in one tenant with case-variant versions of the same email link to one customer.
- A matching email in another tenant remains a separate customer and cannot be read across the tenant boundary.
- Purchaser and emergency contact remain visible on reservation detail; the Insights customer page does not dump those snapshots.
