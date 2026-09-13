import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { DateTime } from "luxon";
import { createApp } from "../src/app";
import { TenantService } from "../src/tenant";
import { CatalogService } from "../src/catalog";
import { InventoryService } from "../src/inventory";
import { ReservationService } from "../src/reservations";
import { DispatchService } from "../src/dispatch";
import { WaiverService } from "../src/waivers";
import { BookingChangeService } from "../src/booking-changes";
import { PartnerService } from "../src/partners";
import { hashPassword } from "./sessions";
import {
  grants,
  type Actor,
  type ProductInput,
} from "../../../packages/shared/src/contracts";

const platformActorId = "1b91ecbf-54a5-4afc-b0a5-95192f0527d3";
const key = () => randomUUID();
const sampleProducts: ProductInput[] = [
  {
    name: "Sample Coastal Discovery",
    optionName: "Shared morning departure",
    durationMinutes: 180,
    categories: [
      { slug: "adult", label: "Adult", countsTowardCapacity: true },
      { slug: "child", label: "Child", countsTowardCapacity: true },
      { slug: "infant", label: "Infant", countsTowardCapacity: false },
    ],
    rates: [
      {
        category: "adult",
        startDate: "2026-01-01",
        endDate: "2099-12-31",
        amountMinor: 12500,
      },
      {
        category: "child",
        startDate: "2026-01-01",
        endDate: "2099-12-31",
        amountMinor: 7900,
      },
      {
        category: "infant",
        startDate: "2026-01-01",
        endDate: "2099-12-31",
        amountMinor: 0,
      },
    ],
  },
  {
    name: "Sample Island Escape",
    optionName: "Shared afternoon departure",
    durationMinutes: 240,
    categories: [
      { slug: "adult", label: "Adult", countsTowardCapacity: true },
      { slug: "child", label: "Child", countsTowardCapacity: true },
    ],
    rates: [
      {
        category: "adult",
        startDate: "2026-01-01",
        endDate: "2099-12-31",
        amountMinor: 14900,
      },
      {
        category: "child",
        startDate: "2026-01-01",
        endDate: "2099-12-31",
        amountMinor: 9900,
      },
    ],
  },
  {
    name: "Sample Harbour & Heritage Tour",
    optionName: "Small-group cultural departure",
    durationMinutes: 210,
    categories: [
      { slug: "adult", label: "Adult", countsTowardCapacity: true },
      { slug: "child", label: "Child", countsTowardCapacity: true },
    ],
    rates: [
      {
        category: "adult",
        startDate: "2026-01-01",
        endDate: "2099-12-31",
        amountMinor: 10900,
      },
      {
        category: "child",
        startDate: "2026-01-01",
        endDate: "2099-12-31",
        amountMinor: 6900,
      },
    ],
  },
  {
    name: "Custom experience inquiry",
    optionName: "On-request quote",
    durationMinutes: 240,
    productKind: "charter",
    availabilityMode: "on_request",
    pricingModel: "per_group",
    privateBooking: true,
    confirmationMode: "request",
    categories: [
      { slug: "adult", label: "Adult", countsTowardCapacity: true },
    ],
    rates: [
      {
        category: "adult",
        startDate: "2026-01-01",
        endDate: "2099-12-31",
        amountMinor: 0,
      },
    ],
  },
];

const rockScheduled: ProductInput[] = [
  [
    "Clear Boat & Offshore Islands Experience",
    "Shared coastal departure",
    180,
    8900,
  ],
  [
    "Kayak & Snorkel Eco Adventures",
    "Guided eco-adventure departure",
    180,
    9900,
  ],
  ["Tuk-Tuk Rainforest & Beach Hopping", "Shared island departure", 240, 10900],
  ["Boat Cruise to Pig's Paradise", "Shared boat departure", 180, 13000],
  [
    "Tuk-Tuk Historical Harbour, Beach & Beers",
    "Extended cultural departure",
    300,
    13900,
  ],
].map(([name, optionName, durationMinutes, amountMinor]) => ({
  name: name as string,
  optionName: optionName as string,
  durationMinutes: durationMinutes as number,
  categories: [
    { slug: "adult", label: "Adult", countsTowardCapacity: true },
    { slug: "child", label: "Child", countsTowardCapacity: true },
    { slug: "infant", label: "Infant", countsTowardCapacity: false },
  ],
  rates: [
    {
      category: "adult",
      startDate: "2026-01-01",
      endDate: "2099-12-31",
      amountMinor: amountMinor as number,
    },
    // The workbook records children but does not establish an approved child tariff.
    // Keep the demo conservative until Rock approves a separate category rate.
    {
      category: "child",
      startDate: "2026-01-01",
      endDate: "2099-12-31",
      amountMinor: amountMinor as number,
    },
    {
      category: "infant",
      startDate: "2026-01-01",
      endDate: "2099-12-31",
      amountMinor: 0,
    },
  ],
})) as ProductInput[];
const rockProducts: ProductInput[] = [
  ...rockScheduled,
  {
    name: "Private charter inquiry (Demo)",
    optionName: "On-request quote",
    durationMinutes: 240,
    productKind: "charter",
    availabilityMode: "on_request",
    pricingModel: "per_group",
    privateBooking: true,
    confirmationMode: "request",
    categories: [
      { slug: "adult", label: "Adult", countsTowardCapacity: true },
    ],
    rates: [
      {
        category: "adult",
        startDate: "2026-01-01",
        endDate: "2099-12-31",
        amountMinor: 0,
      },
    ],
  },
];

type SeedTenant = {
  slug: string;
  name: string;
  currency: string;
  products: ProductInput[];
  rockDemo?: boolean;
};
const tenants: SeedTenant[] = [
  {
    slug: "sample-harbor-tours",
    name: "Sample Harbor Tours",
    currency: "USD",
    products: sampleProducts,
  },
  {
    slug: "sample-river-excursions",
    name: "Rock Adventures Demo",
    currency: "USD",
    products: rockProducts,
    rockDemo: true,
  },
];

function config(currency: string) {
  return {
    supportedLocales: ["en", "es"],
    locale: "en",
    dateFormat: "DD/MM/YYYY",
    timeFormat: "12h",
    weekStartsOn: 0,
    numberFormat: "comma_decimal",
    measurementSystem: "metric",
    bookingCurrency: currency,
    collectionCurrency: currency,
    reportingCurrency: currency,
    holdSeconds: 1800,
    minimumPaidPercent: 100,
    taxBasisPoints: 1500,
    allowUnresolvedPickup: false,
    allowAmendmentBalance: true,
    manualPaymentMethods: [
      "cash",
      "card",
      "online",
      "bank_transfer",
      "reseller_payment",
    ],
    bookingSources: ["phone", "walk_in", "website", "partner_reseller"],
    documentStorage: {
      hotProvider: "filesystem",
      archiveProvider: "none",
      hotRetentionDays: 7,
    },
  };
}

async function main() {
  if (process.env.NODE_ENV === "production")
    throw new Error("Persistent sample seed cannot run in production");
  if (!process.env.DATABASE_URL || !process.env.ADMIN_DATABASE_URL)
    throw new Error("DATABASE_URL and ADMIN_DATABASE_URL are required");
  process.env.APP_MODE = "demo";
  const admin = new Pool({ connectionString: process.env.ADMIN_DATABASE_URL });
  const app = await createApp();
  try {
    const localPassword =
      process.env.LOCAL_DEFAULT_PASSWORD ?? "ZettazLocal!2026";
    const passwordHash = await hashPassword(localPassword);
    // Reset only the local sample tenants. Other tenants' subscription records
    // and plans are never touched by the development seed.
    await admin.query(
      "DELETE FROM tenant_subscriptions WHERE tenant_id IN (SELECT id FROM tenants WHERE slug = ANY($1))",
      [tenants.map((tenant) => tenant.slug)],
    );
    // Zettaz Tours & Charters subscription plans (T&C edition — replaces the old Cloud POS seed rows).
    // stripe_price_id_* values are filled in by migration 057 after running
    // apps/api/scripts/setup-stripe-plans.ts with a live Stripe key.
    await admin.query(`INSERT INTO subscription_plans(
      id,name,description,monthly_minor,yearly_minor,currency,features,limits,
      stripe_price_id_monthly,stripe_price_id_yearly,active
    ) VALUES
      ('4e0e6cc1-89b1-4dcb-a627-bfccb14f0af9','Essentials','Core booking and operations for small tour and charter businesses.',7900,79900,'USD',
       '["Reservations & manual booking","Departure calendar & availability","Day manifest & print / PDF","Payments — deposits, balances, cash & links","Basic reporting","Email booking confirmations"]',
       '{"Staff users":3,"Locations":1,"Tour products":50,"Storage":"500 MB"}',
       'price_REPLACE_ESSENTIALS_MONTHLY','price_REPLACE_ESSENTIALS_YEARLY',true),
      ('f7317df1-086a-4ad9-a9c9-c229a5995dcd','Operations','Full operational capability for tour businesses with crews, vehicles, and waivers.',14900,149000,'USD',
       '["Everything in Essentials","Dispatch board & pickup routes","Crew mobile app (iOS & Android)","Digital waivers & guest check-in","Resource & fleet basics","Weather & closure controls"]',
       '{"Staff users":10,"Locations":2,"Tour products":200,"Storage":"2 GB"}',
       'price_REPLACE_OPERATIONS_MONTHLY','price_REPLACE_OPERATIONS_YEARLY',true),
      ('3e595412-81e5-4c76-8216-25321d7ba56a','Growth','Multi-channel and partner capability for growing tour operators.',24900,249000,'USD',
       '["Everything in Operations","Partner & reseller attribution","Channel integrations (WP, OTA import)","Customer notifications (SMTP)","Partner statements & invoicing","Advanced reporting"]',
       '{"Staff users":25,"Locations":5,"Tour products":"1,000","Storage":"10 GB"}',
       'price_REPLACE_GROWTH_MONTHLY','price_REPLACE_GROWTH_YEARLY',true),
      ('70a106d7-1977-48a4-aa6d-d816470e477f','Enterprise','Customisable platform and priority support for larger operators.',59900,599000,'USD',
       '["Everything in Growth","Unlimited staff & locations","Priority support & SLA","Custom branding & white-label","API access","Dedicated onboarding"]',
       '{"Staff users":"Unlimited","Locations":"Unlimited","Tour products":"Unlimited","Storage":"50 GB"}',
       'price_REPLACE_ENTERPRISE_MONTHLY','price_REPLACE_ENTERPRISE_YEARLY',true)
      ON CONFLICT (id) DO UPDATE SET
        name=EXCLUDED.name,description=EXCLUDED.description,monthly_minor=EXCLUDED.monthly_minor,
        yearly_minor=EXCLUDED.yearly_minor,currency=EXCLUDED.currency,features=EXCLUDED.features,
        limits=EXCLUDED.limits,stripe_price_id_monthly=EXCLUDED.stripe_price_id_monthly,
        stripe_price_id_yearly=EXCLUDED.stripe_price_id_yearly,active=EXCLUDED.active`);
    await admin.query(
      "DELETE FROM subscription_plans p WHERE p.id = ANY($1) AND NOT EXISTS (SELECT 1 FROM tenant_subscriptions s WHERE s.plan_id=p.id)",
      [["starter", "operations", "growth"]],
    );
    await admin.query(
      "INSERT INTO platform_users(id,name) VALUES($1,$2) ON CONFLICT (id) DO NOTHING",
      [platformActorId, "Local sample data administrator"],
    );
    const platform: Actor = {
      actorId: platformActorId,
      tenantId: null,
      platform: true,
      permissions: ["tenant.provision"],
      role: "platform",
    };
    const tenantService = app.get(TenantService);
    const catalog = app.get(CatalogService);
    const inventory = app.get(InventoryService);
    const reservations = app.get(ReservationService);
    const dispatch = app.get(DispatchService);
    const waivers = app.get(WaiverService);
    const changes = app.get(BookingChangeService);
    const partners = app.get(PartnerService);

    for (const seed of tenants) {
      let tenantRow = (
        await admin.query("SELECT id FROM tenants WHERE slug=$1", [seed.slug])
      ).rows[0] as { id: string } | undefined;
      if (!tenantRow) {
        const created = await tenantService.create(platform, {
          slug: seed.slug,
          name: seed.name,
          timezone: "America/Antigua",
          ownerName: "Sample Tenant Owner",
          ownerEmail: `${seed.slug}@example.invalid`,
          config: config(seed.currency),
        });
        tenantRow = { id: created.tenantId };
      }
      const tenantId = tenantRow.id;
      await admin.query(
        `UPDATE tenants SET name=$2, timezone='America/Antigua',
           config=config || jsonb_build_object(
             'bookingCurrency',$3::text,'collectionCurrency',$3::text,'reportingCurrency',$3::text,
             'bookingSources',ARRAY['phone','walk_in','website','partner_reseller'],
             'manualPaymentMethods',ARRAY['cash','card','online','bank_transfer','reseller_payment']
           ),
           business_profile=CASE WHEN $4::boolean THEN business_profile || $5::jsonb ELSE business_profile END,
           version=version+1
         WHERE id=$1`,
        [
          tenantId,
          seed.name,
          seed.currency,
          Boolean(seed.rockDemo),
          JSON.stringify({
            displayName: "Rock Adventures Demo",
            streetAddress: "Heritage Quay",
            suite: "",
            city: "St. John's",
            stateParish: "St. John",
            postalCode: "",
            country: "AG",
            email: "demo@rockadventures.example.invalid",
            phone: "+1 268 555 0100",
          }),
        ],
      );
      await admin.query(
        "INSERT INTO tenant_subscriptions(tenant_id,plan_id,status,billing_cycle,period_ends_at,trial_ends_at) VALUES($1,'6baf0d04-4c50-11f0-8dfa-525400d69130','trial','monthly',clock_timestamp()+interval '14 days',clock_timestamp()+interval '14 days') ON CONFLICT (tenant_id) DO NOTHING",
        [tenantId],
      );
      if (seed.rockDemo) {
        // Earlier local demo runs used XCD before Rock's approved online USD
        // policy was recorded. These are synthetic records, so correct their
        // monetary unit at the source instead of misleadingly relabeling it in UI.
        await admin.query(
          "UPDATE holds SET quote=jsonb_set(quote,'{currency}',to_jsonb('USD'::text)) WHERE tenant_id=$1 AND quote->>'currency'<>'USD'",
          [tenantId],
        );
        // Confirmed price/payment history is append-only and remains untouched.
        // New sample records are created in USD; the local list read model uses
        // the corrected hold quote for the pre-existing synthetic fixtures.
      }
      const owner = (
        await admin.query(
          "SELECT m.actor_id,s.email FROM memberships m JOIN staff_users s ON s.id=m.actor_id WHERE m.tenant_id=$1 AND m.role='owner' ORDER BY m.actor_id LIMIT 1",
          [tenantId],
        )
      ).rows[0] as { actor_id: string; email: string };
      if (!owner) throw new Error(`Sample tenant ${seed.slug} has no owner`);
      if (seed.rockDemo) {
        await admin.query(
          "UPDATE staff_users SET name='Rock Adventures Demo Owner',email='cloudadmin@zettaz.com',email_verified_at=COALESCE(email_verified_at,clock_timestamp()),signup_completed_at=COALESCE(signup_completed_at,clock_timestamp()) WHERE id=$1",
          [owner.actor_id],
        );
      }
      const actor: Actor = {
        actorId: owner.actor_id,
        tenantId,
        platform: false,
        permissions: [...grants.owner],
        role: "owner",
      };

      const memberInputs = [
        {
          name: seed.rockDemo
            ? "Rock Operations Administrator"
            : "Sample Administrator",
          email: seed.rockDemo
            ? "rockadmin@zettaz.com"
            : `admin+${seed.slug}@example.invalid`,
          role: "admin",
        },
        {
          name: seed.rockDemo
            ? "Rock Reservations Lead"
            : "Sample Reservations Lead",
          email: seed.rockDemo
            ? "rockreservations@zettaz.com"
            : `reservations+${seed.slug}@example.invalid`,
          role: "reservations",
        },
        {
          name: seed.rockDemo ? "Rock Dispatcher" : "Sample Dispatcher",
          email: seed.rockDemo
            ? "rockdispatch@zettaz.com"
            : `dispatch+${seed.slug}@example.invalid`,
          role: "dispatcher",
        },
        {
          name: seed.rockDemo
            ? "Rock Finance Reviewer"
            : "Sample Finance Reviewer",
          email: seed.rockDemo
            ? "rockfinance@zettaz.com"
            : `finance+${seed.slug}@example.invalid`,
          role: "finance",
        },
        {
          name: seed.rockDemo ? "Rock Auditor" : "Sample Auditor",
          email: seed.rockDemo
            ? "rockauditor@zettaz.com"
            : `audit+${seed.slug}@example.invalid`,
          role: "auditor",
        },
        ...(seed.rockDemo
          ? [
              {
                name: "Rock Operations Manager",
                email: "rockoperations@zettaz.com",
                role: "operations_manager",
              },
              {
                name: "Rock Guide",
                email: "rockguide@zettaz.com",
                role: "guide",
              },
              {
                name: "Rock Driver / Skipper",
                email: "rockdriver@zettaz.com",
                role: "driver",
              },
              {
                name: "Rock Resource Manager",
                email: "rockresources@zettaz.com",
                role: "resource_manager",
              },
              {
                name: "Rock Partner Manager",
                email: "rockpartners@zettaz.com",
                role: "partner_manager",
              },
            ]
          : []),
      ];
      for (const member of memberInputs) {
        const exists = await admin.query(
          "SELECT 1 FROM memberships m JOIN staff_users s ON s.id=m.actor_id WHERE m.tenant_id=$1 AND s.email=$2",
          [tenantId, member.email],
        );
        if (!exists.rowCount) await tenantService.member(actor, key(), member);
      }

      const day = DateTime.now()
        .setZone("America/Antigua")
        .plus({ days: 1 })
        .startOf("day");
      const productIds: Record<string, string> = {};
      const legacyRockNames = [
        "Sample Coastal Discovery",
        "Sample Island Escape",
        "Sample Harbour & Heritage Tour",
      ];
      for (const [index, input] of seed.products.entries()) {
        let product = (
          await admin.query(
            "SELECT id FROM products WHERE tenant_id=$1 AND name=$2",
            [tenantId, input.name],
          )
        ).rows[0] as { id: string } | undefined;
        if (!product && seed.rockDemo && legacyRockNames[index]) {
          product = (
            await admin.query(
              `UPDATE products SET name=$3,definition=$4,version=version+1
               WHERE tenant_id=$1 AND name=$2 RETURNING id`,
              [tenantId, legacyRockNames[index], input.name, input],
            )
          ).rows[0] as { id: string } | undefined;
        }
        if (!product) {
          const created = await catalog.create(actor, key(), input);
          product = { id: created.productId };
        } else {
          await admin.query(
            "UPDATE products SET definition=$3 WHERE tenant_id=$1 AND id=$2",
            [tenantId, product.id, input],
          );
        }
        productIds[input.name] = product.id;
        const schedules = await admin.query(
          "SELECT 1 FROM schedules WHERE tenant_id=$1 AND product_id=$2 LIMIT 1",
          [tenantId, product.id],
        );
        if (
          !schedules.rowCount &&
          (input.availabilityMode ?? "fixed_departure") === "fixed_departure"
        )
          await catalog.schedule(actor, key(), {
            productId: product.id,
            name: "Schedule",
            startDate: day.toISODate(),
            endDate: day.plus({ days: 14 }).toISODate(),
            weekdays: [1, 2, 3, 4, 5, 6, 7],
            localTimes: [`${String(9 + index * 2).padStart(2, "0")}:00`],
            capacity: 18,
            blackoutDates: [],
          });
      }

      const locationInputs = seed.rockDemo
        ? [
            {
              slug: "heritage-quay",
              name: "Heritage Quay",
              kind: "port",
              notes: "Meet at the visitor exit; confirm berth and local time.",
            },
            {
              slug: "sandals-grande-antigua",
              name: "Sandals Grande Antigua",
              kind: "hotel",
              notes: "Confirm the assigned lobby pickup point.",
            },
            {
              slug: "st-james-club",
              name: "St. James's Club",
              kind: "hotel",
              notes: "Confirm the assigned lobby pickup point.",
            },
            {
              slug: "jolly-beach",
              name: "Jolly Beach Antigua",
              kind: "hotel",
              notes: "Confirm the assigned lobby pickup point.",
            },
            {
              slug: "rock-adventures-base",
              name: "Rock Adventures meeting point",
              kind: "meeting_point",
              notes: "Self-drive guests should arrive 15 minutes early.",
            },
          ]
        : [
            {
              slug: "sample-cruise-port",
              name: "Sample Cruise Port",
              kind: "port",
              notes: "Meet at the visitor exit.",
            },
            {
              slug: "sample-seaside-hotel",
              name: "Sample Seaside Hotel",
              kind: "hotel",
              notes: "Lobby entrance.",
            },
            {
              slug: "sample-town-point",
              name: "Sample Town Meeting Point",
              kind: "meeting_point",
              notes: "Arrive 15 minutes early.",
            },
          ];
      const locations: Record<string, string> = {};
      for (const location of locationInputs) {
        let row = (
          await admin.query(
            "SELECT id FROM pickup_locations WHERE tenant_id=$1 AND slug=$2",
            [tenantId, location.slug],
          )
        ).rows[0] as { id: string } | undefined;
        if (!row) row = await dispatch.createLocation(actor, key(), location);
        locations[location.slug] = row.id;
      }
      const portLocation = seed.rockDemo
        ? "heritage-quay"
        : "sample-cruise-port";
      const hotelLocation = seed.rockDemo
        ? "sandals-grande-antigua"
        : "sample-seaside-hotel";
      const townLocation = seed.rockDemo
        ? "rock-adventures-base"
        : "sample-town-point";
      const portName = seed.rockDemo ? "Heritage Quay" : "Sample Cruise Port";
      const hotelName = seed.rockDemo
        ? "Sandals Grande Antigua"
        : "Sample Seaside Hotel";
      const townName = seed.rockDemo
        ? "Rock Adventures meeting point"
        : "Sample Town Meeting Point";
      if (seed.rockDemo) {
        for (const accommodation of [
          "Sandals Grande Antigua",
          "Hawksbill Resort Antigua",
          "St. James's Club",
          "The Verandah Antigua",
          "Jolly Beach Antigua",
          "Galley Bay Resort & Spa",
        ]) {
          await admin.query(
            `INSERT INTO accommodation_properties(tenant_id,id,name,address,created_by)
             VALUES($1,$2,$3,'Antigua and Barbuda',$4) ON CONFLICT(tenant_id,name) DO NOTHING`,
            [tenantId, key(), accommodation, actor.actorId],
          );
        }
        await admin.query(
          `INSERT INTO cruise_calls(tenant_id,id,vessel_name,call_date,port_name,scheduled_arrival,scheduled_departure,all_aboard_at,created_by)
           VALUES($1,$2,'Rhapsody of the Seas',$3,'St. John''s Cruise Port',$4,$5,$6,$7)
           ON CONFLICT(tenant_id,vessel_name,call_date,port_name) DO NOTHING`,
          [
            tenantId,
            key(),
            day.toISODate(),
            day.plus({ hours: 8 }).toUTC().toISO(),
            day.plus({ hours: 17 }).toUTC().toISO(),
            day.plus({ hours: 16, minutes: 30 }).toUTC().toISO(),
            actor.actorId,
          ],
        );
      }

      const departureFor = async (productName: string, offset: number) => {
        const row = (
          await admin.query(
            "SELECT id,starts_at FROM departures WHERE tenant_id=$1 AND product_id=$2 AND local_date=$3 ORDER BY starts_at LIMIT 1",
            [
              tenantId,
              productIds[productName],
              day.plus({ days: offset }).toISODate(),
            ],
          )
        ).rows[0] as { id: string; starts_at: Date } | undefined;
        if (!row)
          throw new Error(`Sample departure missing for ${productName}`);
        return row;
      };
      const ensureBooking = async (input: {
        leadName: string;
        leadEmail: string;
        productName: string;
        offset: number;
        party: Record<string, number>;
        pickup: unknown;
        stay: unknown;
        settled?: boolean;
        confirmWithoutPayment?: boolean;
        partner?: {
          partnerId: string;
          externalReference: string;
          collectionMode:
            | "guest_pays_tenant"
            | "partner_collects_for_tenant"
            | "partner_invoice";
          invoiceRequired: boolean;
        };
      }) => {
        let row = (
          await admin.query(
            "SELECT id FROM bookings WHERE tenant_id=$1 AND lead_name=$2",
            [tenantId, input.leadName],
          )
        ).rows[0] as { id: string } | undefined;
        if (row) return row.id;
        const departure = await departureFor(input.productName, input.offset);
        const hold = await inventory.create(actor, key(), {
          departureId: departure.id,
          party: input.party,
        });
        const booking = await reservations.create(actor, key(), {
          holdId: hold.holdId,
          leadName: input.leadName,
          leadEmail: input.leadEmail,
          source: "phone",
          pickup: input.pickup,
          stay: input.stay,
          ...(input.partner ? { partner: input.partner } : {}),
        });
        if (input.settled) {
          await reservations.payment(actor, booking.bookingId, key(), {
            amountMinor: hold.quote.totalMinor,
            currency: seed.currency,
            method: "cash",
            status: "settled",
            reference: `SAMPLE-${input.leadName.replaceAll(" ", "-").toUpperCase()}`,
            reason: "Synthetic local sample payment; no money collected",
            occurredAt: new Date().toISOString(),
          });
          await reservations.confirm(actor, booking.bookingId, key(), {
            version: 1,
          });
        } else if (input.confirmWithoutPayment) {
          await reservations.confirm(actor, booking.bookingId, key(), {
            version: 1,
          });
        }
        return booking.bookingId;
      };
      const ensurePartner = async (name: string) => {
        const existing = (
          await admin.query(
            "SELECT id FROM partner_organizations WHERE tenant_id=$1 AND name=$2",
            [tenantId, name],
          )
        ).rows[0] as { id: string } | undefined;
        if (existing) return existing.id;
        return (
          await partners.create(actor, key(), {
            name,
            email: `${name.toLowerCase().replaceAll(" ", ".")}@example.invalid`,
            notes:
              "Synthetic local sample partner. No commercial agreement is implied.",
          })
        ).id;
      };
      if (seed.rockDemo) {
        await admin.query(
          `UPDATE partner_organizations SET name=CASE name
             WHEN 'Sample Referral Hotel' THEN 'Viator (Demo)'
             WHEN 'Sample Invoice Reseller' THEN 'GetYourGuide (Demo)'
             WHEN 'Sample Collection Resort' THEN 'Island Routes (Demo)'
             ELSE name END,
             notes='Synthetic demo channel based on workbook evidence; no live connection or commercial agreement is implied.'
           WHERE tenant_id=$1 AND name IN ('Sample Referral Hotel','Sample Invoice Reseller','Sample Collection Resort')`,
          [tenantId],
        );
      }
      const referralPartner = await ensurePartner(
        seed.rockDemo ? "Viator (Demo)" : "Sample Referral Hotel",
      );
      const invoicePartner = await ensurePartner(
        seed.rockDemo ? "GetYourGuide (Demo)" : "Sample Invoice Reseller",
      );
      const collectionPartner = await ensurePartner(
        seed.rockDemo ? "Island Routes (Demo)" : "Sample Collection Resort",
      );
      const cruiseBooking = await ensureBooking({
        leadName: "Sample Cruise Guest",
        leadEmail: "cruise.guest@example.invalid",
        productName: seed.products[0]!.name,
        offset: 0,
        party: { adult: 2 },
        settled: true,
        pickup: {
          kind: "selected",
          location: portName,
          instructions: "Meet beside the visitor exit.",
        },
        stay: {
          kind: "cruise",
          vesselName: seed.rockDemo
            ? "Rhapsody of the Seas"
            : "Sample Ocean Voyager",
          cabinNumber: "B214",
        },
      });
      const hotelBooking = await ensureBooking({
        leadName: "Sample Hotel Guest",
        leadEmail: "hotel.guest@example.invalid",
        productName: seed.products[0]!.name,
        offset: 0,
        party: { adult: 1, child: 1 },
        settled: true,
        pickup: {
          kind: "selected",
          location: hotelName,
          instructions: "Wait at the lobby entrance.",
        },
        stay: {
          kind: "hotel",
          hotelName,
          roomNumber: "315",
        },
      });
      await ensureBooking({
        leadName: "Sample Walk-in Guest",
        leadEmail: "walkin.guest@example.invalid",
        productName: seed.products[1]!.name,
        offset: 1,
        party: { adult: 2 },
        settled: true,
        pickup: {
          kind: "selected",
          location: townName,
          instructions: "Meet at the signed pickup point.",
        },
        stay: { kind: "none" },
      });
      await ensureBooking({
        leadName: "Sample Referral Partner Guest",
        leadEmail: "referral.partner@example.invalid",
        productName: seed.products[1]!.name,
        offset: 4,
        party: { adult: 1 },
        settled: true,
        pickup: { kind: "none" },
        stay: {
          kind: "hotel",
          hotelName: "Sample Referral Hotel",
          roomNumber: "",
        },
        partner: {
          partnerId: referralPartner,
          externalReference: "REF-SAMPLE-001",
          collectionMode: "guest_pays_tenant",
          invoiceRequired: false,
        },
      });
      await ensureBooking({
        leadName: "Sample Partner Invoice Guest",
        leadEmail: "invoice.partner@example.invalid",
        productName: seed.products[2]!.name,
        offset: 5,
        party: { adult: 1 },
        settled: true,
        pickup: { kind: "none" },
        stay: { kind: "none" },
        partner: {
          partnerId: invoicePartner,
          externalReference: "INV-SAMPLE-001",
          collectionMode: "partner_invoice",
          invoiceRequired: true,
        },
      });
      let collectionBooking = (
        await admin.query(
          "SELECT id FROM bookings WHERE tenant_id=$1 AND lead_name='Sample Partner Collection Guest'",
          [tenantId],
        )
      ).rows[0] as { id: string } | undefined;
      if (!collectionBooking) {
        const tenantConfig = (
          await admin.query("SELECT config,version FROM tenants WHERE id=$1", [
            tenantId,
          ])
        ).rows[0] as { config: ReturnType<typeof config>; version: number };
        const lowered = await tenantService.config(actor, key(), {
          version: tenantConfig.version,
          config: { ...tenantConfig.config, minimumPaidPercent: 0 },
        });
        try {
          collectionBooking = {
            id: await ensureBooking({
              leadName: "Sample Partner Collection Guest",
              leadEmail: "collection.partner@example.invalid",
              productName: seed.products[0]!.name,
              offset: 6,
              party: { adult: 1 },
              pickup: { kind: "none" },
              stay: { kind: "none" },
              partner: {
                partnerId: collectionPartner,
                externalReference: "COL-SAMPLE-001",
                collectionMode: "partner_collects_for_tenant",
                invoiceRequired: false,
              },
              confirmWithoutPayment: true,
            }),
          };
        } finally {
          await tenantService.config(actor, key(), {
            version: lowered.version,
            config: tenantConfig.config,
          });
        }
      }
      const collectionState = (
        await admin.query(
          "SELECT state,version FROM bookings WHERE tenant_id=$1 AND id=$2",
          [tenantId, collectionBooking.id],
        )
      ).rows[0] as { state: string; version: number };
      if (collectionState.state !== "confirmed") {
        const tenantConfig = (
          await admin.query("SELECT config,version FROM tenants WHERE id=$1", [
            tenantId,
          ])
        ).rows[0] as { config: ReturnType<typeof config>; version: number };
        const lowered = await tenantService.config(actor, key(), {
          version: tenantConfig.version,
          config: { ...tenantConfig.config, minimumPaidPercent: 0 },
        });
        try {
          await reservations.confirm(actor, collectionBooking.id, key(), {
            version: collectionState.version,
          });
        } finally {
          await tenantService.config(actor, key(), {
            version: lowered.version,
            config: tenantConfig.config,
          });
        }
      }
      const collectionClaim = (
        await admin.query(
          "SELECT id FROM partner_collection_claims WHERE tenant_id=$1 AND booking_id=$2 AND reference='COL-SAMPLE-001'",
          [tenantId, collectionBooking.id],
        )
      ).rows[0] as { id: string } | undefined;
      if (!collectionClaim) {
        const created = await partners.claim(actor, key(), {
          bookingId: collectionBooking.id,
          partnerId: collectionPartner,
          amountMinor: 5000,
          currency: seed.currency,
          reference: "COL-SAMPLE-001",
          notes:
            "Synthetic accepted partner collection. No money was collected.",
        });
        await partners.decide(actor, created.id, key(), {
          decision: "accepted",
          reason: "Synthetic local finance approval.",
        });
      }
      await ensureBooking({
        leadName: "Sample Held Reservation",
        leadEmail: "held.guest@example.invalid",
        productName: seed.products[2]!.name,
        offset: 2,
        party: { adult: 1 },
        pickup: { kind: "none" },
        stay: { kind: "none" },
      });

      const template = (
        await admin.query(
          "SELECT id FROM waiver_templates WHERE tenant_id=$1 AND title=$2 LIMIT 1",
          [
            tenantId,
            seed.rockDemo
              ? "Rock Adventures Tour Participant Waiver and Release"
              : "Sample Tour Participant Waiver and Release",
          ],
        )
      ).rows[0] as { id: string } | undefined;
      const templateId =
        template?.id ??
        (
          await waivers.create(actor, key(), {
            title: seed.rockDemo
              ? "Rock Adventures Tour Participant Waiver and Release"
              : "Sample Tour Participant Waiver and Release",
            body: seed.rockDemo
              ? "I understand and accept the inherent risks associated with participating in the selected Rock Adventures tour. I confirm that I am physically fit to participate. I voluntarily release Rock Adventures and its staff from claims related to injury or damage arising from my participation, to the extent permitted by applicable law. I agree that this waiver binds me and my heirs. This is editable demo wording and must be reviewed and approved by the tenant's legal adviser before production use."
              : "I understand and accept the inherent risks associated with participating in this tour. I confirm that I am physically fit to participate and release the operator and its staff from claims related to my participation. This sample wording must be replaced with tenant-approved legal content before production use.",
          })
        ).id;
      const signature = await admin.query(
        "SELECT 1 FROM waiver_signatures WHERE tenant_id=$1 AND booking_id=$2",
        [tenantId, cruiseBooking],
      );
      if (!signature.rowCount)
        await waivers.sign(actor, cruiseBooking, key(), {
          templateId,
          signerName: "Sample Cruise Guest",
          signerCapacity: "self",
        });

      const planExists = await admin.query(
        "SELECT 1 FROM departure_pickup_plans p JOIN bookings b ON b.tenant_id=p.tenant_id AND b.departure_id=p.departure_id WHERE p.tenant_id=$1 AND b.id=$2",
        [tenantId, cruiseBooking],
      );
      if (!planExists.rowCount) {
        const departure = await departureFor(seed.products[0]!.name, 0);
        const starts = DateTime.fromJSDate(departure.starts_at).toUTC();
        await dispatch.savePlan(actor, departure.id, key(), {
          notes:
            "Synthetic local sample plan. Confirm timing with the operator.",
          stops: [
            {
              bookingId: cruiseBooking,
              locationId: locations[portLocation]!,
              pickupAt: starts.minus({ minutes: 45 }).toISO(),
              notes: "Visitor exit.",
            },
            {
              bookingId: hotelBooking,
              locationId: locations[hotelLocation]!,
              pickupAt: starts.minus({ minutes: 25 }).toISO(),
              notes: "Lobby entrance.",
            },
          ],
        });
      }
      const cancelled = (
        await admin.query(
          "SELECT id,version FROM bookings WHERE tenant_id=$1 AND lead_name='Sample Cancelled Reservation'",
          [tenantId],
        )
      ).rows[0] as { id: string; version: number } | undefined;
      if (!cancelled) {
        const bookingId = await ensureBooking({
          leadName: "Sample Cancelled Reservation",
          leadEmail: "cancelled.guest@example.invalid",
          productName: seed.products[1]!.name,
          offset: 3,
          party: { adult: 1 },
          settled: true,
          pickup: { kind: "none" },
          stay: { kind: "none" },
        });
        await changes.cancel(actor, bookingId, key(), {
          version: 2,
          reason:
            "Synthetic cancellation used to demonstrate the reservation history.",
        });
      }
      await admin.query("DELETE FROM staff_sessions WHERE tenant_id=$1", [
        tenantId,
      ]);
      await admin.query(
        `INSERT INTO user_credentials(user_id,password_hash)
         SELECT actor_id,$2 FROM memberships WHERE tenant_id=$1
         ON CONFLICT(user_id) DO UPDATE SET password_hash=EXCLUDED.password_hash`,
        [tenantId, passwordHash],
      );
      // Demo staff must be loginable under email-verification gate.
      await admin.query(
        `UPDATE staff_users
         SET email_verified_at = COALESCE(email_verified_at, clock_timestamp()),
             signup_completed_at = COALESCE(signup_completed_at, clock_timestamp())
         WHERE id IN (SELECT actor_id FROM memberships WHERE tenant_id=$1)`,
        [tenantId],
      );
      const summary = (
        await admin.query(
          `SELECT
             (SELECT count(*)::int FROM products WHERE tenant_id=$1) products,
             (SELECT count(*)::int FROM departures WHERE tenant_id=$1 AND starts_at>=clock_timestamp()) upcoming_departures,
             (SELECT count(*)::int FROM bookings WHERE tenant_id=$1) bookings,
             (SELECT count(*)::int FROM partner_organizations WHERE tenant_id=$1) partners`,
          [tenantId],
        )
      ).rows[0];
      console.log(
        `Seeded ${seed.name}: ${summary.products} products, ${summary.upcoming_departures} upcoming departures, ${summary.bookings} synthetic bookings, ${summary.partners} partners.`,
      );
    }
  } finally {
    await app.close();
    await admin.end();
  }
}
main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
