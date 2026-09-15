# Waiver template lifecycle

**Settings → Operations → Waiver templates** (moved out of the Platform group 15 September 2026).

## Editing publishes a version

Waiver content is immutable at the database level — migration 012 installs a trigger rejecting any change to `title` or `body` — and `waiver_signatures` carries a foreign key to the exact template row. A signature only means something alongside the words the guest agreed to.

So **Edit** opens the current wording pre-filled and publishes it as the next version, which supersedes the old one for future signatures and leaves captured evidence untouched. The same action on a superseded version is labelled **Reuse**.

## Deleting

`DELETE /ops/v1/waiver-templates/{id}` (`waiver.template.publish`, idempotency-keyed, audited). Two refusals, enforced in the API rather than hidden in the UI:

- **The active version can never be deleted.** Staff would be left with nothing to have guests sign; the fix for bad wording is to publish a replacement.
- **A version with signatures against it can never be deleted.** It is evidence. The error names the count.

That leaves one deletable case: a version replaced before anyone signed it. Only there does the UI offer a bin, behind a danger confirm.

## Reading

`GET /ops/v1/waiver-templates` returns the **active** template only — every signing surface must be offered the wording in force, never a superseded one. `?history=1` adds past versions with `signature_count`, for this settings screen alone.
