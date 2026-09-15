import { z } from "zod";

export const id = z.string().uuid();
const label = z.string().trim().min(1).max(120);
const slug = z.string().regex(/^[a-z][a-z0-9_-]{1,49}$/);
const currency = z
  .string()
  .length(3)
  .refine(
    (v) => Intl.supportedValuesOf("currency").includes(v),
    "Unsupported ISO currency",
  );
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const configSchema = z
  .object({
    supportedLocales: z
      .array(z.string().regex(/^[a-z]{2}(-[A-Z]{2})?$/))
      .min(1)
      .max(20)
      .default(["en"]),
    locale: z
      .string()
      .regex(/^[a-z]{2}(-[A-Z]{2})?$/)
      .default("en"),
    dateFormat: z
      .enum(["DD/MM/YYYY", "MM/DD/YYYY", "YYYY-MM-DD"])
      .default("DD/MM/YYYY"),
    timeFormat: z.enum(["12h", "24h"]).default("12h"),
    weekStartsOn: z.number().int().min(0).max(6).default(0),
    numberFormat: z
      .enum(["comma_decimal", "decimal_comma"])
      .default("comma_decimal"),
    measurementSystem: z.enum(["metric", "imperial"]).default("metric"),
    bookingCurrency: currency,
    collectionCurrency: currency,
    reportingCurrency: currency,
    settlementCurrency: currency.optional(),
    holdSeconds: z.number().int().min(30).max(1800),
    minimumPaidPercent: z.number().int().min(0).max(100),
    taxBasisPoints: z.number().int().min(0).max(10000),
    // false: catalogue amounts are net, tax is added on top (total = net + tax).
    // true:  catalogue amounts already contain tax, which is extracted for
    //        display (total = catalogue amount). Only affects NEW holds —
    //        priced quotes are frozen, so changing this never restates a
    //        booking that already exists.
    taxInclusive: z.boolean().default(false),
    allowUnresolvedPickup: z.boolean(),
    allowAmendmentBalance: z.boolean().default(false),
    manualPaymentMethods: z.array(slug).min(1).max(20),
    bookingSources: z.array(slug).min(1).max(50),
    documentStorage: z
      .object({
        hotProvider: z.enum(["filesystem", "s3"]).default("filesystem"),
        archiveProvider: z
          .enum(["none", "google_drive", "onedrive", "dropbox"])
          .default("none"),
        /** Hot copies auto-purge within this window. Max 7 unless a purchased storage plan lands later. */
        hotRetentionDays: z.number().int().min(1).max(7).default(7),
      })
      .default({
        hotProvider: "filesystem",
        archiveProvider: "none",
        hotRetentionDays: 7,
      }),
    /** Long-lived compliance library (licenses, insurance). Separate from waiver hot PDFs. */
    documentLibrary: z
      .object({
        quotaBytes: z
          .number()
          .int()
          .positive()
          .max(100 * 1024 * 1024 * 1024)
          .default(1073741824),
      })
      .default({ quotaBytes: 1073741824 }),
  })
  .strict()
  .refine(
    (c) =>
      c.bookingCurrency === c.collectionCurrency &&
      c.bookingCurrency === c.reportingCurrency,
    "Cross-currency collection/reporting requires the later FX workflow",
  );
export type TenantConfig = z.infer<typeof configSchema>;
export const tenantSchema = z
  .object({
    slug,
    name: label,
    timezone: z.string().refine((v) => {
      try {
        new Intl.DateTimeFormat("en", { timeZone: v });
        return true;
      } catch {
        return false;
      }
    }),
    ownerName: label,
    ownerEmail: z.string().email().max(254),
    country: z.string().min(2).max(2),
    config: configSchema,
  })
  .strict();
export const updateConfigSchema = z
  .object({ version: z.number().int().positive(), config: configSchema })
  .strict();
export const businessProfileSchema = z
  .object({
    displayName: label,
    streetAddress: z.string().trim().max(160).default(""),
    suite: z.string().trim().max(80).default(""),
    city: z.string().trim().max(100).default(""),
    stateParish: z.string().trim().max(100).default(""),
    postalCode: z.string().trim().max(40).default(""),
    country: z.string().regex(/^[A-Z]{2}$/),
    email: z.string().email().max(254),
    phone: z.string().trim().max(40).default(""),
  })
  .strict();
export const authorizedContactSchema = z
  .object({
    name: label,
    email: z.string().email().max(254),
    phone: z.string().trim().max(40).default(""),
  })
  .strict();
export const roles = [
  "owner",
  "admin",
  "reservations",
  "dispatcher",
  "finance",
  "auditor",
  "guide",
  "driver",
  "resource_manager",
  "operations_manager",
  "partner_manager",
] as const;
export type Role = (typeof roles)[number];
export const grants: Record<Role, readonly string[]> = {
  owner: [
    "config.write",
    "members.write",
    "catalog.write",
    "catalog.read",
    "bookings.write",
    "bookings.read",
    "inventory.overbook",
    "payment.write",
    "payment.correct",
    "manifest.read",
    "operations.write",
    "waiver.template.publish",
    "resources.write",
    "documents.expiry.manage",
    "assignments.write",
    "safety.assignment.override",
    "checkin.write",
    "print.templates.manage",
    "print.jobs.create",
    "print.jobs.read",
    "partner.manage",
    "partner.collection.record",
    "partner.collection.verify",
    "partner.statement.read",
    "integration.manage",
    "integration.inbox.read",
    "notifications.request",
    "notifications.read",
    "audit.read",
  ],
  admin: [
    "config.write",
    "catalog.write",
    "catalog.read",
    "bookings.write",
    "bookings.read",
    "manifest.read",
    "operations.write",
    "resources.write",
    "documents.expiry.manage",
    "assignments.write",
    "checkin.write",
    "print.templates.manage",
    "print.jobs.create",
    "print.jobs.read",
    "partner.manage",
    "integration.manage",
    "integration.inbox.read",
    "notifications.request",
    "notifications.read",
  ],
  reservations: [
    "catalog.read",
    "bookings.write",
    "bookings.read",
    "payment.write",
    "manifest.read",
    "print.jobs.create",
    "print.jobs.read",
    "partner.collection.record",
    "notifications.request",
    "notifications.read",
  ],
  dispatcher: [
    "catalog.read",
    "bookings.read",
    "manifest.read",
    "operations.write",
    "assignments.write",
    "checkin.write",
    "print.jobs.create",
    "print.jobs.read",
  ],
  finance: [
    "catalog.read",
    "bookings.read",
    "payment.write",
    "payment.correct",
    "audit.read",
    "print.jobs.create",
    "print.jobs.read",
    "partner.collection.record",
    "partner.collection.verify",
    "partner.statement.read",
  ],
  auditor: [
    "catalog.read",
    "bookings.read",
    "manifest.read",
    "audit.read",
    "partner.statement.read",
    "integration.inbox.read",
    "notifications.read",
  ],
  guide: ["crew.trip.read", "checkin.write"],
  driver: ["crew.trip.read", "checkin.write"],
  resource_manager: [
    "catalog.read",
    "manifest.read",
    "resources.write",
    "documents.expiry.manage",
  ],
  operations_manager: [
    "catalog.read",
    "bookings.read",
    "inventory.overbook",
    "manifest.read",
    "operations.write",
    "resources.write",
    "documents.expiry.manage",
    "assignments.write",
    "checkin.write",
    "print.jobs.create",
    "print.jobs.read",
  ],
  partner_manager: ["catalog.read", "bookings.read", "partner.manage"],
};
export const memberSchema = z
  .object({
    name: label,
    email: z.string().email().max(254),
    role: z
      .string()
      .regex(/^[a-z][a-z0-9_]{1,80}$/)
      .refine((role) => role !== "owner", "Owner cannot be assigned here"),
  })
  .strict();
export const staffAddressSchema = z
  .object({
    street: z.string().trim().max(200).default(""),
    suite: z.string().trim().max(80).default(""),
    city: z.string().trim().max(100).default(""),
    stateParish: z.string().trim().max(100).default(""),
    postalCode: z.string().trim().max(30).default(""),
    country: z.string().trim().max(100).default(""),
  })
  .strict();
export const staffCreateSchema = z
  .object({
    firstName: label,
    lastName: z.string().trim().max(80).default(""),
    email: z.string().email().max(254),
    phone: z.string().trim().max(40).default(""),
    address: staffAddressSchema.default({
      street: "",
      suite: "",
      city: "",
      stateParish: "",
      postalCode: "",
      country: "",
    }),
    role: z
      .string()
      .regex(/^[a-z][a-z0-9_]{1,80}$/)
      .refine((role) => role !== "owner", "Owner cannot be assigned here"),
  })
  .strict();
export const staffUpdateSchema = z
  .object({
    firstName: label,
    lastName: z.string().trim().max(80).default(""),
    phone: z.string().trim().max(40).default(""),
    address: staffAddressSchema,
    role: z
      .string()
      .regex(/^[a-z][a-z0-9_]{1,80}$/)
      .refine((role) => role !== "owner", "Owner cannot be assigned here")
      .optional(),
    active: z.boolean().optional(),
  })
  .strict();
export const memberUpdateSchema = z
  .object({
    active: z.boolean(),
    role: z
      .string()
      .regex(/^[a-z][a-z0-9_]{1,80}$/)
      .refine((role) => role !== "owner", "Owner cannot be assigned here"),
  })
  .strict();
export const invitationSchema = z
  .object({
    name: label,
    email: z.string().email().max(254),
    role: z
      .string()
      .regex(/^[a-z][a-z0-9_]{1,80}$/)
      .refine((role) => role !== "owner", "Owner cannot be assigned here"),
  })
  .strict();
export const invitationAcceptSchema = z
  .object({
    token: z.string().regex(/^[a-zA-Z0-9_-]{40,100}$/),
    password: z.string().min(12).max(1024),
  })
  .strict();
export const roleSchema = z
  .object({
    name: label,
    permissions: z
      .array(z.string().regex(/^[a-z]+\.[a-z]+$/))
      .min(1)
      .max(40),
  })
  .strict();
export const userProfileSchema = z
  .object({
    name: label,
    email: z.string().email().max(254),
    phoneNumber: z.string().trim().max(30).default(""),
  })
  .strict();
export const productSchema = z
  .object({
    name: label,
    description: z.string().trim().max(2000).default(""),
    productKind: z
      .enum([
        "tour",
        "activity",
        "experience",
        "charter",
        "transport",
        "rental",
        "ticket",
      ])
      .default("tour"),
    availabilityMode: z
      .enum([
        "fixed_departure",
        "opening_hours",
        "open_dated",
        "on_request",
        "resource_window",
      ])
      .default("fixed_departure"),
    optionName: label,
    durationMinutes: z.number().int().min(1).max(10080),
    pricingModel: z
      .enum(["per_person", "per_group", "per_unit"])
      .default("per_person"),
    privateBooking: z.boolean().default(false),
    confirmationMode: z.enum(["instant", "request"]).default("instant"),
    categories: z
      .array(
        z.object({ slug, label, countsTowardCapacity: z.boolean() }).strict(),
      )
      .min(1)
      .max(10),
    rates: z
      .array(
        z
          .object({
            category: slug,
            startDate: day,
            endDate: day,
            amountMinor: z.number().int().min(0).max(1_000_000_000),
          })
          .strict(),
      )
      .min(1)
      .max(100),
  })
  .strict();
export type ProductInput = z.input<typeof productSchema>;
export const productUpdateSchema = productSchema
  .omit({ availabilityMode: true })
  .extend({
    version: z.number().int().positive(),
    status: z.enum(["active", "archived"]),
  })
  .strict();
const localTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
export const availabilityRuleUpdateSchema = z
  .object({
    version: z.number().int().positive(),
    status: z.enum(["active", "paused"]),
    name: label.optional(),
    startDate: day.optional(),
    endDate: day.optional(),
    weekdays: z.array(z.number().int().min(1).max(7)).min(1).max(7).optional(),
    localTimes: z.array(localTime).min(1).max(12).optional(),
    capacity: z.number().int().min(1).max(10000).optional(),
    blackoutDates: z.array(day).max(366).optional(),
  })
  .strict();
export const scheduleSchema = z
  .object({
    productId: id,
    name: label,
    startDate: day,
    endDate: day,
    weekdays: z.array(z.number().int().min(1).max(7)).min(1).max(7),
    localTimes: z.array(localTime).min(1).max(12),
    capacity: z.number().int().min(1).max(10000),
    blackoutDates: z.array(day).max(366),
  })
  .strict();
export const partySchema = z
  .record(slug, z.number().int().min(0).max(1000))
  .refine(
    (p) => Object.keys(p).length <= 10 && Object.values(p).some((v) => v > 0),
    "A party requires at least one passenger",
  );
export const holdSchema = z
  .object({ departureId: id, party: partySchema })
  .strict();
export const bookingConcessionSchema = z
  .object({
    discountMinor: z.number().int().min(1).max(1_000_000_000_000),
    reason: z.string().trim().min(3).max(500),
    promoCode: z.string().trim().max(40).default(""),
  })
  .strict();
export const bookingSchema = z
  .object({
    holdId: id,
    leadName: label,
    leadEmail: z.string().email().max(254),
    leadPhone: z.string().trim().max(40).default(""),
    purchaser: z
      .object({
        name: label,
        email: z.string().email().max(254),
        phone: z.string().trim().max(40).default(""),
      })
      .strict()
      .optional(),
    emergencyContact: z
      .object({
        name: label,
        phone: z.string().trim().min(1).max(40),
        relationship: z.string().trim().min(1).max(80),
      })
      .strict()
      .optional(),
    source: slug,
    pickup: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("none") }).strict(),
      z
        .object({
          kind: z.literal("unresolved"),
          note: z.string().trim().min(1).max(500),
        })
        .strict(),
      z
        .object({
          kind: z.literal("selected"),
          location: label,
          instructions: z.string().max(500),
        })
        .strict(),
    ]),
    stay: z
      .discriminatedUnion("kind", [
        z.object({ kind: z.literal("none") }).strict(),
        z
          .object({
            kind: z.literal("cruise"),
            vesselId: id.optional(),
            // Optional: the ship is recorded for the waiver and for emergency
            // contact, and "unknown" is a legitimate answer. Never substitute a
            // placeholder name — on a safety record an invented value is worse
            // than an absent one.
            vesselName: label.optional(),
            cabinNumber: z.string().trim().max(40).default(""),
          })
          .strict(),
        z
          .object({
            kind: z.literal("hotel"),
            accommodationId: id.optional(),
            hotelName: label,
            roomNumber: z.string().trim().max(40).default(""),
          })
          .strict(),
        z
          .object({
            kind: z.literal("private_accommodation"),
            propertyName: label,
            address: z.string().trim().min(1).max(300),
          })
          .strict(),
        z
          .object({
            kind: z.literal("local"),
            address: z.string().trim().max(300).default(""),
          })
          .strict(),
      ])
      .default({ kind: "none" }),
    concession: bookingConcessionSchema.optional(),
    partner: z
      .object({
        partnerId: id,
        externalReference: z.string().trim().max(120).default(""),
        collectionMode: z.enum([
          "guest_pays_tenant",
          "partner_collects_for_tenant",
          "partner_invoice",
        ]),
        invoiceRequired: z.boolean().default(false),
      })
      .optional(),
  })
  .strict();
export const paymentSchema = z
  .object({
    amountMinor: z.number().int().min(1).max(1_000_000_000_000),
    currency,
    method: slug,
    status: z.enum(["settled", "pending"]),
    reference: z.string().trim().max(120).default(""),
    reason: z.string().trim().max(500).default(""),
    occurredAt: z.string().datetime({ offset: true }),
    passengerId: z.string().uuid().optional(),
  })
  .strict();
export const paymentAdjustmentSchema = z
  .object({
    kind: z.enum(["void", "reversal"]),
    reference: z.string().trim().min(1).max(120),
    reason: z.string().trim().min(8).max(500),
    occurredAt: z.string().datetime({ offset: true }),
  })
  .strict();
export const confirmSchema = z
  .object({ version: z.number().int().positive() })
  .strict();
export type Quote = {
  lines: {
    category: string;
    quantity: number;
    unitAmountMinor: number;
    amountMinor: number;
  }[];
  subtotalMinor: number;
  taxMinor: number;
  totalMinor: number;
  /** Pricing mode this quote was computed under, frozen alongside the amounts
   *  so a quote still reads correctly if the tenant later flips the setting. */
  taxInclusive: boolean;
  currency: string;
  exchangeRate: {
    from: string;
    to: string;
    numerator: 1;
    denominator: 1;
    source: "same_currency";
  };
  configVersion: number;
  productVersion: number;
  minimumPaidPercent: number;
  allowUnresolvedPickup: boolean;
  discountMinor?: number;
  discountReason?: string;
  promoCode?: string;
};
export type Actor = {
  actorId: string;
  tenantId: string | null;
  platform: boolean;
  permissions: string[];
  role: string;
};

export const amendmentSchema = z
  .object({
    version: z.number().int().positive(),
    departureId: id,
    party: holdSchema.shape.party,
    leadName: bookingSchema.shape.leadName,
    leadEmail: bookingSchema.shape.leadEmail,
    leadPhone: z.string().trim().max(40).default(""),
    purchaser: bookingSchema.shape.purchaser,
    emergencyContact: bookingSchema.shape.emergencyContact,
    pickup: bookingSchema.shape.pickup,
    stay: bookingSchema.shape.stay.optional(),
    reason: z.string().trim().min(1).max(500),
  })
  .strict();
export const acceptAmendmentSchema = z
  .object({ version: z.number().int().positive(), quoteId: id })
  .strict();
export const cancellationSchema = z
  .object({
    version: z.number().int().positive(),
    reason: z.string().trim().min(1).max(500),
  })
  .strict();
