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
    bookingCurrency: currency,
    collectionCurrency: currency,
    reportingCurrency: currency,
    holdSeconds: z.number().int().min(30).max(1800),
    minimumPaidPercent: z.number().int().min(0).max(100),
    taxBasisPoints: z.number().int().min(0).max(10000),
    allowUnresolvedPickup: z.boolean(),
    allowAmendmentBalance: z.boolean().default(false),
    manualPaymentMethods: z.array(slug).min(1).max(20),
    bookingSources: z.array(slug).min(1).max(50),
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
    config: configSchema,
  })
  .strict();
export const updateConfigSchema = z
  .object({ version: z.number().int().positive(), config: configSchema })
  .strict();
export const roles = [
  "owner",
  "admin",
  "reservations",
  "dispatcher",
  "finance",
  "auditor",
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
    "payment.write",
    "manifest.read",
    "operations.write",
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
  ],
  reservations: [
    "catalog.read",
    "bookings.write",
    "bookings.read",
    "payment.write",
    "manifest.read",
  ],
  dispatcher: [
    "catalog.read",
    "bookings.read",
    "manifest.read",
    "operations.write",
  ],
  finance: ["catalog.read", "bookings.read", "payment.write", "audit.read"],
  auditor: ["catalog.read", "bookings.read", "manifest.read", "audit.read"],
};
export const memberSchema = z
  .object({
    name: label,
    email: z.string().email().max(254),
    role: z.enum(roles).exclude(["owner"]),
  })
  .strict();
export const memberUpdateSchema = z
  .object({ active: z.boolean(), role: z.enum(roles).exclude(["owner"]) })
  .strict();
export const productSchema = z
  .object({
    name: label,
    optionName: label,
    durationMinutes: z.number().int().min(1).max(1440),
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
export type ProductInput = z.infer<typeof productSchema>;
export const scheduleSchema = z
  .object({
    productId: id,
    startDate: day,
    endDate: day,
    weekdays: z.array(z.number().int().min(1).max(7)).min(1).max(7),
    localTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
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
export const bookingSchema = z
  .object({
    holdId: id,
    leadName: label,
    leadEmail: z.string().email().max(254),
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
  })
  .strict();
export const paymentSchema = z
  .object({
    amountMinor: z.number().int().min(1).max(1_000_000_000_000),
    currency,
    method: slug,
    status: z.enum(["settled", "pending"]),
    reference: z.string().trim().min(1).max(120),
    reason: z.string().trim().min(1).max(500),
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
    pickup: bookingSchema.shape.pickup,
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
