# Waiver capture and check-in foundation

## Scope

The first connected workflow supports tenant-owned, versioned waiver templates and explicit staff-recorded signature evidence for a confirmed booking. Each evidence record binds to the exact template version, booking, signer name, signer capacity, staff actor, and server timestamp. It is append-only.

## Safety boundaries

- Mock text is not legal content and cannot be used in production.
- A typed name or staff attestation is captured as evidence only; legal sufficiency, e-sign consent wording, retention, jurisdiction, and guardian age rules remain tenant/legal decisions.
- No cleared-to-board action, boarding, payment collection, QR, public customer link, offline cache, or notification is introduced until its policy and finance dependencies exist.
- A booking state remains commercial; it never becomes a waiver or boarding state.

## Acceptance

- Templates are tenant-scoped and immutable after activation; a replacement creates a new version.
- Signature evidence is tenant-scoped, idempotent, audited, and cannot be updated or deleted.
- Another tenant cannot read or write templates or evidence.
- The staff view exposes the current waiver state without exposing unnecessary contact data.
