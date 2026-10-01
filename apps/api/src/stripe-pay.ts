/**
 * Zettaz Pay — Stripe Connect platform for traveler collections.
 *
 * Never import getStripe() from stripe-billing.ts here. SaaS Billing and
 * traveler money are two Stripe accounts, two keys, two webhook secrets.
 *
 *   STRIPE_PAY_SECRET_KEY              — sk_live_... (Zettaz Pay platform)
 *   STRIPE_PAY_WEBHOOK_SECRET          — whsec_... snapshot destination (connected accounts)
 *   STRIPE_PAY_THIN_WEBHOOK_SECRET     — whsec_... thin destination (v2 account events)
 *   ZETTAZ_PAY_APPLICATION_FEE_BPS     — platform cut in basis points (100 = 1%)
 *
 * Money model
 * - Direct charges on the tenant's connected account (tenant is merchant of
 *   record, Stripe collects fees and losses from the tenant).
 * - A paid Checkout Session posts one settled `zettaz_pay` row in payments.
 * - Refunds and lost disputes reverse the live row and re-post what is left,
 *   so every existing "paid" query keeps working without change.
 * - Browser redirects never post money; only signed webhooks do.
 */
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Headers,
  HttpCode,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Post,
  Req,
  Res,
} from "@nestjs/common";
import Stripe from "stripe";
import QRCode from "qrcode";
import { randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import { Database, digest, record, Tx } from "./database";
import type { Actor } from "../../../packages/shared/src/contracts";
import { Access, CurrentActor, keySchema, parse } from "./http";
import type {
  Request as ExpressRequest,
  Response as ExpressResponse,
} from "express";

const STRIPE_API_VERSION = "2026-08-26.dahlia";
let clientOverride: Stripe | null = null;

/** Tests inject a fake client; production always builds from the env key. */
export function setStripePayClientForTests(client: Stripe | null) {
  clientOverride = client;
  platformReadyCache = null;
}

export function getStripePay(): Stripe {
  if (clientOverride) return clientOverride;
  const key = process.env.STRIPE_PAY_SECRET_KEY;
  if (!key) throw new Error("STRIPE_PAY_SECRET_KEY is not set");
  if (process.env.STRIPE_SECRET_KEY && key === process.env.STRIPE_SECRET_KEY) {
    throw new Error(
      "STRIPE_PAY_SECRET_KEY must not equal STRIPE_SECRET_KEY (SaaS Billing).",
    );
  }
  return new Stripe(key, { apiVersion: STRIPE_API_VERSION });
}

/** Signature checks need no API key; keep them independent of the live client. */
const webhookVerifier = new Stripe("sk_webhook_verify_only", {
  apiVersion: STRIPE_API_VERSION,
});

/** Launch default 1%. Override with ZETTAZ_PAY_APPLICATION_FEE_BPS. */
export function zettazPayApplicationFeeBps(): number {
  const n = Number(process.env.ZETTAZ_PAY_APPLICATION_FEE_BPS ?? "100");
  if (!Number.isFinite(n) || n < 0 || n > 10_000) return 100;
  return Math.round(n);
}

export function zettazPayApplicationFeeAmount(chargeMinor: number): number {
  if (chargeMinor <= 0) return 0;
  return Math.round((chargeMinor * zettazPayApplicationFeeBps()) / 10_000);
}

export function zettazPayConfigured(): boolean {
  return Boolean(clientOverride || process.env.STRIPE_PAY_SECRET_KEY);
}

/**
 * Countries where a tenant's legal entity can hold a Stripe merchant account.
 * The merchant country is the country of the registered business and bank
 * account (for example a US LLC operating tours in Antigua), not where the
 * tours run. Stripe still decides final eligibility during onboarding.
 */
export const ZETTAZ_PAY_MERCHANT_COUNTRIES: ReadonlyArray<{
  code: string;
  name: string;
}> = [
  { code: "US", name: "United States" },
  { code: "GB", name: "United Kingdom" },
  { code: "CA", name: "Canada" },
  { code: "IE", name: "Ireland" },
  { code: "NL", name: "Netherlands" },
  { code: "FR", name: "France" },
  { code: "DE", name: "Germany" },
  { code: "ES", name: "Spain" },
  { code: "PT", name: "Portugal" },
  { code: "IT", name: "Italy" },
  { code: "BE", name: "Belgium" },
  { code: "LU", name: "Luxembourg" },
  { code: "AT", name: "Austria" },
  { code: "CH", name: "Switzerland" },
  { code: "DK", name: "Denmark" },
  { code: "SE", name: "Sweden" },
  { code: "NO", name: "Norway" },
  { code: "FI", name: "Finland" },
  { code: "PL", name: "Poland" },
  { code: "CZ", name: "Czech Republic" },
  { code: "GR", name: "Greece" },
  { code: "CY", name: "Cyprus" },
  { code: "MT", name: "Malta" },
  { code: "EE", name: "Estonia" },
  { code: "LV", name: "Latvia" },
  { code: "LT", name: "Lithuania" },
  { code: "SK", name: "Slovakia" },
  { code: "SI", name: "Slovenia" },
  { code: "HR", name: "Croatia" },
  { code: "HU", name: "Hungary" },
  { code: "RO", name: "Romania" },
  { code: "BG", name: "Bulgaria" },
  { code: "LI", name: "Liechtenstein" },
  { code: "GI", name: "Gibraltar" },
  { code: "AU", name: "Australia" },
  { code: "NZ", name: "New Zealand" },
  { code: "SG", name: "Singapore" },
  { code: "HK", name: "Hong Kong" },
  { code: "JP", name: "Japan" },
  { code: "MY", name: "Malaysia" },
  { code: "TH", name: "Thailand" },
  { code: "AE", name: "United Arab Emirates" },
  { code: "MX", name: "Mexico" },
  { code: "BR", name: "Brazil" },
];
const merchantCountryCodes = new Set(
  ZETTAZ_PAY_MERCHANT_COUNTRIES.map((c) => c.code),
);

/**
 * Booking amounts are stored with two decimal places. Stripe treats these
 * currencies differently, so they cannot be charged without a conversion rule.
 */
const UNSUPPORTED_CURRENCIES = new Set([
  "BIF",
  "CLP",
  "DJF",
  "GNF",
  "JPY",
  "KMF",
  "KRW",
  "MGA",
  "PYG",
  "RWF",
  "UGX",
  "VND",
  "VUV",
  "XAF",
  "XOF",
  "XPF",
  "BHD",
  "JOD",
  "KWD",
  "OMR",
  "TND",
]);
export function zettazPayCurrencySupported(currency: string): boolean {
  return /^[A-Z]{3}$/.test(currency) && !UNSUPPORTED_CURRENCIES.has(currency);
}

function webOrigin() {
  return (process.env.WEB_ORIGIN ?? "http://127.0.0.1:3191").replace(/\/$/, "");
}

export function zettazPayLinkUrl(token: string) {
  return `${webOrigin()}/pay/${token}`;
}

export type ZettazPayStatus = {
  brand: "Zettaz Pay";
  platformConfigured: boolean;
  /** False until the Zettaz Pay Stripe platform account itself is activated. */
  platformReady: boolean;
  applicationFeeBps: number;
  accountId: string | null;
  merchantCountry: string | null;
  chargesEnabled: boolean;
  requirementsDue: boolean;
  requirementsDeadline: string | null;
  readyForCheckout: boolean;
  merchantCountries: typeof ZETTAZ_PAY_MERCHANT_COUNTRIES;
};

type AccountRow = {
  account_id: string;
  merchant_country: string;
  charges_enabled: boolean;
  requirements_due: boolean;
  requirements_deadline: string | null;
  synced_at: string | null;
};

type CheckoutRow = {
  id: string;
  booking_id: string;
  request_id: string | null;
  session_id: string;
  account_id: string;
  amount_minor: string;
  currency: string;
  fee_minor: string;
  status: "open" | "paid" | "expired";
  origin: "staff" | "pay_link";
  payment_intent_id: string | null;
  payment_id: string | null;
  paid_minor: string | null;
  paid_at: string | null;
  expires_at: string;
  created_at: string;
};

type BookingFacts = {
  id: string;
  state: string;
  source: string;
  lead_name: string;
  lead_email: string | null;
  hold_live: boolean;
  total_minor: string;
  currency: string;
  paid_minor: string;
  credit_minor: string;
  product_name: string;
  starts_at: string;
  tenant_name: string;
  timezone: string | null;
  collection_mode: string | null;
};

function isPlatformActivationError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    /must be activated/i.test(message) ||
    /activate your accounts/i.test(message)
  );
}

function payStripeMessage(error: unknown, fallback: string): string {
  if (isPlatformActivationError(error)) {
    return "Zettaz Pay’s Stripe platform account is not activated yet. Guest checkout stays off until that is finished in Stripe.";
  }
  const message = error instanceof Error ? error.message : "";
  return message ? `${fallback} ${message}` : fallback;
}

let platformReadyCache: { value: boolean; at: number } | null = null;
async function readPlatformReady(): Promise<boolean> {
  if (!zettazPayConfigured()) return false;
  if (platformReadyCache && Date.now() - platformReadyCache.at < 5 * 60_000)
    return platformReadyCache.value;
  let value: boolean;
  try {
    const me = await getStripePay().accounts.retrieveCurrent();
    value = Boolean(me.charges_enabled);
  } catch (error) {
    // A transient outage should not flip the gateway off for every tenant.
    value = !isPlatformActivationError(error);
  }
  platformReadyCache = { value, at: Date.now() };
  return value;
}

type MerchantSnapshot = {
  chargesEnabled: boolean;
  requirementsDue: boolean;
  requirementsDeadline: string | null;
};

function merchantSnapshot(account: unknown): MerchantSnapshot {
  const rec = account as {
    configuration?: {
      merchant?: { capabilities?: { card_payments?: { status?: string } } };
    };
    requirements?: {
      entries?: Array<{ awaiting_action_from?: string }>;
      summary?: { minimum_deadline?: { time?: string } };
    };
  };
  const entries = rec.requirements?.entries ?? [];
  return {
    chargesEnabled:
      rec.configuration?.merchant?.capabilities?.card_payments?.status ===
      "active",
    requirementsDue: entries.some((e) => e.awaiting_action_from === "user"),
    requirementsDeadline:
      rec.requirements?.summary?.minimum_deadline?.time ?? null,
  };
}

async function retrieveMerchant(accountId: string): Promise<MerchantSnapshot> {
  const account = await getStripePay().v2.core.accounts.retrieve(accountId, {
    include: ["configuration.merchant", "requirements"],
  });
  return merchantSnapshot(account);
}

function systemActor(tenantId: string): Actor {
  return {
    actorId: "00000000-0000-0000-0000-000000000001",
    tenantId,
    platform: false,
    permissions: [],
    role: "system",
  };
}

const onboardSchema = z
  .object({
    merchantCountry: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{2}$/)
      .optional(),
    returnUrl: z.string().max(500).optional(),
    refreshUrl: z.string().max(500).optional(),
  })
  .strict();
const checkoutSchema = z
  .object({
    amountMinor: z.number().int().positive().max(1_000_000_000_000).optional(),
    successUrl: z.string().max(500).optional(),
    cancelUrl: z.string().max(500).optional(),
  })
  .strict();
const linkSchema = z
  .object({
    amountMinor: z.number().int().positive().max(1_000_000_000_000).optional(),
    channel: z.enum(["qr", "link"]).default("link"),
  })
  .strict();
const refundSchema = z
  .object({
    checkoutId: z.string().uuid(),
    amountMinor: z.number().int().positive().max(1_000_000_000_000),
    reason: z.string().trim().min(3).max(500),
  })
  .strict();
const uuid = z.string().uuid();
const tokenSchema = z.string().regex(/^[A-Za-z0-9_-]{32,64}$/);

/** Only accept redirect targets on our own web origin. */
function ownUrl(candidate: string | undefined, fallback: string) {
  if (!candidate) return fallback;
  return candidate.startsWith(`${webOrigin()}/`) ? candidate : fallback;
}

@Injectable()
export class ZettazPayService {
  constructor(private readonly db: Database) {}

  // ── Merchant account ───────────────────────────────────────────────────────

  private async readAccount(tx: Tx, tenantId: string) {
    const {
      rows: [row],
    } = await tx.query<AccountRow>(
      `SELECT account_id,merchant_country,charges_enabled,requirements_due,
              requirements_deadline,synced_at
         FROM zettaz_pay_accounts WHERE tenant_id=$1`,
      [tenantId],
    );
    return row ?? null;
  }

  private async storeSnapshot(
    tenantId: string,
    accountId: string,
    snap: MerchantSnapshot,
  ) {
    await this.db.transaction(systemActor(tenantId), async (tx) => {
      await tx.query(
        `UPDATE zettaz_pay_accounts
            SET charges_enabled=$3,requirements_due=$4,requirements_deadline=$5,synced_at=clock_timestamp()
          WHERE tenant_id=$1 AND account_id=$2`,
        [
          tenantId,
          accountId,
          snap.chargesEnabled,
          snap.requirementsDue,
          snap.requirementsDeadline,
        ],
      );
    });
  }

  async status(actor: Actor): Promise<ZettazPayStatus> {
    const tenantId = actor.tenantId!;
    let row = await this.db.transaction(actor, (tx) =>
      this.readAccount(tx, tenantId),
    );
    const platformConfigured = zettazPayConfigured();
    if (platformConfigured && row) {
      try {
        const snap = await retrieveMerchant(row.account_id);
        if (
          snap.chargesEnabled !== row.charges_enabled ||
          snap.requirementsDue !== row.requirements_due ||
          snap.requirementsDeadline !== row.requirements_deadline
        )
          await this.storeSnapshot(tenantId, row.account_id, snap);
        row = {
          ...row,
          charges_enabled: snap.chargesEnabled,
          requirements_due: snap.requirementsDue,
          requirements_deadline: snap.requirementsDeadline,
        };
      } catch {
        // Keep stored flags if Stripe is unreachable.
      }
    }
    const platformReady = platformConfigured
      ? await readPlatformReady()
      : false;
    const chargesEnabled = Boolean(row?.charges_enabled);
    return {
      brand: "Zettaz Pay",
      platformConfigured,
      platformReady,
      applicationFeeBps: zettazPayApplicationFeeBps(),
      accountId: row?.account_id ?? null,
      merchantCountry: row?.merchant_country ?? null,
      chargesEnabled,
      requirementsDue: Boolean(row?.requirements_due),
      requirementsDeadline: row?.requirements_deadline
        ? new Date(row.requirements_deadline).toISOString()
        : null,
      readyForCheckout: platformConfigured && platformReady && chargesEnabled,
      merchantCountries: ZETTAZ_PAY_MERCHANT_COUNTRIES,
    };
  }

  /** Cheap readiness check from stored state (no Stripe call). */
  async readyFromStore(tx: Tx, tenantId: string): Promise<boolean> {
    if (!zettazPayConfigured()) return false;
    const row = await this.readAccount(tx, tenantId);
    return Boolean(row?.charges_enabled);
  }

  async startOnboarding(actor: Actor, raw: unknown): Promise<{ url: string }> {
    const input = parse(onboardSchema, raw ?? {});
    if (!zettazPayConfigured())
      throw new BadRequestException(
        "Zettaz Pay is not connected on this server yet.",
      );
    if (!(await readPlatformReady()))
      throw new BadRequestException(
        "Zettaz Pay’s Stripe platform account is not activated yet. Guest checkout stays off until that is finished in Stripe.",
      );
    const tenantId = actor.tenantId!;
    const stripe = getStripePay();
    const { existing, profile } = await this.db.transaction(
      actor,
      async (tx) => {
        const {
          rows: [t],
        } = await tx.query<{
          name: string;
          business_profile: { email?: string; displayName?: string } | null;
        }>("SELECT name,business_profile FROM tenants WHERE id=$1", [tenantId]);
        if (!t) throw new NotFoundException("Tenant not found.");
        return { existing: await this.readAccount(tx, tenantId), profile: t };
      },
    );
    let accountId = existing?.account_id;
    if (!accountId) {
      const country = input.merchantCountry;
      if (!country || !merchantCountryCodes.has(country))
        throw new BadRequestException(
          "Choose the country where this business is registered and banks. Stripe needs a business and bank account in a supported country.",
        );
      try {
        const created = await stripe.v2.core.accounts.create(
          {
            display_name: (
              profile.business_profile?.displayName || profile.name
            ).slice(0, 150),
            contact_email: profile.business_profile?.email || undefined,
            dashboard: "full",
            identity: { country: country.toLowerCase() },
            defaults: {
              responsibilities: {
                fees_collector: "stripe",
                losses_collector: "stripe",
              },
            },
            configuration: {
              merchant: {
                capabilities: { card_payments: { requested: true } },
              },
            },
            metadata: { tenantId },
          } as never,
          { idempotencyKey: `zettaz-pay-account-${tenantId}-${country}` },
        );
        accountId = String((created as { id: string }).id);
      } catch (error) {
        throw new BadRequestException(
          payStripeMessage(
            error,
            "Stripe could not create the merchant account.",
          ),
        );
      }
      await this.db.transaction(actor, async (tx) => {
        await tx.query(
          `INSERT INTO zettaz_pay_accounts(tenant_id,account_id,merchant_country,created_by)
           VALUES($1,$2,$3,$4) ON CONFLICT (tenant_id) DO NOTHING`,
          [tenantId, accountId, country, actor.actorId],
        );
        await record(tx, actor, "zettaz_pay.account_created", tenantId, null, {
          accountId,
          merchantCountry: country,
        });
      });
    }
    const fallback = `${webOrigin()}/settings?tab=payments`;
    try {
      const link = await stripe.v2.core.accountLinks.create({
        account: accountId,
        use_case: {
          type: "account_onboarding",
          account_onboarding: {
            configurations: ["merchant"],
            refresh_url: ownUrl(input.refreshUrl, fallback),
            return_url: ownUrl(input.returnUrl, fallback),
          },
        },
      } as never);
      const url = String(
        (link as { url?: string }).url ??
          (link as { account_link?: { url?: string } }).account_link?.url ??
          "",
      );
      if (!url) throw new Error("No onboarding URL returned.");
      return { url };
    } catch (error) {
      throw new BadRequestException(
        payStripeMessage(error, "Stripe onboarding link failed."),
      );
    }
  }

  // ── Booking facts and checkout ─────────────────────────────────────────────

  private async bookingFacts(
    tx: Tx,
    tenantId: string,
    bookingId: string,
  ): Promise<BookingFacts> {
    const {
      rows: [row],
    } = await tx.query<BookingFacts>(
      `SELECT b.id,b.state,b.source,b.lead_name,b.lead_email,
              h.expires_at>clock_timestamp() AS hold_live,
              (h.quote->>'totalMinor')::bigint::text AS total_minor,
              h.quote->>'currency' AS currency,
              COALESCE((SELECT SUM(p.amount_minor) FROM payments p
                 WHERE p.tenant_id=b.tenant_id AND p.booking_id=b.id AND p.status='settled'
                 AND NOT EXISTS (SELECT 1 FROM payment_adjustments a
                   WHERE a.tenant_id=p.tenant_id AND a.payment_id=p.id)),0)::text AS paid_minor,
              COALESCE((SELECT SUM(c.amount_minor) FROM partner_collection_claims c
                 JOIN partner_claim_decisions d ON d.tenant_id=c.tenant_id AND d.claim_id=c.id AND d.decision='accepted'
                 WHERE c.tenant_id=b.tenant_id AND c.booking_id=b.id),0)::text AS credit_minor,
              COALESCE(NULLIF(pr.customer_title,''),NULLIF(pr.name,''),'Tour reservation') AS product_name,
              d.starts_at,
              t.name AS tenant_name,
              t.config->>'timezone' AS timezone,
              (SELECT a.collection_mode FROM booking_partner_attributions a
                 WHERE a.tenant_id=b.tenant_id AND a.booking_id=b.id) AS collection_mode
         FROM bookings b
         JOIN holds h ON h.tenant_id=b.tenant_id AND h.id=b.hold_id
         JOIN departures d ON d.tenant_id=b.tenant_id AND d.id=b.departure_id
         JOIN products pr ON pr.tenant_id=d.tenant_id AND pr.id=d.product_id
         JOIN tenants t ON t.id=b.tenant_id
        WHERE b.tenant_id=$1 AND b.id=$2`,
      [tenantId, bookingId],
    );
    if (!row) throw new NotFoundException("Booking not found.");
    return row;
  }

  private remaining(b: BookingFacts) {
    return (
      Number(b.total_minor) - Number(b.paid_minor) - Number(b.credit_minor)
    );
  }

  private collectible(b: BookingFacts): string | null {
    if (b.state === "cancelled") return "This booking was cancelled.";
    if (b.state === "expired" || (b.state === "held" && !b.hold_live))
      return "This reservation hold has expired. Contact the operator to restore it.";
    if (b.collection_mode === "partner_invoice")
      return "This booking is settled through a partner invoice.";
    if (!zettazPayCurrencySupported(b.currency))
      return `Card payments in ${b.currency} are not supported yet.`;
    if (this.remaining(b) <= 0) return "There is no balance to pay.";
    return null;
  }

  /**
   * Create a hosted Checkout Session on the tenant's connected account.
   * Expires any older open sessions for the booking first, so a guest cannot
   * pay twice from two tabs.
   */
  private async createSession(input: {
    tenantId: string;
    actor: Actor;
    bookingId: string;
    requestedMinor?: number;
    requestId: string | null;
    origin: "staff" | "pay_link";
    successUrl: string;
    cancelUrl: string;
  }): Promise<{ url: string; checkoutId: string; amountMinor: number }> {
    if (!zettazPayConfigured())
      throw new BadRequestException(
        "Zettaz Pay is not connected on this server yet.",
      );
    if (!(await readPlatformReady()))
      throw new BadRequestException(
        "Zettaz Pay’s Stripe platform account is not activated yet.",
      );
    const { account, booking, stale } = await this.db.transaction(
      input.actor,
      async (tx) => ({
        account: await this.readAccount(tx, input.tenantId),
        booking: await this.bookingFacts(tx, input.tenantId, input.bookingId),
        stale: (
          await tx.query<{
            id: string;
            session_id: string;
            account_id: string;
          }>(
            `SELECT id,session_id,account_id FROM zettaz_pay_checkouts
              WHERE tenant_id=$1 AND booking_id=$2 AND status='open'`,
            [input.tenantId, input.bookingId],
          )
        ).rows,
      }),
    );
    if (!account)
      throw new BadRequestException(
        "This business has not set up Zettaz Pay yet.",
      );
    const stripe = getStripePay();
    let chargesEnabled = account.charges_enabled;
    try {
      const snap = await retrieveMerchant(account.account_id);
      chargesEnabled = snap.chargesEnabled;
      if (snap.chargesEnabled !== account.charges_enabled)
        await this.storeSnapshot(input.tenantId, account.account_id, snap);
    } catch {
      // Fall back to the stored flag; Stripe rejects the session if it is wrong.
    }
    if (!chargesEnabled)
      throw new BadRequestException(
        "Zettaz Pay is not ready to take cards yet. Finish Stripe onboarding in Settings → Payment integrations.",
      );
    const blocked = this.collectible(booking);
    if (blocked) throw new BadRequestException(blocked);
    const remaining = this.remaining(booking);
    const amount = Math.min(input.requestedMinor ?? remaining, remaining);
    if (!Number.isSafeInteger(amount) || amount <= 0)
      throw new BadRequestException("There is no balance to pay.");
    if (input.requestedMinor && input.requestedMinor > remaining)
      throw new BadRequestException("The amount is more than the balance due.");

    for (const old of stale) {
      try {
        await stripe.checkout.sessions.expire(
          old.session_id,
          {},
          { stripeAccount: old.account_id },
        );
      } catch {
        // Already completed or expired on Stripe; the webhook reconciles it.
      }
      await this.db.transaction(input.actor, (tx) =>
        tx.query(
          `UPDATE zettaz_pay_checkouts SET status='expired'
            WHERE tenant_id=$1 AND id=$2 AND status='open'`,
          [input.tenantId, old.id],
        ),
      );
    }

    const checkoutId = randomUUID();
    const fee = zettazPayApplicationFeeAmount(amount);
    const currency = booking.currency.toLowerCase();
    const expiresAt = Math.floor(Date.now() / 1000) + 60 * 60;
    const ref = booking.id.slice(0, 8).toUpperCase();
    const metadata = {
      tenantId: input.tenantId,
      bookingId: booking.id,
      checkoutId,
      purpose: "zettaz_pay_booking",
    };
    let session: Stripe.Checkout.Session;
    try {
      session = await stripe.checkout.sessions.create(
        {
          mode: "payment",
          client_reference_id: booking.id,
          success_url: input.successUrl,
          cancel_url: input.cancelUrl,
          expires_at: expiresAt,
          ...(booking.lead_email ? { customer_email: booking.lead_email } : {}),
          metadata,
          line_items: [
            {
              quantity: 1,
              price_data: {
                currency,
                unit_amount: amount,
                product_data: {
                  name: booking.product_name.slice(0, 120),
                  description: `Booking ${ref}`,
                },
              },
            },
          ],
          payment_intent_data: {
            application_fee_amount: fee,
            description: `${booking.product_name.slice(0, 80)} · Booking ${ref}`,
            metadata,
          },
        },
        { stripeAccount: account.account_id, idempotencyKey: checkoutId },
      );
    } catch (error) {
      throw new BadRequestException(
        payStripeMessage(error, "Could not start card checkout."),
      );
    }
    if (!session.url)
      throw new BadRequestException("Stripe did not return a checkout page.");
    await this.db.transaction(input.actor, async (tx) => {
      await tx.query(
        `INSERT INTO zettaz_pay_checkouts(
           tenant_id,id,booking_id,request_id,session_id,account_id,amount_minor,currency,
           fee_minor,status,origin,expires_at,created_by)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'open',$10,to_timestamp($11),$12)`,
        [
          input.tenantId,
          checkoutId,
          booking.id,
          input.requestId,
          session.id,
          account.account_id,
          amount,
          booking.currency,
          fee,
          input.origin,
          expiresAt,
          input.origin === "staff" ? input.actor.actorId : null,
        ],
      );
    });
    return { url: session.url, checkoutId, amountMinor: amount };
  }

  async staffCheckout(actor: Actor, bookingId: string, raw: unknown) {
    const input = parse(checkoutSchema, raw ?? {});
    const here = `${webOrigin()}/reservations/${bookingId}`;
    const result = await this.createSession({
      tenantId: actor.tenantId!,
      actor,
      bookingId,
      requestedMinor: input.amountMinor,
      requestId: null,
      origin: "staff",
      successUrl: ownUrl(input.successUrl, `${here}?pay=ok`),
      cancelUrl: ownUrl(input.cancelUrl, `${here}?pay=cancel`),
    });
    return { url: result.url, amountMinor: result.amountMinor };
  }

  // ── Pay links (email, QR, copy link) ───────────────────────────────────────

  /** Insert a pay link inside an existing transaction. Returns the raw token once. */
  async createLinkInTx(
    tx: Tx,
    actor: Actor,
    bookingId: string,
    opts: { amountMinor?: number; channel: "email" | "qr" | "link" },
  ) {
    const tenantId = actor.tenantId!;
    if (!(await this.readyFromStore(tx, tenantId)))
      throw new BadRequestException(
        "Zettaz Pay is not ready to take cards for this business yet.",
      );
    const booking = await this.bookingFacts(tx, tenantId, bookingId);
    const blocked = this.collectible(booking);
    if (blocked) throw new BadRequestException(blocked);
    const remaining = this.remaining(booking);
    if (opts.amountMinor && opts.amountMinor > remaining)
      throw new BadRequestException("The amount is more than the balance due.");
    const token = randomBytes(24).toString("base64url");
    const requestId = randomUUID();
    // Links stay usable for 30 days or until the trip, whichever is later
    // than now + 1 day; the balance is re-checked every time they are opened.
    const {
      rows: [row],
    } = await tx.query<{ expires_at: string }>(
      `INSERT INTO zettaz_pay_requests(tenant_id,id,booking_id,token_hash,amount_minor,currency,channel,expires_at,created_by)
       VALUES($1,$2,$3,$4,$5,$6,$7,
         GREATEST(clock_timestamp()+interval '1 day', LEAST(clock_timestamp()+interval '30 days', $8::timestamptz)),$9)
       RETURNING expires_at`,
      [
        tenantId,
        requestId,
        bookingId,
        digest(token),
        opts.amountMinor ?? null,
        booking.currency,
        opts.channel,
        booking.starts_at,
        actor.actorId,
      ],
    );
    await record(tx, actor, "zettaz_pay.link_created", requestId, null, {
      bookingId,
      channel: opts.channel,
      amountMinor: opts.amountMinor ?? null,
    });
    return {
      requestId,
      url: zettazPayLinkUrl(token),
      expiresAt: new Date(row!.expires_at).toISOString(),
      amountMinor: opts.amountMinor ?? remaining,
      currency: booking.currency,
    };
  }

  async createLink(actor: Actor, bookingId: string, key: string, raw: unknown) {
    const input = parse(linkSchema, raw ?? {});
    const created = await this.db.command(
      actor,
      `zettaz_pay.link:${bookingId}`,
      key,
      input,
      (tx) =>
        this.createLinkInTx(tx, actor, bookingId, {
          amountMinor: input.amountMinor,
          channel: input.channel,
        }),
    );
    return {
      ...created,
      qrDataUrl: await QRCode.toDataURL(created.url, {
        errorCorrectionLevel: "M",
        margin: 1,
        width: 320,
        color: { dark: "#142f36", light: "#ffffff" },
      }),
    };
  }

  async cancelLink(actor: Actor, bookingId: string, requestId: string) {
    return this.db.transaction(actor, async (tx) => {
      const { rowCount } = await tx.query(
        `UPDATE zettaz_pay_requests SET status='cancelled',cancelled_at=clock_timestamp()
          WHERE tenant_id=$1 AND booking_id=$2 AND id=$3 AND status='open'`,
        [actor.tenantId, bookingId, requestId],
      );
      if (!rowCount) throw new NotFoundException("Open pay link not found.");
      await record(tx, actor, "zettaz_pay.link_cancelled", requestId, null, {
        bookingId,
      });
      return { requestId, status: "cancelled" };
    });
  }

  private async resolveToken(token: string) {
    const {
      rows: [row],
    } = await this.db.pool.query<{ tenant_id: string; request_id: string }>(
      "SELECT * FROM zettaz_pay_resolve_request($1)",
      [digest(token)],
    );
    if (!row) throw new NotFoundException("This payment link is not valid.");
    return row;
  }

  /** Public summary for the guest pay page. Never exposes ids or contact data. */
  async publicLink(rawToken: string) {
    const token = parse(tokenSchema, rawToken);
    const { tenant_id: tenantId, request_id: requestId } =
      await this.resolveToken(token);
    return this.db.transaction(systemActor(tenantId), async (tx) => {
      const {
        rows: [req],
      } = await tx.query<{
        booking_id: string;
        amount_minor: string | null;
        status: string;
        expired: boolean;
      }>(
        `SELECT booking_id,amount_minor,status,expires_at<=clock_timestamp() AS expired
           FROM zettaz_pay_requests WHERE tenant_id=$1 AND id=$2`,
        [tenantId, requestId],
      );
      const b = await this.bookingFacts(tx, tenantId, req!.booking_id);
      const remaining = this.remaining(b);
      const amount =
        req!.amount_minor === null
          ? remaining
          : Math.min(Number(req!.amount_minor), remaining);
      const blocked =
        req!.status === "cancelled"
          ? "This payment link was withdrawn. Contact the operator for a new one."
          : req!.status === "paid" || remaining <= 0
            ? null
            : req!.expired
              ? "This payment link has expired. Contact the operator for a new one."
              : this.collectible(b);
      const ready = await this.readyFromStore(tx, tenantId);
      return {
        businessName: b.tenant_name,
        productName: b.product_name,
        startsAt: new Date(b.starts_at).toISOString(),
        timezone: b.timezone ?? "UTC",
        guestFirstName: (b.lead_name || "").split(/\s+/)[0] ?? "",
        bookingRef: b.id.slice(0, 8).toUpperCase(),
        currency: b.currency,
        totalMinor: Number(b.total_minor),
        paidMinor: Number(b.paid_minor) + Number(b.credit_minor),
        amountDueMinor: Math.max(0, amount),
        status:
          req!.status === "paid" || remaining <= 0
            ? "paid"
            : blocked || !ready
              ? "unavailable"
              : "open",
        message:
          blocked ??
          (!ready
            ? "Card payments are paused for this business. Contact the operator."
            : null),
      };
    });
  }

  private publicAttempts = new Map<string, number[]>();
  async publicCheckout(rawToken: string) {
    const token = parse(tokenSchema, rawToken);
    const now = Date.now();
    const recent = (this.publicAttempts.get(token) ?? []).filter(
      (t) => now - t < 10 * 60_000,
    );
    if (recent.length >= 8)
      throw new ConflictException(
        "Too many attempts. Wait a few minutes and try again.",
      );
    recent.push(now);
    this.publicAttempts.set(token, recent);
    if (this.publicAttempts.size > 5000) this.publicAttempts.clear();

    const { tenant_id: tenantId, request_id: requestId } =
      await this.resolveToken(token);
    const owner = await this.ownerActor(tenantId);
    const req = await this.db.transaction(owner, async (tx) => {
      const {
        rows: [row],
      } = await tx.query<{
        booking_id: string;
        amount_minor: string | null;
        status: string;
        expired: boolean;
      }>(
        `SELECT booking_id,amount_minor,status,expires_at<=clock_timestamp() AS expired
           FROM zettaz_pay_requests WHERE tenant_id=$1 AND id=$2 FOR UPDATE`,
        [tenantId, requestId],
      );
      return row!;
    });
    if (req.status !== "open" || req.expired)
      throw new BadRequestException(
        req.status === "paid"
          ? "This booking is already paid."
          : "This payment link is no longer active. Contact the operator for a new one.",
      );
    // Reuse a fresh open session for this link instead of minting a new one
    // every time the guest taps the button.
    const reusable = await this.db.transaction(owner, async (tx) => {
      const {
        rows: [row],
      } = await tx.query<{ session_id: string; account_id: string }>(
        `SELECT session_id,account_id FROM zettaz_pay_checkouts
          WHERE tenant_id=$1 AND request_id=$2 AND status='open'
            AND created_at>clock_timestamp()-interval '20 minutes'
            AND expires_at>clock_timestamp()+interval '10 minutes'
          ORDER BY created_at DESC LIMIT 1`,
        [tenantId, requestId],
      );
      return row ?? null;
    });
    if (reusable) {
      try {
        const s = await getStripePay().checkout.sessions.retrieve(
          reusable.session_id,
          {},
          { stripeAccount: reusable.account_id },
        );
        if (s.status === "open" && s.url) return { url: s.url };
      } catch {
        /* create a new one */
      }
    }
    const page = zettazPayLinkUrl(token);
    const balance = await this.db.transaction(owner, async (tx) =>
      this.remaining(await this.bookingFacts(tx, tenantId, req.booking_id)),
    );
    const result = await this.createSession({
      tenantId,
      actor: owner,
      bookingId: req.booking_id,
      requestedMinor:
        req.amount_minor === null
          ? undefined
          : Math.min(Number(req.amount_minor), balance),
      requestId,
      origin: "pay_link",
      successUrl: `${page}?status=success`,
      cancelUrl: page,
    });
    return { url: result.url };
  }

  // ── Booking money summary (staff + crew) ───────────────────────────────────

  async bookingSummary(actor: Actor, bookingId: string) {
    const tenantId = actor.tenantId!;
    return this.db.transaction(actor, async (tx) => {
      const b = await this.bookingFacts(tx, tenantId, bookingId);
      const ready = await this.readyFromStore(tx, tenantId);
      const { rows: checkouts } = await tx.query<
        CheckoutRow & { refunded_minor: string; disputed: boolean }
      >(
        `SELECT c.*,
            COALESCE((SELECT SUM(r.amount_minor) FROM zettaz_pay_refunds r
              WHERE r.tenant_id=c.tenant_id AND r.checkout_id=c.id AND r.ledger_posted),0)::text AS refunded_minor,
            EXISTS(SELECT 1 FROM zettaz_pay_disputes d WHERE d.tenant_id=c.tenant_id AND d.checkout_id=c.id
              AND d.status NOT IN ('won','warning_closed')) AS disputed
           FROM zettaz_pay_checkouts c
          WHERE c.tenant_id=$1 AND c.booking_id=$2 AND c.status='paid'
          ORDER BY c.paid_at`,
        [tenantId, bookingId],
      );
      const { rows: refunds } = await tx.query(
        `SELECT r.id,r.checkout_id,r.refund_id,r.amount_minor::float8 AS amount_minor,r.currency,r.status,r.origin,r.reason,r.created_at
           FROM zettaz_pay_refunds r JOIN zettaz_pay_checkouts c ON c.tenant_id=r.tenant_id AND c.id=r.checkout_id
          WHERE r.tenant_id=$1 AND c.booking_id=$2 ORDER BY r.created_at`,
        [tenantId, bookingId],
      );
      const { rows: disputes } = await tx.query(
        `SELECT d.id,d.checkout_id,d.amount_minor::float8 AS amount_minor,d.currency,d.status,d.reason,d.evidence_due_by
           FROM zettaz_pay_disputes d JOIN zettaz_pay_checkouts c ON c.tenant_id=d.tenant_id AND c.id=d.checkout_id
          WHERE d.tenant_id=$1 AND c.booking_id=$2 ORDER BY d.created_at`,
        [tenantId, bookingId],
      );
      const { rows: links } = await tx.query(
        `SELECT id,amount_minor::float8 AS amount_minor,currency,channel,
                CASE WHEN status='open' AND expires_at<=clock_timestamp() THEN 'expired' ELSE status END AS status,
                expires_at,created_at,paid_at
           FROM zettaz_pay_requests WHERE tenant_id=$1 AND booking_id=$2
          ORDER BY created_at DESC LIMIT 20`,
        [tenantId, bookingId],
      );
      const remaining = this.remaining(b);
      return {
        ready,
        currency: b.currency,
        currencySupported: zettazPayCurrencySupported(b.currency),
        balanceMinor: remaining,
        collectible: ready && this.collectible(b) === null,
        blockedReason: ready ? this.collectible(b) : null,
        payments: checkouts.map((c) => ({
          checkoutId: c.id,
          amountMinor: Number(c.paid_minor),
          refundedMinor: Number(c.refunded_minor),
          refundableMinor: Math.max(
            0,
            Number(c.paid_minor) - Number(c.refunded_minor),
          ),
          currency: c.currency,
          paidAt: c.paid_at,
          paymentId: c.payment_id,
          disputed: c.disputed,
          origin: c.origin,
        })),
        refunds,
        disputes,
        links,
      };
    });
  }

  // ── Refunds ────────────────────────────────────────────────────────────────

  async refund(actor: Actor, bookingId: string, key: string, raw: unknown) {
    const input = parse(refundSchema, raw);
    const tenantId = actor.tenantId!;
    const checkout = await this.db.transaction(actor, async (tx) => {
      const {
        rows: [c],
      } = await tx.query<CheckoutRow & { refunded_minor: string }>(
        `SELECT c.*,COALESCE((SELECT SUM(r.amount_minor) FROM zettaz_pay_refunds r
            WHERE r.tenant_id=c.tenant_id AND r.checkout_id=c.id AND r.status NOT IN ('failed','canceled')),0)::text AS refunded_minor
           FROM zettaz_pay_checkouts c WHERE c.tenant_id=$1 AND c.id=$2 AND c.booking_id=$3`,
        [tenantId, input.checkoutId, bookingId],
      );
      return c ?? null;
    });
    if (!checkout || checkout.status !== "paid" || !checkout.payment_intent_id)
      throw new BadRequestException("That card payment cannot be refunded.");
    const refundable =
      Number(checkout.paid_minor) - Number(checkout.refunded_minor);
    if (input.amountMinor > refundable)
      throw new BadRequestException(
        "The refund is more than what is left on this card payment.",
      );
    let refund: Stripe.Refund;
    try {
      refund = await getStripePay().refunds.create(
        {
          payment_intent: checkout.payment_intent_id,
          amount: input.amountMinor,
          refund_application_fee: true,
          reason: "requested_by_customer",
          metadata: {
            tenantId,
            bookingId,
            checkoutId: checkout.id,
            purpose: "zettaz_pay_booking",
          },
        },
        {
          stripeAccount: checkout.account_id,
          idempotencyKey: `zettaz-pay-refund-${tenantId}-${actor.actorId}-${key}`,
        },
      );
    } catch (error) {
      throw new BadRequestException(
        payStripeMessage(error, "Stripe could not refund this payment."),
      );
    }
    await this.applyRefund(tenantId, refund, {
      actor,
      origin: "app",
      reason: input.reason,
    });
    return {
      refundId: refund.id,
      status: refund.status,
      amountMinor: refund.amount,
    };
  }

  /** Upsert a refund from the API response or a webhook and post the ledger once. */
  private async applyRefund(
    tenantId: string,
    refund: Stripe.Refund,
    opts: {
      actor?: Actor;
      origin: "app" | "stripe_dashboard";
      reason?: string;
    },
  ) {
    const intent =
      typeof refund.payment_intent === "string"
        ? refund.payment_intent
        : refund.payment_intent?.id;
    if (!intent) return;
    const actor = opts.actor ?? (await this.ownerActor(tenantId));
    await this.db.transaction(actor, async (tx) => {
      const {
        rows: [c],
      } = await tx.query<{ id: string }>(
        `SELECT id FROM zettaz_pay_checkouts WHERE tenant_id=$1 AND payment_intent_id=$2 FOR UPDATE`,
        [tenantId, intent],
      );
      if (!c) return;
      const status = (refund.status ?? "pending") as string;
      const shouldPost = ["pending", "requires_action", "succeeded"].includes(
        status,
      );
      const refundReason =
        opts.reason ??
        (refund.metadata?.purpose === "zettaz_pay_booking"
          ? "Refund"
          : "Refunded in the Stripe Dashboard");
      await tx.query(
        `INSERT INTO zettaz_pay_refunds(tenant_id,id,checkout_id,refund_id,amount_minor,currency,status,origin,reason,ledger_posted,created_by)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         ON CONFLICT (refund_id) DO UPDATE SET status=EXCLUDED.status,
           ledger_posted=EXCLUDED.ledger_posted,updated_at=clock_timestamp(),
           origin=CASE WHEN EXCLUDED.origin='app' THEN 'app' ELSE zettaz_pay_refunds.origin END,
           reason=CASE WHEN EXCLUDED.origin='app' THEN EXCLUDED.reason ELSE zettaz_pay_refunds.reason END,
           created_by=COALESCE(zettaz_pay_refunds.created_by,EXCLUDED.created_by)`,
        [
          tenantId,
          randomUUID(),
          c.id,
          refund.id,
          refund.amount,
          (refund.currency ?? "").toUpperCase(),
          status,
          opts.origin,
          refundReason.slice(0, 500),
          shouldPost,
          opts.actor?.actorId ?? null,
        ],
      );
      await this.rebaseLedger(tx, actor, c.id, refund.id, refundReason);
      await record(tx, actor, "zettaz_pay.refund", c.id, null, {
        refundId: refund.id,
        amountMinor: refund.amount,
        status,
        origin: opts.origin,
      });
    });
  }

  /**
   * Make the booking ledger match Stripe for one card payment:
   * live amount = paid − posted refunds − lost disputes.
   * Reverses the current live row and posts the remainder (append-only).
   */
  private async rebaseLedger(
    tx: Tx,
    actor: Actor,
    checkoutId: string,
    reference: string,
    reason: string,
  ) {
    const tenantId = actor.tenantId!;
    const {
      rows: [c],
    } = await tx.query<CheckoutRow>(
      `SELECT * FROM zettaz_pay_checkouts WHERE tenant_id=$1 AND id=$2 FOR UPDATE`,
      [tenantId, checkoutId],
    );
    if (!c || c.status !== "paid" || !c.paid_minor) return;
    const {
      rows: [removed],
    } = await tx.query<{ total: string }>(
      `SELECT (COALESCE((SELECT SUM(amount_minor) FROM zettaz_pay_refunds
                 WHERE tenant_id=$1 AND checkout_id=$2 AND ledger_posted),0)
             + COALESCE((SELECT SUM(amount_minor) FROM zettaz_pay_disputes
                 WHERE tenant_id=$1 AND checkout_id=$2 AND ledger_posted),0))::text AS total`,
      [tenantId, checkoutId],
    );
    const target = Math.max(0, Number(c.paid_minor) - Number(removed!.total));
    let current = 0;
    if (c.payment_id) {
      const {
        rows: [p],
      } = await tx.query<{ amount_minor: string; reversed: boolean }>(
        `SELECT p.amount_minor::text,EXISTS(SELECT 1 FROM payment_adjustments a
            WHERE a.tenant_id=p.tenant_id AND a.payment_id=p.id) AS reversed
           FROM payments p WHERE p.tenant_id=$1 AND p.id=$2`,
        [tenantId, c.payment_id],
      );
      current = p && !p.reversed ? Number(p.amount_minor) : 0;
    }
    if (current === target) return;
    const now = new Date().toISOString();
    if (c.payment_id && current > 0) {
      await tx.query(
        `INSERT INTO payment_adjustments(tenant_id,id,payment_id,kind,reference,reason,occurred_at,actor_id)
         VALUES($1,$2,$3,'reversal',$4,$5,GREATEST($6::timestamptz,(SELECT occurred_at FROM payments WHERE tenant_id=$1 AND id=$3)),$7)`,
        [
          tenantId,
          randomUUID(),
          c.payment_id,
          reference.slice(0, 120),
          `Zettaz Pay: ${reason}`.padEnd(8, ".").slice(0, 500),
          now,
          actor.actorId,
        ],
      );
    }
    let paymentId: string | null = null;
    if (target > 0) {
      paymentId = randomUUID();
      await tx.query(
        `INSERT INTO payments(tenant_id,id,booking_id,amount_minor,currency,method,status,reference,reason,occurred_at,actor_id)
         VALUES($1,$2,$3,$4,$5,'zettaz_pay','settled',$6,$7,$8,$9)`,
        [
          tenantId,
          paymentId,
          c.booking_id,
          target,
          c.currency,
          `${c.session_id}:${reference}`.slice(0, 255),
          "Zettaz Pay card payment (after refund or dispute)",
          c.paid_at,
          actor.actorId,
        ],
      );
    }
    await tx.query(
      `UPDATE zettaz_pay_checkouts SET payment_id=$3 WHERE tenant_id=$1 AND id=$2`,
      [tenantId, checkoutId, paymentId],
    );
    await record(
      tx,
      actor,
      "payment.zettaz_pay_adjusted",
      c.booking_id,
      {
        amountMinor: current,
      },
      { amountMinor: target, reference },
    );
  }

  // ── Webhook handlers ───────────────────────────────────────────────────────

  async handleWebhookEvent(event: Stripe.Event, connectedAccountId?: string) {
    switch (event.type) {
      case "checkout.session.completed":
      case "checkout.session.async_payment_succeeded":
        await this.settleCheckoutSession(
          event.data.object as Stripe.Checkout.Session,
          connectedAccountId,
        );
        return;
      case "checkout.session.expired":
      case "checkout.session.async_payment_failed":
        await this.expireCheckoutSession(
          event.data.object as Stripe.Checkout.Session,
        );
        return;
      case "account.updated": {
        const account = event.data.object as Stripe.Account;
        await this.syncAccount(connectedAccountId ?? account.id);
        return;
      }
      case "refund.created":
      case "refund.updated":
      case "refund.failed":
      case "charge.refund.updated":
        await this.syncRefund(
          event.data.object as Stripe.Refund,
          connectedAccountId,
        );
        return;
      case "charge.dispute.created":
      case "charge.dispute.updated":
      case "charge.dispute.closed":
      case "charge.dispute.funds_withdrawn":
      case "charge.dispute.funds_reinstated":
        await this.syncDispute(
          event.data.object as Stripe.Dispute,
          connectedAccountId,
        );
        return;
      default:
        return;
    }
  }

  async handleThinAccountEvent(relatedAccountId: string): Promise<void> {
    if (!zettazPayConfigured() || !relatedAccountId) return;
    await this.syncAccount(relatedAccountId);
  }

  private async tenantForAccount(accountId: string | undefined) {
    if (!accountId) return null;
    const {
      rows: [row],
    } = await this.db.pool.query<{ tenant: string | null }>(
      "SELECT zettaz_pay_tenant_for_account($1) AS tenant",
      [accountId],
    );
    return row?.tenant ?? null;
  }

  private async syncAccount(accountId: string) {
    const tenantId = await this.tenantForAccount(accountId);
    if (!tenantId) return;
    const snap = await retrieveMerchant(accountId);
    await this.storeSnapshot(tenantId, accountId, snap);
  }

  async ownerActor(tenantId: string): Promise<Actor> {
    const {
      rows: [row],
    } = await this.db.pool.query<{ owner: string | null }>(
      "SELECT zettaz_pay_owner($1) AS owner",
      [tenantId],
    );
    if (!row?.owner) throw new Error(`Tenant ${tenantId} has no active owner`);
    return {
      actorId: row.owner,
      tenantId,
      platform: false,
      permissions: ["payment.write", "payment.refund"],
      role: "owner",
    };
  }

  private async locateCheckout(session: Stripe.Checkout.Session) {
    const {
      rows: [row],
    } = await this.db.pool.query<{
      tenant_id: string;
      checkout_id: string;
      account_id: string;
    }>("SELECT * FROM zettaz_pay_checkout_for_session($1)", [session.id]);
    return row ?? null;
  }

  private async expireCheckoutSession(session: Stripe.Checkout.Session) {
    const found = await this.locateCheckout(session);
    if (!found) return;
    await this.db.transaction(systemActor(found.tenant_id), (tx) =>
      tx.query(
        `UPDATE zettaz_pay_checkouts SET status='expired' WHERE tenant_id=$1 AND id=$2 AND status='open'`,
        [found.tenant_id, found.checkout_id],
      ),
    );
  }

  private async settleCheckoutSession(
    session: Stripe.Checkout.Session,
    connectedAccountId?: string,
  ) {
    if (session.payment_status !== "paid") return;
    if (session.metadata?.purpose !== "zettaz_pay_booking") return;
    const found = await this.locateCheckout(session);
    if (!found) {
      console.warn("[ZettazPay] paid session has no checkout row", session.id);
      return;
    }
    if (connectedAccountId && connectedAccountId !== found.account_id) {
      console.warn("[ZettazPay] session/account mismatch", session.id);
      return;
    }
    if (
      session.metadata?.tenantId &&
      session.metadata.tenantId !== found.tenant_id
    ) {
      console.warn("[ZettazPay] session/tenant mismatch", session.id);
      return;
    }
    const tenantId = found.tenant_id;
    const owner = await this.ownerActor(tenantId);
    const amount = session.amount_total ?? 0;
    const currency = (session.currency ?? "").toUpperCase();
    const intent =
      typeof session.payment_intent === "string"
        ? session.payment_intent
        : (session.payment_intent?.id ?? null);
    if (!amount || amount <= 0) return;
    await this.db.transaction(owner, async (tx) => {
      const {
        rows: [c],
      } = await tx.query<CheckoutRow>(
        `SELECT * FROM zettaz_pay_checkouts WHERE tenant_id=$1 AND id=$2 FOR UPDATE`,
        [tenantId, found.checkout_id],
      );
      if (!c || c.status === "paid") return;
      if (c.currency !== currency) {
        console.warn("[ZettazPay] currency mismatch", session.id);
        return;
      }
      const b = await this.bookingFacts(tx, tenantId, c.booking_id);
      const paymentId = randomUUID();
      const occurredAt = new Date().toISOString();
      await tx.query(
        `INSERT INTO payments(tenant_id,id,booking_id,amount_minor,currency,method,status,reference,reason,occurred_at,actor_id)
         VALUES($1,$2,$3,$4,$5,'zettaz_pay','settled',$6,$7,$8,$9)`,
        [
          tenantId,
          paymentId,
          c.booking_id,
          amount,
          currency,
          session.id,
          "Zettaz Pay card payment",
          occurredAt,
          owner.actorId,
        ],
      );
      await tx.query(
        `UPDATE zettaz_pay_checkouts
            SET status='paid',payment_id=$3,payment_intent_id=$4,paid_minor=$5,paid_at=$6
          WHERE tenant_id=$1 AND id=$2`,
        [tenantId, c.id, paymentId, intent, amount, occurredAt],
      );
      const remainingAfter = this.remaining(b) - amount;
      if (c.request_id) {
        const {
          rows: [req],
        } = await tx.query<{ amount_minor: string | null }>(
          "SELECT amount_minor FROM zettaz_pay_requests WHERE tenant_id=$1 AND id=$2",
          [tenantId, c.request_id],
        );
        if (req && (req.amount_minor !== null || remainingAfter <= 0))
          await tx.query(
            `UPDATE zettaz_pay_requests SET status='paid',paid_at=$3
              WHERE tenant_id=$1 AND id=$2 AND status='open'`,
            [tenantId, c.request_id, occurredAt],
          );
      }
      if (remainingAfter <= 0)
        await tx.query(
          `UPDATE zettaz_pay_requests SET status='paid',paid_at=$3
            WHERE tenant_id=$1 AND booking_id=$2 AND status='open'`,
          [tenantId, c.booking_id, occurredAt],
        );
      await record(
        tx,
        owner,
        "payment.zettaz_pay",
        paymentId,
        null,
        {
          bookingId: c.booking_id,
          sessionId: session.id,
          amountMinor: amount,
          currency,
          applicationFeeMinor: Number(c.fee_minor),
        },
        "Zettaz Pay Checkout",
      );
      if (remainingAfter < 0)
        await record(
          tx,
          owner,
          "payment.zettaz_pay_overpaid",
          c.booking_id,
          null,
          {
            sessionId: session.id,
            overpaidMinor: -remainingAfter,
          },
          "Guest paid more than the balance; refund the difference or keep as credit",
        );
      if (
        b.state === "cancelled" ||
        b.state === "expired" ||
        (b.state === "held" && !b.hold_live)
      )
        await record(
          tx,
          owner,
          "payment.zettaz_pay_late",
          c.booking_id,
          null,
          {
            sessionId: session.id,
            bookingState: b.state,
          },
          "Payment arrived after the booking was cancelled or the hold expired",
        );
    });
  }

  private async syncRefund(refund: Stripe.Refund, connectedAccountId?: string) {
    const intent =
      typeof refund.payment_intent === "string"
        ? refund.payment_intent
        : refund.payment_intent?.id;
    if (!intent) return;
    const {
      rows: [found],
    } = await this.db.pool.query<{ tenant_id: string; account_id: string }>(
      "SELECT * FROM zettaz_pay_checkout_for_intent($1)",
      [intent],
    );
    if (!found) return;
    if (connectedAccountId && connectedAccountId !== found.account_id) return;
    const known = await this.db.transaction(
      systemActor(found.tenant_id),
      async (tx) =>
        (
          await tx.query<{
            origin: "app" | "stripe_dashboard";
            reason: string;
          }>(
            "SELECT origin,reason FROM zettaz_pay_refunds WHERE tenant_id=$1 AND refund_id=$2",
            [found.tenant_id, refund.id],
          )
        ).rows[0],
    );
    await this.applyRefund(found.tenant_id, refund, {
      origin: known?.origin ?? "stripe_dashboard",
      reason: known?.reason,
    });
  }

  private async syncDispute(
    dispute: Stripe.Dispute,
    connectedAccountId?: string,
  ) {
    const intent =
      typeof dispute.payment_intent === "string"
        ? dispute.payment_intent
        : (dispute.payment_intent?.id ?? null);
    if (!intent) return;
    const {
      rows: [found],
    } = await this.db.pool.query<{
      tenant_id: string;
      checkout_id: string;
      account_id: string;
    }>("SELECT * FROM zettaz_pay_checkout_for_intent($1)", [intent]);
    if (!found) return;
    if (connectedAccountId && connectedAccountId !== found.account_id) return;
    const owner = await this.ownerActor(found.tenant_id);
    const lost = dispute.status === "lost";
    const due = dispute.evidence_details?.due_by
      ? new Date(dispute.evidence_details.due_by * 1000).toISOString()
      : null;
    await this.db.transaction(owner, async (tx) => {
      const {
        rows: [prior],
      } = await tx.query<{ status: string }>(
        "SELECT status FROM zettaz_pay_disputes WHERE tenant_id=$1 AND dispute_id=$2",
        [found.tenant_id, dispute.id],
      );
      await tx.query(
        `INSERT INTO zettaz_pay_disputes(tenant_id,id,checkout_id,dispute_id,amount_minor,currency,status,reason,evidence_due_by,ledger_posted)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         ON CONFLICT (dispute_id) DO UPDATE SET status=EXCLUDED.status,amount_minor=EXCLUDED.amount_minor,
           evidence_due_by=EXCLUDED.evidence_due_by,ledger_posted=EXCLUDED.ledger_posted,updated_at=clock_timestamp()`,
        [
          found.tenant_id,
          randomUUID(),
          found.checkout_id,
          dispute.id,
          dispute.amount,
          (dispute.currency ?? "").toUpperCase(),
          dispute.status,
          dispute.reason ?? "",
          due,
          lost,
        ],
      );
      await this.rebaseLedger(
        tx,
        owner,
        found.checkout_id,
        dispute.id,
        lost ? "chargeback lost" : "chargeback update",
      );
      if (prior?.status !== dispute.status) {
        const {
          rows: [c],
        } = await tx.query<{ booking_id: string }>(
          "SELECT booking_id FROM zettaz_pay_checkouts WHERE tenant_id=$1 AND id=$2",
          [found.tenant_id, found.checkout_id],
        );
        await record(
          tx,
          owner,
          "zettaz_pay.dispute",
          c!.booking_id,
          prior ?? null,
          {
            disputeId: dispute.id,
            status: dispute.status,
            amountMinor: dispute.amount,
            evidenceDueBy: due,
          },
          "Card dispute — respond in the Stripe Dashboard before the evidence deadline",
        );
      }
    });
  }
}

// ── Controllers ──────────────────────────────────────────────────────────────

@Controller("admin/v1/zettaz-pay")
export class ZettazPayController {
  constructor(private readonly pay: ZettazPayService) {}

  @Get()
  @Access("authenticated")
  status(@CurrentActor() actor: Actor) {
    return this.pay.status(actor);
  }

  @Post("onboard")
  @Access("config.write")
  onboard(@CurrentActor() actor: Actor, @Body() body: unknown) {
    return this.pay.startOnboarding(actor, body);
  }
}

@Controller("staff/v1/bookings")
export class ZettazPayCheckoutController {
  constructor(private readonly pay: ZettazPayService) {}

  @Post(":id/zettaz-pay-checkout")
  @Access("payment.write")
  checkout(
    @CurrentActor() actor: Actor,
    @Param("id") bookingId: string,
    @Body() body: unknown,
  ) {
    return this.pay.staffCheckout(actor, parse(uuid, bookingId), body);
  }

  @Get(":id/zettaz-pay")
  @Access("bookings.read")
  summary(@CurrentActor() actor: Actor, @Param("id") bookingId: string) {
    return this.pay.bookingSummary(actor, parse(uuid, bookingId));
  }

  @Post(":id/zettaz-pay/links")
  @Access("payment.write")
  link(
    @CurrentActor() actor: Actor,
    @Param("id") bookingId: string,
    @Headers("idempotency-key") key: string,
    @Body() body: unknown,
  ) {
    return this.pay.createLink(
      actor,
      parse(uuid, bookingId),
      parse(keySchema, key),
      body,
    );
  }

  @Post(":id/zettaz-pay/links/:requestId/cancel")
  @Access("payment.write")
  cancelLink(
    @CurrentActor() actor: Actor,
    @Param("id") bookingId: string,
    @Param("requestId") requestId: string,
  ) {
    return this.pay.cancelLink(
      actor,
      parse(uuid, bookingId),
      parse(uuid, requestId),
    );
  }

  @Post(":id/zettaz-pay/refunds")
  @Access("payment.refund")
  refund(
    @CurrentActor() actor: Actor,
    @Param("id") bookingId: string,
    @Headers("idempotency-key") key: string,
    @Body() body: unknown,
  ) {
    return this.pay.refund(
      actor,
      parse(uuid, bookingId),
      parse(keySchema, key),
      body,
    );
  }
}

/** Guest-facing pay link. No session; the unguessable token is the credential. */
@Controller("pay/v1")
export class ZettazPayPublicController {
  constructor(private readonly pay: ZettazPayService) {}

  @Get(":token")
  @Access("public")
  read(@Param("token") token: string) {
    return this.pay.publicLink(token);
  }

  @Post(":token/checkout")
  @Access("public")
  @HttpCode(200)
  checkout(@Param("token") token: string) {
    return this.pay.publicCheckout(token);
  }
}

function verifySignature(raw: string, sig: string, secrets: string[]) {
  for (const secret of secrets) {
    try {
      webhookVerifier.webhooks.signature!.verifyHeader(raw, sig, secret);
      return true;
    } catch {
      /* try the next destination secret */
    }
  }
  return false;
}

@Controller("webhooks")
export class ZettazPayWebhookController {
  constructor(private readonly pay: ZettazPayService) {}

  @Post("stripe-pay")
  @Access("public")
  @HttpCode(200)
  async handleWebhook(
    @Headers("stripe-signature") sig: string,
    @Req() req: ExpressRequest,
    @Res() res: ExpressResponse,
  ) {
    const snapshotSecret = process.env.STRIPE_PAY_WEBHOOK_SECRET ?? "";
    const thinSecret = process.env.STRIPE_PAY_THIN_WEBHOOK_SECRET ?? "";
    const secrets = [snapshotSecret, thinSecret].filter(Boolean);
    if (!secrets.length) {
      console.warn("[ZettazPay] STRIPE_PAY_WEBHOOK_SECRET missing");
      res.status(500).json({ error: "Zettaz Pay webhook not configured" });
      return;
    }
    if (!sig) {
      res.status(400).json({ error: "Missing stripe-signature header" });
      return;
    }
    const rawBody = req.body as Buffer;
    if (!Buffer.isBuffer(rawBody) || rawBody.length === 0) {
      res.status(400).json({ error: "Missing request body" });
      return;
    }
    const text = rawBody.toString("utf8");
    if (!verifySignature(text, sig, secrets)) {
      console.warn("[ZettazPay] Webhook rejected: bad signature");
      res.status(400).json({ error: "Invalid signature" });
      return;
    }
    let parsed: {
      id?: string;
      type?: string;
      object?: string;
      account?: string;
      related_object?: { id?: string };
    };
    try {
      parsed = JSON.parse(text);
    } catch {
      res.status(400).json({ error: "Invalid JSON" });
      return;
    }
    try {
      if (parsed.object === "v2.core.event" || parsed.type?.startsWith("v2.")) {
        const related = parsed.related_object?.id ?? "";
        if (related.startsWith("acct_"))
          await this.pay.handleThinAccountEvent(related);
        res.json({ received: true, format: "thin" });
        return;
      }
      const event = parsed as unknown as Stripe.Event;
      await this.pay.handleWebhookEvent(event, parsed.account);
      res.json({ received: true, format: "snapshot" });
    } catch (err: unknown) {
      // Processing failure: answer 500 so Stripe retries the delivery.
      const msg = err instanceof Error ? err.message : String(err);
      console.error(
        `[ZettazPay] Webhook ${parsed.type} ${parsed.id} failed: ${msg}`,
      );
      res.status(500).json({ error: "Processing failed; Stripe will retry" });
    }
  }
}

@Module({
  controllers: [
    ZettazPayController,
    ZettazPayCheckoutController,
    ZettazPayPublicController,
    ZettazPayWebhookController,
  ],
  providers: [ZettazPayService],
  exports: [ZettazPayService],
})
export class ZettazPayModule {}
