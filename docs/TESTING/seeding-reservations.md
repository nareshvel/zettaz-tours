# Seeding a month of reservations

`apps/api/scripts/seed-reservations.ts` fills an existing tenant with a month of
realistic reservations: parties, rosters, payments, partner attribution and the
holds and cancellations that make a real book of business look like one.

```bash
# local
npm run db:seed:reservations -- --tenant=<uuid|slug>

# production (run it on the VPS, or with .env.production pointing at the live DB)
npm run db:seed:reservations:prod -- --tenant=<uuid|slug> --yes
```

Known tenants:

| Tenant | ID |
| --- | --- |
| Rock Adventures (local) | `214d9a81-ca29-4793-b2ba-5efd65ab97c2` |
| Zettaz DemoTours (production) | `f6e566ce-bb5c-4cc7-b801-8992268981d1` |

`--tenant` also accepts the slug, which is safer to type than a UUID.

## What it will not do

It does not create or change a catalogue. It books into departures that already
exist, are open, are in the future and still have seats. A tenant with no such
departures gets an error naming the window it searched, not an invented
schedule. Extend the schedule or availability rule first.

It does not write rows into `bookings`. A reservation in this system spans
holds, seat commitment, price snapshots, passenger rosters, partner
attributions and obligations, payments, audit and outbox. The script calls the
same services the HTTP controllers call, with a real staff actor drawn from the
tenant's active owner or manager, so every invariant, audit row and outbox event
exists exactly as it would had staff typed the booking in. Seeded data is
therefore safe to amend, cancel, check in, print and settle.

## Re-running

Every command carries a deterministic idempotency key derived from `--batch`
(default `seed-<today>`). Re-running the same batch replays the stored responses
and creates nothing new, so an interrupted run can simply be repeated. To add a
second wave of demand, pass a new label: `--batch=wave-2`.

`--batch` also seeds the random number generator, so a given label always
produces the same month — the same guests, the same parties, the same money.

## Options

| Flag | Default | Meaning |
| --- | --- | --- |
| `--tenant` | required | Tenant UUID or slug. Never guessed. |
| `--days` | `30` | How far ahead to book, in tenant-local days. |
| `--fill` | `0.55` | Target load factor before weighting. |
| `--batch` | `seed-<today>` | Idempotency and RNG namespace. |
| `--dry-run` | off | Report the tenant, window and catalogue, write nothing. |
| `--yes` | off | Required when `DATABASE_URL` is not localhost. |

Always start with `--dry-run` against production. It prints how many departures
and free seats it found, which is also the fastest way to confirm you are
pointed at the tenant you think you are.

## The shape of the data

Load is weighted, not uniform: near dates fill better than far ones, weekends
better than midweek, and party sizes follow a couples-heavy distribution with
occasional families and small groups.

Bookings are backdated. The services stamp `created_at` as now — correct for
real traffic, useless for seeded history, because every booking pace and demand
chart would read as one spike today. Each booking is moved back to the moment
its payment says it was taken, weighted towards the last few days before travel.

Collection follows each partner's commercial shape rather than a flat rule:

| Partner type | Collection mode | Consequence |
| --- | --- | --- |
| OTA | `partner_collects_for_tenant` | Guest already paid the OTA; no payment row, settles later. |
| Reseller | `partner_invoice` | Raises a partner obligation on confirmation. |
| Affiliate | `guest_pays_tenant` | Guest pays us; the partner is owed a flat fee. |
| Direct | `guest_pays_tenant` | Card, cash, transfer or online. |

Confirmed partner bookings are also linked with `PartnerService.linkBooking`, so
commission is computed against the partner's current terms and the settlement
screens have something to settle.

Roughly a quarter of reservations stay **held** — some awaiting a balance, some
with a deposit only, a few with a pending payment. That queue is the point: it
is what the Overview briefing and the morning desk workflow are built around.
Around one in twenty confirmed bookings is then cancelled with a reason.

Names are invented. Every email address is on the reserved `.invalid` TLD and
no phone number routes anywhere. Stays reference the shared vessel and property
catalogues; pickups reference the tenant's own pickup locations where they
exist. Some seats are deliberately left with an unnamed traveller
(`identityPending`), because a booking taken by phone has seats now and names
later — that is a real state, and the roster carries it explicitly.

## Before running against production

1. Take a backup.
2. Run with `--dry-run` first and read the departure count.
3. Confirm the tenant ID is the demo tenant, not a paying operator.
4. Seeded payments are real `payments` rows. They are append-only by trigger and
   cannot be deleted — only voided or reversed through the adjustment API. Do not
   seed a tenant whose finance reports anyone relies on.
