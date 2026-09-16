// Seeds a month of realistic reservations into an existing tenant.
//
// Why this drives the domain services rather than writing rows: bookings are
// not one table. A reservation touches holds, seat commitment, price snapshots,
// passenger rosters, partner attribution and obligations, payments, audit and
// outbox. INSERTing bookings directly produces a database that renders in the
// UI and then fails every invariant the app relies on. This script therefore
// calls the same services the HTTP controllers call, with a real staff actor,
// so the seeded data is indistinguishable from data staff entered by hand.
//
// Re-running is safe. Every command carries a deterministic idempotency key
// derived from --batch, so a second run returns the first run's responses
// instead of creating a second month of reservations. Use a new --batch label
// when you actually want more data.
//
// Nothing about a tenant's catalogue is created or modified. The script books
// into departures that already exist; if a tenant has no open future
// departures it says so and exits rather than inventing a schedule.
//
//   npm run db:seed:reservations -- --tenant=<uuid|slug>
//   npm run db:seed:reservations:prod -- --tenant=<uuid|slug> --yes
//
// See docs/TESTING/seeding-reservations.md.

import { NestFactory } from "@nestjs/core";
import { Pool } from "pg";
import { createHash } from "node:crypto";
import { DateTime } from "luxon";
import { AppModule } from "../src/app";
import { InventoryService } from "../src/inventory";
import { ReservationService } from "../src/reservations";
import { PassengerService } from "../src/passengers";
import { PartnerService } from "../src/partners";
import { BookingChangeService } from "../src/booking-changes";
import { grants, type Actor } from "../../../packages/shared/src/contracts";

// ── Arguments ───────────────────────────────────────────────────────────────

type Options = {
  tenant: string;
  days: number;
  fill: number;
  batch: string;
  dryRun: boolean;
  confirmed: boolean;
};

function options(): Options {
  const flags = new Map<string, string>();
  for (const arg of process.argv.slice(2)) {
    const match = /^--([a-z-]+)(?:=(.*))?$/.exec(arg);
    if (!match) throw new Error(`Unrecognised argument: ${arg}`);
    flags.set(match[1]!, match[2] ?? "true");
  }
  const tenant = flags.get("tenant");
  if (!tenant)
    throw new Error(
      "--tenant=<uuid|slug> is required. The script never guesses which tenant to write to.",
    );
  const days = Number(flags.get("days") ?? 30);
  const fill = Number(flags.get("fill") ?? 0.55);
  if (!Number.isInteger(days) || days < 1 || days > 180)
    throw new Error("--days must be a whole number between 1 and 180");
  if (!(fill > 0 && fill <= 1))
    throw new Error("--fill must be between 0 and 1 (0.55 = 55% of seats)");
  return {
    tenant,
    days,
    fill,
    batch: flags.get("batch") ?? `seed-${DateTime.utc().toISODate()}`,
    dryRun: flags.get("dry-run") === "true",
    confirmed: flags.get("yes") === "true",
  };
}

// ── Deterministic randomness ────────────────────────────────────────────────
// Seeded from --batch so a given batch label always produces the same month.

function rng(seed: string) {
  let state = createHash("sha256").update(seed).digest().readUInt32BE(0) || 1;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (min: number, max: number) =>
      min + Math.floor(next() * (max - min + 1)),
    pick: <T>(items: readonly T[]) => items[Math.floor(next() * items.length)],
    chance: (probability: number) => next() < probability,
    weighted: <T>(items: readonly (readonly [T, number])[]) => {
      const total = items.reduce((sum, [, weight]) => sum + weight, 0);
      let roll = next() * total;
      for (const [value, weight] of items) {
        roll -= weight;
        if (roll <= 0) return value;
      }
      return items[items.length - 1]![0];
    },
  };
}
type Rng = ReturnType<typeof rng>;

// ── Name pool ───────────────────────────────────────────────────────────────
// Invented people. The mix reflects a Caribbean excursion operator's book:
// North American and European cruise and hotel guests alongside local and
// regional names. No real person, and no address or phone that could route
// anywhere: every email is on the reserved .invalid TLD.

const firstNames = [
  "Amelia",
  "Marcus",
  "Priya",
  "Daniel",
  "Chantal",
  "Gregory",
  "Yvette",
  "Thomas",
  "Renée",
  "Samuel",
  "Imani",
  "Hendrik",
  "Lucía",
  "Andrew",
  "Keisha",
  "Jonathan",
  "Margit",
  "Devon",
  "Claudia",
  "Patrick",
  "Naomi",
  "Stefan",
  "Adaeze",
  "Colin",
  "Beatriz",
  "Rowan",
  "Helena",
  "Terrence",
  "Sofia",
  "Malcolm",
  "Anneke",
  "Julien",
  "Shanice",
  "Peter",
  "Ines",
  "Kwame",
  "Bridget",
  "Alessandro",
  "Fiona",
  "Desmond",
  "Mei",
  "Harold",
  "Camille",
  "Isaac",
  "Larissa",
  "Owen",
  "Tanya",
  "Nikolai",
  "Grace",
  "Ruben",
];
const lastNames = [
  "Whitfield",
  "Joseph",
  "Okonkwo",
  "Barnes",
  "Delacroix",
  "Hughes",
  "Martel",
  "Brathwaite",
  "Van Dijk",
  "Castellanos",
  "Fitzgerald",
  "Nakamura",
  "Simmons",
  "Roussel",
  "Abernathy",
  "Prasad",
  "Lindqvist",
  "Charles",
  "Donovan",
  "Meyerhoff",
  "Antoine",
  "Kowalski",
  "Osei",
  "Ferreira",
  "Lockhart",
  "Beaumont",
  "Sandiford",
  "Iversen",
  "Mwangi",
  "Callahan",
  "Rosetti",
  "Edwards",
  "Thistlewood",
  "Aguilar",
  "Bergström",
  "Quintana",
  "Hollis",
  "Pemberton",
  "Naidoo",
  "Gallagher",
  "Sørensen",
  "Mahabir",
  "Ashworth",
];

function person(random: Rng) {
  const first = random.pick(firstNames);
  const last = random.pick(lastNames);
  const handle = `${first}.${last}`
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z.]/g, "");
  return { name: `${first} ${last}`, email: `${handle}@example.invalid`, last };
}

const relationships = ["Spouse", "Parent", "Sibling", "Partner", "Friend"];

// ── Catalogue snapshot ──────────────────────────────────────────────────────

type Category = { slug: string; countsTowardCapacity: boolean };
type Departure = {
  id: string;
  productId: string;
  productName: string;
  startsAt: Date;
  localDate: string;
  capacity: number;
  free: number;
  categories: Category[];
};
type Partner = {
  id: string;
  name: string;
  type: string | null;
  direction: string;
};

function connect() {
  const url = process.env.ADMIN_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error("ADMIN_DATABASE_URL or DATABASE_URL is required");
  return {
    pool: new Pool({ connectionString: url }),
    usesAdmin: Boolean(process.env.ADMIN_DATABASE_URL),
  };
}

function isLocal(url: string) {
  return /@(127\.0\.0\.1|localhost|\[::1\])[:/]/.test(url);
}

async function main() {
  const opts = options();
  const databaseUrl = process.env.DATABASE_URL ?? "";
  if (!isLocal(databaseUrl) && !opts.confirmed)
    throw new Error(
      `DATABASE_URL does not point at localhost. This looks like a shared or production database.\n` +
        `Re-run with --yes if that is what you intend, and take a backup first.`,
    );
  process.env.APP_MODE ??= "production";

  const { pool, usesAdmin } = connect();
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ["error", "warn"],
  });
  try {
    // ── Tenant, actor, configuration ────────────────────────────────────────
    const {
      rows: [tenant],
    } = await pool.query(
      `SELECT id,slug,name,timezone,config FROM tenants WHERE id::text=$1 OR slug=$1`,
      [opts.tenant],
    );
    if (!tenant)
      throw new Error(
        `No tenant matches "${opts.tenant}" (looked up by id and by slug)`,
      );
    if (!usesAdmin)
      await pool.query("SELECT set_config('app.tenant',$1,false)", [tenant.id]);

    const {
      rows: [member],
    } = await pool.query(
      `SELECT actor_id,role FROM memberships
       WHERE tenant_id=$1 AND active AND role IN ('owner','manager')
       ORDER BY CASE role WHEN 'owner' THEN 0 ELSE 1 END LIMIT 1`,
      [tenant.id],
    );
    if (!member)
      throw new Error(
        "The tenant has no active owner or manager. Seeded reservations must be attributable to a real staff member.",
      );
    const actor: Actor = {
      actorId: member.actor_id,
      tenantId: tenant.id,
      platform: false,
      permissions: [...grants.owner],
      role: "owner",
    };

    const currency: string = tenant.config.bookingCurrency;
    const sources: string[] = tenant.config.bookingSources ?? ["phone"];
    const minimumPaidPercent: number = tenant.config.minimumPaidPercent ?? 0;
    const zone: string = tenant.timezone;

    // ── What is bookable ────────────────────────────────────────────────────
    const from = DateTime.now().setZone(zone).startOf("day");
    const to = from.plus({ days: opts.days });
    const { rows: departureRows } = await pool.query(
      `SELECT d.id,d.product_id,p.name AS product_name,d.starts_at,d.local_date::text AS local_date,
              d.capacity,d.committed,d.overbooked,p.definition,
              GREATEST(0,d.capacity-d.committed-d.overbooked)::int AS free
         FROM departures d
         JOIN products p ON p.tenant_id=d.tenant_id AND p.id=d.product_id
        WHERE d.tenant_id=$1
          AND d.starts_at > clock_timestamp()
          AND d.local_date <= $2::date
          AND d.operational_status='open'
          AND d.status IN ('scheduled','boarding')
          AND p.status='active'
          AND COALESCE(p.availability_mode,'fixed_departure')='fixed_departure'
          AND d.capacity-d.committed-d.overbooked > 0
        ORDER BY d.starts_at`,
      [tenant.id, to.toISODate()],
    );
    const departures: Departure[] = departureRows.map((row) => ({
      id: row.id,
      productId: row.product_id,
      productName: row.product_name,
      startsAt: row.starts_at,
      localDate: row.local_date,
      capacity: row.capacity,
      free: row.free,
      categories: (row.definition?.categories ?? [])
        .filter((c: Category) => c.countsTowardCapacity !== false)
        .map((c: Category) => ({ slug: c.slug, countsTowardCapacity: true })),
    }));
    if (!departures.length)
      throw new Error(
        `${tenant.name} has no open, unsold departures between ${from.toISODate()} and ${to.toISODate()}.\n` +
          `Extend a schedule or availability rule first — this script books into the catalogue, it does not create one.`,
      );

    const { rows: partnerRows } = await pool.query(
      `SELECT id,name,partner_type,commission_direction FROM partner_organizations
        WHERE tenant_id=$1 AND status='active' AND commission_direction IS NOT NULL
        ORDER BY name`,
      [tenant.id],
    );
    const partners: Partner[] = partnerRows.map((row) => ({
      id: row.id,
      name: row.name,
      type: row.partner_type,
      direction: row.commission_direction,
    }));

    // Vessels and properties are a shared catalogue: tenant_id IS NULL rows are
    // platform-seeded and visible to everyone.
    const { rows: vessels } = await pool.query(
      `SELECT id,name FROM vessels WHERE (tenant_id=$1 OR tenant_id IS NULL) AND active ORDER BY name LIMIT 60`,
      [tenant.id],
    );
    const { rows: properties } = await pool.query(
      `SELECT id,name FROM accommodation_properties WHERE (tenant_id=$1 OR tenant_id IS NULL) AND active ORDER BY name LIMIT 120`,
      [tenant.id],
    );
    const { rows: pickups } = await pool.query(
      `SELECT name,kind FROM pickup_locations WHERE tenant_id=$1 AND active ORDER BY name`,
      [tenant.id],
    );

    console.log(
      [
        `Tenant        ${tenant.name} (${tenant.slug})`,
        `Window        ${from.toISODate()} → ${to.toISODate()} (${opts.days} days, ${zone})`,
        `Departures    ${departures.length} open with ${departures.reduce((n, d) => n + d.free, 0)} free seats`,
        `Catalogue     ${partners.length} partners · ${vessels.length} vessels · ${properties.length} properties · ${pickups.length} pickup points`,
        `Batch         ${opts.batch}${opts.dryRun ? "  (dry run — nothing will be written)" : ""}`,
      ].join("\n"),
    );
    if (opts.dryRun) return;

    // ── Services ────────────────────────────────────────────────────────────
    const inventory = app.get(InventoryService);
    const reservations = app.get(ReservationService);
    const passengers = app.get(PassengerService);
    const partnerService = app.get(PartnerService);
    const changes = app.get(BookingChangeService);

    const random = rng(`${opts.batch}:${tenant.id}`);
    const tally = {
      confirmed: 0,
      held: 0,
      cancelled: 0,
      partnered: 0,
      seats: 0,
      grossMinor: 0,
      collectedMinor: 0,
      skipped: new Map<string, number>(),
    };
    const skip = (reason: string) =>
      tally.skipped.set(reason, (tally.skipped.get(reason) ?? 0) + 1);

    let sequence = 0;
    for (const departure of departures) {
      if (!departure.categories.length) {
        skip("product has no capacity-bearing categories");
        continue;
      }
      // Near dates sell better than far ones, and weekends better than midweek.
      const daysOut = Math.max(
        0,
        Math.round(
          DateTime.fromISO(departure.localDate, { zone }).diff(from, "days")
            .days,
        ),
      );
      const weekday = DateTime.fromISO(departure.localDate, { zone }).weekday;
      const decay = 0.55 + 0.45 * Math.exp(-daysOut / 18);
      const weekend = weekday >= 6 ? 1.15 : 1;
      const target = Math.min(
        departure.free,
        Math.round(
          departure.capacity *
            opts.fill *
            decay *
            weekend *
            (0.75 + random.next() * 0.5),
        ),
      );
      let seated = 0;

      while (seated < target) {
        sequence += 1;
        const remaining = target - seated;
        const key = (step: string) =>
          `${opts.batch}:${step}:${String(sequence).padStart(4, "0")}`;
        try {
          // ── Party ─────────────────────────────────────────────────────────
          const adultSlug =
            departure.categories.find((c) => /adult/i.test(c.slug))?.slug ??
            departure.categories[0]!.slug;
          const childSlug = departure.categories.find((c) =>
            /child|junior|kid/i.test(c.slug),
          )?.slug;
          const size = Math.min(
            remaining,
            random.weighted([
              [2, 40],
              [4, 22],
              [3, 14],
              [1, 10],
              [5, 7],
              [6, 5],
              [8, 2],
            ]),
          );
          const children =
            childSlug && size >= 3 && random.chance(0.35)
              ? random.int(1, Math.min(2, size - 2))
              : 0;
          const party: Record<string, number> = {
            [adultSlug]: size - children,
          };
          if (children && childSlug) party[childSlug] = children;

          const hold = await inventory.create(actor, key("hold"), {
            departureId: departure.id,
            party,
          });

          // ── Who is travelling ─────────────────────────────────────────────
          const lead = person(random);
          const source = random.weighted(
            sources.map(
              (s) =>
                [
                  s,
                  s === "website"
                    ? 34
                    : s === "partner_reseller"
                      ? 26
                      : s === "phone"
                        ? 24
                        : 16,
                ] as const,
            ),
          );
          const partner =
            partners.length &&
            (source === "partner_reseller" || random.chance(0.18))
              ? random.pick(partners)
              : null;

          // Collection follows the partner's commercial shape: an OTA has
          // already taken the guest's money, a reseller is invoiced in arrears,
          // an affiliate simply refers and the guest pays us at the dock.
          const collectionMode = !partner
            ? "guest_pays_tenant"
            : partner.type === "ota"
              ? "partner_collects_for_tenant"
              : partner.type === "reseller"
                ? "partner_invoice"
                : "guest_pays_tenant";

          // ── Where they are staying, and where we collect them ─────────────
          const stayRoll = random.weighted([
            ["cruise", vessels.length ? 32 : 0],
            ["hotel", properties.length ? 34 : 0],
            ["private_accommodation", 12],
            ["local", 12],
            ["none", 10],
          ] as const);
          const vessel = vessels.length ? random.pick(vessels) : null;
          const property = properties.length ? random.pick(properties) : null;
          const stay =
            stayRoll === "cruise" && vessel
              ? {
                  kind: "cruise" as const,
                  vesselId: vessel.id,
                  cabinNumber: random.chance(0.6)
                    ? `${random.int(4, 12)}${random.int(100, 340)}`
                    : "",
                }
              : stayRoll === "hotel" && property
                ? {
                    kind: "hotel" as const,
                    accommodationId: property.id,
                    hotelName: property.name,
                    roomNumber: random.chance(0.6)
                      ? String(random.int(101, 620))
                      : "",
                  }
                : stayRoll === "private_accommodation"
                  ? {
                      kind: "private_accommodation" as const,
                      propertyName: `Villa ${lead.last}`,
                      address: `${random.int(1, 90)} ${random.pick(["Coast Road", "Hillside Lane", "Harbour View", "Palm Drive"])}`,
                    }
                  : stayRoll === "local"
                    ? { kind: "local" as const, address: "" }
                    : { kind: "none" as const };

          const pickupPoint = pickups.length ? random.pick(pickups) : null;
          const pickup =
            stay.kind === "none" || random.chance(0.12)
              ? { kind: "none" as const }
              : random.chance(0.14)
                ? {
                    kind: "unresolved" as const,
                    note:
                      stay.kind === "cruise"
                        ? "Ship confirmed, berth not yet published — confirm with the port agent."
                        : "Guest to confirm their hotel on arrival.",
                  }
                : {
                    kind: "selected" as const,
                    location:
                      stay.kind === "hotel" && "hotelName" in stay
                        ? stay.hotelName
                        : (pickupPoint?.name ?? "Main meeting point"),
                    instructions: random.pick([
                      "Wait in the lobby 15 minutes before departure.",
                      "Meet the driver at the main entrance.",
                      "Pier gate — bring photo ID for the port check.",
                      "",
                    ]),
                  };

          // ── The reservation ───────────────────────────────────────────────
          const booking = await reservations.create(actor, key("booking"), {
            holdId: hold.holdId,
            leadName: lead.name,
            leadEmail: lead.email,
            leadPhone: `+1268${random.int(4000000, 4999999)}`,
            source,
            pickup,
            stay,
            emergencyContact: random.chance(0.45)
              ? {
                  name: `${random.pick(firstNames)} ${lead.last}`,
                  phone: `+1${random.int(2000000000, 9899999999)}`,
                  relationship: random.pick(relationships),
                }
              : undefined,
            ...(partner
              ? {
                  partner: {
                    partnerId: partner.id,
                    externalReference: `${(partner.type ?? "ref").slice(0, 3).toUpperCase()}-${random.int(100000, 999999)}`,
                    collectionMode,
                    invoiceRequired: collectionMode === "partner_invoice",
                  },
                }
              : {}),
          });
          const totalMinor = booking.quote.totalMinor as number;

          // ── Roster ────────────────────────────────────────────────────────
          // Some parties are booked with every name to hand and some are not.
          // A seat whose traveller is not yet named is a real state in this
          // system, not a defect — the roster carries it explicitly.
          const seats: {
            name: string;
            category: string;
            isMinor: boolean;
            identityPending: boolean;
          }[] = [];
          for (const [category, count] of Object.entries(party)) {
            for (let index = 0; index < count; index += 1) {
              const isLead = seats.length === 0;
              const minor = Boolean(childSlug && category === childSlug);
              const named = isLead || random.chance(0.72);
              seats.push({
                name: isLead
                  ? lead.name
                  : named
                    ? `${random.pick(firstNames)} ${random.chance(0.7) ? lead.last : random.pick(lastNames)}`
                    : `Guest ${seats.length + 1} · name required`,
                category,
                isMinor: minor,
                identityPending: !named && !isLead,
              });
            }
          }
          await passengers.replace(actor, booking.bookingId, key("roster"), {
            passengers: seats,
          });

          // ── Money ─────────────────────────────────────────────────────────
          // Booked somewhere between three weeks out and today, weighted late.
          const bookedDaysAhead = Math.min(
            daysOut,
            Math.round(random.next() * random.next() * 21),
          );
          const bookedAt = DateTime.fromJSDate(departure.startsAt)
            .setZone(zone)
            .minus({ days: bookedDaysAhead, hours: random.int(1, 20) });

          let collected = 0;
          if (collectionMode === "guest_pays_tenant") {
            const deposit = random.chance(0.28);
            const amount = deposit
              ? Math.max(
                  Math.ceil(
                    (totalMinor * Math.max(minimumPaidPercent, 30)) / 100,
                  ),
                  1,
                )
              : totalMinor;
            const status = random.chance(0.12) ? "pending" : "settled";
            await reservations.payment(
              actor,
              booking.bookingId,
              key("payment"),
              {
                amountMinor: amount,
                currency,
                method: random.weighted([
                  ["card", 52],
                  ["cash", 26],
                  ["bank_transfer", 12],
                  ["online", 10],
                ] as const),
                status,
                reference: `SEED-${String(sequence).padStart(4, "0")}`,
                reason: deposit
                  ? "Deposit taken at booking"
                  : "Balance settled in full",
                occurredAt:
                  bookedAt.toUTC().toISO() ?? new Date().toISOString(),
              },
            );
            if (status === "settled") collected = amount;
          }

          // ── Outcome ───────────────────────────────────────────────────────
          // Confirm only where the money rule is actually satisfied; the rest
          // stay held, which is the queue staff work from each morning.
          const coversMinimum =
            collectionMode !== "guest_pays_tenant" ||
            collected * 100 >= totalMinor * minimumPaidPercent;
          if (coversMinimum && random.chance(0.88)) {
            await reservations.confirm(
              actor,
              booking.bookingId,
              key("confirm"),
              {
                version: 1,
              },
            );
            tally.confirmed += 1;
            if (partner) {
              // Attribution records who sold it; the finance link records what
              // that sale is worth under the partner's current commission terms.
              await partnerService.linkBooking(actor, partner.id, key("link"), {
                booking_id: booking.bookingId,
                gross_amount_minor: totalMinor,
                pax_count: seats.length,
                source: partner.type === "ota" ? "ota_webhook" : "manual",
                external_ref: null,
              });
              tally.partnered += 1;
            }
            // A small number fall over, as they do in a real book of business.
            if (random.chance(0.05)) {
              await changes.cancel(actor, booking.bookingId, key("cancel"), {
                version: 2,
                reason: random.pick([
                  "Guest cancelled — flight rescheduled",
                  "Cruise itinerary changed, ship not calling",
                  "Guest unwell, refunded per policy",
                ]),
              });
              tally.confirmed -= 1;
              tally.cancelled += 1;
            }
          } else {
            tally.held += 1;
          }

          // The services stamp created_at as "now" because that is correct for
          // real traffic. Seeded history needs the booking to have been taken
          // when the payment says it was, or every pace and demand chart reads
          // as a single spike today.
          await pool.query(
            `UPDATE bookings SET created_at=$3 WHERE tenant_id=$1 AND id=$2`,
            [tenant.id, booking.bookingId, bookedAt.toUTC().toISO()],
          );

          seated += hold.seats;
          tally.seats += hold.seats;
          tally.grossMinor += totalMinor;
          tally.collectedMinor += collected;
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          skip(message);
          // A departure that refuses one party will refuse the next for the
          // same reason; move on rather than hammering it.
          break;
        }
      }
    }

    // ── Report ──────────────────────────────────────────────────────────────
    const money = (minor: number) =>
      `${currency} ${(minor / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
    console.log(
      [
        "",
        `Seeded        ${tally.confirmed} confirmed · ${tally.held} held · ${tally.cancelled} cancelled`,
        `Seats         ${tally.seats}`,
        `Gross         ${money(tally.grossMinor)}`,
        `Collected     ${money(tally.collectedMinor)}`,
        `Partner sales ${tally.partnered} linked for settlement`,
      ].join("\n"),
    );
    if (tally.skipped.size) {
      console.log("\nDepartures skipped:");
      for (const [reason, count] of tally.skipped)
        console.log(`  ${count}×  ${reason}`);
    }
  } finally {
    await app.close();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(
    error instanceof Error ? error.message : "Reservation seed failed",
  );
  process.exitCode = 1;
});
