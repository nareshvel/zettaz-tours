"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.cancellationSchema = exports.acceptAmendmentSchema = exports.amendmentSchema = exports.confirmSchema = exports.paymentSchema = exports.bookingSchema = exports.holdSchema = exports.partySchema = exports.scheduleSchema = exports.productSchema = exports.memberUpdateSchema = exports.memberSchema = exports.grants = exports.roles = exports.updateConfigSchema = exports.tenantSchema = exports.configSchema = exports.id = void 0;
const zod_1 = require("zod");
exports.id = zod_1.z.string().uuid();
const label = zod_1.z.string().trim().min(1).max(120);
const slug = zod_1.z.string().regex(/^[a-z][a-z0-9_-]{1,49}$/);
const currency = zod_1.z
    .string()
    .length(3)
    .refine((v) => Intl.supportedValuesOf("currency").includes(v), "Unsupported ISO currency");
const day = zod_1.z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
exports.configSchema = zod_1.z
    .object({
    bookingCurrency: currency,
    collectionCurrency: currency,
    reportingCurrency: currency,
    holdSeconds: zod_1.z.number().int().min(30).max(1800),
    minimumPaidPercent: zod_1.z.number().int().min(0).max(100),
    taxBasisPoints: zod_1.z.number().int().min(0).max(10000),
    allowUnresolvedPickup: zod_1.z.boolean(),
    allowAmendmentBalance: zod_1.z.boolean().default(false),
    manualPaymentMethods: zod_1.z.array(slug).min(1).max(20),
    bookingSources: zod_1.z.array(slug).min(1).max(50),
})
    .strict()
    .refine((c) => c.bookingCurrency === c.collectionCurrency &&
    c.bookingCurrency === c.reportingCurrency, "Cross-currency collection/reporting requires the later FX workflow");
exports.tenantSchema = zod_1.z
    .object({
    slug,
    name: label,
    timezone: zod_1.z.string().refine((v) => {
        try {
            new Intl.DateTimeFormat("en", { timeZone: v });
            return true;
        }
        catch {
            return false;
        }
    }),
    ownerName: label,
    ownerEmail: zod_1.z.string().email().max(254),
    config: exports.configSchema,
})
    .strict();
exports.updateConfigSchema = zod_1.z
    .object({ version: zod_1.z.number().int().positive(), config: exports.configSchema })
    .strict();
exports.roles = [
    "owner",
    "admin",
    "reservations",
    "dispatcher",
    "finance",
    "auditor",
];
exports.grants = {
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
exports.memberSchema = zod_1.z
    .object({
    name: label,
    email: zod_1.z.string().email().max(254),
    role: zod_1.z.enum(exports.roles).exclude(["owner"]),
})
    .strict();
exports.memberUpdateSchema = zod_1.z
    .object({ active: zod_1.z.boolean(), role: zod_1.z.enum(exports.roles).exclude(["owner"]) })
    .strict();
exports.productSchema = zod_1.z
    .object({
    name: label,
    optionName: label,
    durationMinutes: zod_1.z.number().int().min(1).max(1440),
    categories: zod_1.z
        .array(zod_1.z.object({ slug, label, countsTowardCapacity: zod_1.z.boolean() }).strict())
        .min(1)
        .max(10),
    rates: zod_1.z
        .array(zod_1.z
        .object({
        category: slug,
        startDate: day,
        endDate: day,
        amountMinor: zod_1.z.number().int().min(0).max(1_000_000_000),
    })
        .strict())
        .min(1)
        .max(100),
})
    .strict();
exports.scheduleSchema = zod_1.z
    .object({
    productId: exports.id,
    startDate: day,
    endDate: day,
    weekdays: zod_1.z.array(zod_1.z.number().int().min(1).max(7)).min(1).max(7),
    localTime: zod_1.z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    capacity: zod_1.z.number().int().min(1).max(10000),
    blackoutDates: zod_1.z.array(day).max(366),
})
    .strict();
exports.partySchema = zod_1.z
    .record(slug, zod_1.z.number().int().min(0).max(1000))
    .refine((p) => Object.keys(p).length <= 10 && Object.values(p).some((v) => v > 0), "A party requires at least one passenger");
exports.holdSchema = zod_1.z
    .object({ departureId: exports.id, party: exports.partySchema })
    .strict();
exports.bookingSchema = zod_1.z
    .object({
    holdId: exports.id,
    leadName: label,
    leadEmail: zod_1.z.string().email().max(254),
    source: slug,
    pickup: zod_1.z.discriminatedUnion("kind", [
        zod_1.z.object({ kind: zod_1.z.literal("none") }).strict(),
        zod_1.z
            .object({
            kind: zod_1.z.literal("unresolved"),
            note: zod_1.z.string().trim().min(1).max(500),
        })
            .strict(),
        zod_1.z
            .object({
            kind: zod_1.z.literal("selected"),
            location: label,
            instructions: zod_1.z.string().max(500),
        })
            .strict(),
    ]),
})
    .strict();
exports.paymentSchema = zod_1.z
    .object({
    amountMinor: zod_1.z.number().int().min(1).max(1_000_000_000_000),
    currency,
    method: slug,
    status: zod_1.z.enum(["settled", "pending"]),
    reference: zod_1.z.string().trim().min(1).max(120),
    reason: zod_1.z.string().trim().min(1).max(500),
    occurredAt: zod_1.z.string().datetime({ offset: true }),
})
    .strict();
exports.confirmSchema = zod_1.z
    .object({ version: zod_1.z.number().int().positive() })
    .strict();
exports.amendmentSchema = zod_1.z
    .object({
    version: zod_1.z.number().int().positive(),
    departureId: exports.id,
    party: exports.holdSchema.shape.party,
    leadName: exports.bookingSchema.shape.leadName,
    leadEmail: exports.bookingSchema.shape.leadEmail,
    pickup: exports.bookingSchema.shape.pickup,
    reason: zod_1.z.string().trim().min(1).max(500),
})
    .strict();
exports.acceptAmendmentSchema = zod_1.z
    .object({ version: zod_1.z.number().int().positive(), quoteId: exports.id })
    .strict();
exports.cancellationSchema = zod_1.z
    .object({
    version: zod_1.z.number().int().positive(),
    reason: zod_1.z.string().trim().min(1).max(500),
})
    .strict();
