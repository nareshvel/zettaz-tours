/**
 * Zettaz Pay — Stripe Connect platform for traveler collections.
 *
 * Never import getStripe() from stripe-billing.ts here. SaaS Billing and
 * traveler money are two Stripe accounts, two keys, two webhook secrets.
 *
 *   STRIPE_PAY_SECRET_KEY              — sk_live_... (Zettaz Pay platform)
 *   STRIPE_PAY_WEBHOOK_SECRET          — whsec_... for Connect/Checkout events
 *   ZETTAZ_PAY_APPLICATION_FEE_BPS     — platform cut in basis points (100 = 1%)
 */
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Module,
  Param,
  Post,
  Injectable,
  Req,
  Res,
} from "@nestjs/common";
import Stripe from "stripe";
import { randomUUID } from "node:crypto";
import { Database, record } from "./database";
import type { Actor } from "../../../packages/shared/src/contracts";
import { Access, CurrentActor } from "./http";
import type {
  Request as ExpressRequest,
  Response as ExpressResponse,
} from "express";

export function getStripePay(): Stripe {
  const key = process.env.STRIPE_PAY_SECRET_KEY;
  if (!key) throw new Error("STRIPE_PAY_SECRET_KEY is not set");
  if (process.env.STRIPE_SECRET_KEY && key === process.env.STRIPE_SECRET_KEY) {
    throw new Error(
      "STRIPE_PAY_SECRET_KEY must not equal STRIPE_SECRET_KEY (SaaS Billing).",
    );
  }
  return new Stripe(key, { apiVersion: "2026-08-26.dahlia" });
}

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
  return Boolean(process.env.STRIPE_PAY_SECRET_KEY);
}

type PayState = {
  accountId?: string;
  chargesEnabled?: boolean;
};

export type ZettazPayStatus = {
  brand: "Zettaz Pay";
  platformConfigured: boolean;
  /** False until the Zettaz Pay Stripe platform account itself is activated. */
  platformReady: boolean;
  applicationFeeBps: number;
  accountId: string | null;
  chargesEnabled: boolean;
  readyForCheckout: boolean;
};

function isPlatformActivationError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /must be activated/i.test(message) || /activate your accounts/i.test(message);
}

function payStripeMessage(error: unknown, fallback: string): string {
  if (isPlatformActivationError(error)) {
    return "Zettaz Pay’s Stripe platform account is not activated yet. Guest checkout stays off until that is finished in Stripe.";
  }
  return error instanceof Error ? error.message : fallback;
}

async function readPlatformReady(): Promise<boolean> {
  if (!zettazPayConfigured()) return false;
  try {
    const me = await getStripePay().accounts.retrieve(null);
    return Boolean(me.charges_enabled);
  } catch (error) {
    return !isPlatformActivationError(error);
  }
}

@Injectable()
export class ZettazPayService {
  constructor(private readonly db: Database) {}

  async status(actor: Actor): Promise<ZettazPayStatus> {
    const stored = await this.readState(actor);
    const platformConfigured = zettazPayConfigured();
    let chargesEnabled = Boolean(stored.chargesEnabled);
    if (platformConfigured && stored.accountId) {
      try {
        const account = await getStripePay().v2.core.accounts.retrieve(
          stored.accountId,
        );
        chargesEnabled = merchantChargesEnabled(account);
        if (chargesEnabled !== stored.chargesEnabled) {
          await this.writeState(actor, {
            accountId: stored.accountId,
            chargesEnabled,
          });
        }
      } catch {
        // Keep stored flags if Stripe is unreachable.
      }
    }
    const platformReady = platformConfigured ? await readPlatformReady() : false;
    return {
      brand: "Zettaz Pay",
      platformConfigured,
      platformReady,
      applicationFeeBps: zettazPayApplicationFeeBps(),
      accountId: stored.accountId ?? null,
      chargesEnabled,
      readyForCheckout: platformConfigured && platformReady && chargesEnabled,
    };
  }

  async startOnboarding(
    actor: Actor,
    returnUrl: string,
    refreshUrl: string,
  ): Promise<{ url: string }> {
    if (!zettazPayConfigured()) {
      throw new BadRequestException(
        "Zettaz Pay is not connected on this server yet.",
      );
    }
    if (!(await readPlatformReady())) {
      throw new BadRequestException(
        "Zettaz Pay’s Stripe platform account is not activated yet. Guest checkout stays off until that is finished in Stripe.",
      );
    }
    const stripe = getStripePay();
    const profile = await this.db.transaction(actor, async (tx) => {
      const {
        rows: [row],
      } = await tx.query<{
        name: string;
        business_profile: { email?: string; country?: string } | null;
        config: { zettazPay?: PayState };
      }>(
        "SELECT name, business_profile, config FROM tenants WHERE id=$1",
        [actor.tenantId],
      );
      if (!row) throw new BadRequestException("Tenant not found.");
      return row;
    });
    let accountId = profile.config?.zettazPay?.accountId;
    if (!accountId) {
      try {
        const country = (profile.business_profile?.country || "US").slice(0, 2);
        const created = await stripe.v2.core.accounts.create({
        display_name: profile.name.slice(0, 150),
        contact_email: profile.business_profile?.email || undefined,
        dashboard: "full",
        identity: { country: country.toUpperCase() },
        defaults: {
          responsibilities: {
            fees_collector: "stripe",
            losses_collector: "stripe",
          },
        },
        configuration: {
          merchant: {
            capabilities: {
              card_payments: { requested: true },
            },
          },
        },
      } as never);
      accountId = String((created as { id: string }).id);
      await this.writeState(actor, { accountId, chargesEnabled: false });
      } catch (error) {
        throw new BadRequestException(
          payStripeMessage(error, "Stripe account create failed."),
        );
      }
    }
    let url = "";
    try {
    const link = await stripe.v2.core.accountLinks.create({
      account: accountId,
      use_case: {
        type: "account_onboarding",
        account_onboarding: {
          configurations: ["merchant"],
          refresh_url: refreshUrl,
          return_url: returnUrl,
        },
      },
    } as never);
    url = String(
      (link as { url?: string }).url ??
        (link as { account_link?: { url?: string } }).account_link?.url ??
        "",
    );
    } catch (error) {
      throw new BadRequestException(
        payStripeMessage(error, "Stripe onboarding link failed."),
      );
    }
    if (!url)
      throw new BadRequestException(
        "Stripe did not return an onboarding URL. Check Zettaz Pay Connect settings.",
      );
    return { url };
  }

  async createBookingCheckout(
    actor: Actor,
    bookingId: string,
    successUrl: string,
    cancelUrl: string,
  ): Promise<{ url: string }> {
    if (!zettazPayConfigured()) {
      throw new BadRequestException(
        "Zettaz Pay is not connected on this server yet.",
      );
    }
    if (!(await readPlatformReady())) {
      throw new BadRequestException(
        "Zettaz Pay’s Stripe platform account is not activated yet. Guest checkout stays off until that is finished in Stripe.",
      );
    }
    const stored = await this.readState(actor);
    if (!stored.accountId) {
      throw new BadRequestException(
        "This tenant has not started Zettaz Pay onboarding.",
      );
    }
    const stripe = getStripePay();
    let chargesEnabled = stored.chargesEnabled;
    try {
      const account = await stripe.v2.core.accounts.retrieve(stored.accountId);
      chargesEnabled = merchantChargesEnabled(account);
    } catch (error) {
      throw new BadRequestException(
        payStripeMessage(error, "Could not read merchant account."),
      );
    }
    if (!chargesEnabled) {
      throw new BadRequestException(
        "Zettaz Pay is not ready to collect cards. Finish Stripe onboarding first.",
      );
    }
    const booking = await this.db.transaction(actor, async (tx) => {
      const {
        rows: [row],
      } = await tx.query<{
        state: string;
        quote: { totalMinor: number; currency: string };
        paid: string;
        credit: string;
      }>(
        `SELECT b.state, h.quote,
                COALESCE((SELECT SUM(p.amount_minor) FROM payments p
                   WHERE p.tenant_id=b.tenant_id AND p.booking_id=b.id AND p.status='settled'
                   AND NOT EXISTS (SELECT 1 FROM payment_adjustments a
                     WHERE a.tenant_id=p.tenant_id AND a.payment_id=p.id)),0)::text AS paid,
                COALESCE((SELECT SUM(c.amount_minor) FROM partner_collection_claims c
                   JOIN partner_claim_decisions d ON d.tenant_id=c.tenant_id AND d.claim_id=c.id AND d.decision='accepted'
                   WHERE c.tenant_id=b.tenant_id AND c.booking_id=b.id),0)::text AS credit
           FROM bookings b
           JOIN holds h ON h.tenant_id=b.tenant_id AND h.id=b.hold_id
          WHERE b.tenant_id=$1 AND b.id=$2`,
        [actor.tenantId, bookingId],
      );
      if (!row) throw new BadRequestException("Booking not found.");
      return row;
    });
    if (booking.state === "cancelled" || booking.state === "expired") {
      throw new BadRequestException("This booking cannot take a card payment.");
    }
    const remaining =
      booking.quote.totalMinor - Number(booking.paid) - Number(booking.credit);
    if (!Number.isSafeInteger(remaining) || remaining <= 0) {
      throw new BadRequestException("There is no guest balance to collect.");
    }
    const currency = booking.quote.currency.toLowerCase();
    if (currency !== "usd") {
      throw new BadRequestException(
        "Zettaz Pay hosted Checkout is USD-only in this slice.",
      );
    }
    const fee = zettazPayApplicationFeeAmount(remaining);
    try {
      const session = await stripe.checkout.sessions.create(
        {
          mode: "payment",
          client_reference_id: bookingId,
          success_url: successUrl,
          cancel_url: cancelUrl,
          metadata: {
            tenantId: actor.tenantId ?? "",
            bookingId,
            purpose: "zettaz_pay_booking",
          },
          line_items: [
            {
              quantity: 1,
              price_data: {
                currency,
                unit_amount: remaining,
                product_data: { name: "Tour reservation" },
              },
            },
          ],
          payment_intent_data: {
            application_fee_amount: fee,
            metadata: {
              tenantId: actor.tenantId ?? "",
              bookingId,
              purpose: "zettaz_pay_booking",
            },
          },
        },
        { stripeAccount: stored.accountId },
      );
      if (!session.url) {
        throw new BadRequestException("Stripe did not return a Checkout URL.");
      }
      return { url: session.url };
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      throw new BadRequestException(
        payStripeMessage(error, "Could not start Checkout."),
      );
    }
  }

  async handleWebhookEvent(
    event: Stripe.Event,
    connectedAccountId?: string,
  ): Promise<void> {
    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;
      await this.settleCheckoutSession(session, connectedAccountId);
      return;
    }
    if (event.type === "account.updated") {
      const account = event.data.object as Stripe.Account;
      await this.syncAccount(account.id, connectedAccountId ?? account.id);
    }
  }

  async handleThinAccountEvent(relatedAccountId: string): Promise<void> {
    if (!zettazPayConfigured() || !relatedAccountId) return;
    try {
      const account = await getStripePay().v2.core.accounts.retrieve(
        relatedAccountId,
      );
      await this.syncAccount(relatedAccountId, relatedAccountId);
      void account;
    } catch {
      /* ignore retrieve failures */
    }
  }

  private async syncAccount(accountId: string, lookupId: string) {
    const tenantId = await this.tenantIdForPayAccount(lookupId || accountId);
    if (!tenantId) return;
    let chargesEnabled = false;
    try {
      const account = await getStripePay().v2.core.accounts.retrieve(accountId);
      chargesEnabled = merchantChargesEnabled(account);
    } catch {
      return;
    }
    const owner = await this.ownerActor(tenantId);
    await this.writeState(owner, { accountId, chargesEnabled });
  }

  private async settleCheckoutSession(
    session: Stripe.Checkout.Session,
    connectedAccountId?: string,
  ) {
    if (session.payment_status !== "paid") return;
    if (session.metadata?.purpose !== "zettaz_pay_booking") return;
    const bookingId = session.metadata.bookingId || session.client_reference_id;
    const metaTenant = session.metadata.tenantId;
    if (!bookingId || !metaTenant) return;
    const accountId =
      connectedAccountId ||
      (typeof (session as { account?: string }).account === "string"
        ? (session as { account?: string }).account
        : undefined);
    const tenantId = accountId
      ? await this.tenantIdForPayAccount(accountId)
      : metaTenant;
    if (!tenantId || tenantId !== metaTenant) {
      console.warn(
        "[ZettazPay] checkout.session.completed tenant/account mismatch",
        session.id,
      );
      return;
    }
    const amount =
      session.amount_total ??
      (typeof session.amount_subtotal === "number"
        ? session.amount_subtotal
        : 0);
    const currency = (session.currency ?? "usd").toUpperCase();
    if (!amount || amount <= 0) return;
    const owner = await this.ownerActor(tenantId);
    await this.db.transaction(owner, async (tx) => {
      const {
        rows: [existing],
      } = await tx.query(
        "SELECT id FROM payments WHERE tenant_id=$1 AND reference=$2 LIMIT 1",
        [tenantId, session.id],
      );
      if (existing) return;
      const {
        rows: [hold],
      } = await tx.query<{
        quote: { totalMinor: number; currency: string };
      }>(
        `SELECT h.quote FROM bookings b
           JOIN holds h ON h.tenant_id=b.tenant_id AND h.id=b.hold_id
          WHERE b.tenant_id=$1 AND b.id=$2`,
        [tenantId, bookingId],
      );
      if (!hold) return;
      if (hold.quote.currency !== currency) return;
      const {
        rows: [sum],
      } = await tx.query<{ paid: string }>(
        `SELECT COALESCE(SUM(p.amount_minor),0)::text AS paid FROM payments p
          WHERE p.tenant_id=$1 AND p.booking_id=$2 AND p.status='settled'
            AND NOT EXISTS (SELECT 1 FROM payment_adjustments a
              WHERE a.tenant_id=p.tenant_id AND a.payment_id=p.id)`,
        [tenantId, bookingId],
      );
      const paid = Number(sum?.paid ?? 0);
      if (paid + amount > hold.quote.totalMinor) {
        console.warn("[ZettazPay] checkout amount exceeds remaining balance", session.id);
        return;
      }
      const paymentId = randomUUID();
      await tx.query(
        `INSERT INTO payments(
           tenant_id,id,booking_id,amount_minor,currency,method,status,
           reference,reason,occurred_at,actor_id
         ) VALUES($1,$2,$3,$4,$5,$6,'settled',$7,$8,$9,$10)`,
        [
          tenantId,
          paymentId,
          bookingId,
          amount,
          currency,
          "zettaz_pay",
          session.id,
          "Zettaz Pay Checkout",
          new Date().toISOString(),
          owner.actorId,
        ],
      );
      await record(
        tx,
        owner,
        "payment.zettaz_pay",
        paymentId,
        null,
        { bookingId, sessionId: session.id, amountMinor: amount, currency },
        "Zettaz Pay Checkout",
      );
    });
  }

  private async tenantIdForPayAccount(accountId: string): Promise<string | null> {
    const platform: Actor = {
      actorId: "00000000-0000-0000-0000-000000000001",
      tenantId: null,
      platform: true,
      permissions: ["tenant.provision"],
      role: "platform",
    };
    return this.db.transaction(platform, async (tx) => {
      const {
        rows: [row],
      } = await tx.query<{ id: string }>(
        `SELECT id FROM tenants WHERE config#>>'{zettazPay,accountId}' = $1 LIMIT 1`,
        [accountId],
      );
      return row?.id ?? null;
    });
  }

  private async ownerActor(tenantId: string): Promise<Actor> {
    const platform: Actor = {
      actorId: "00000000-0000-0000-0000-000000000001",
      tenantId: null,
      platform: true,
      permissions: ["tenant.provision"],
      role: "platform",
    };
    const ownerId = await this.db.transaction(platform, async (tx) => {
      const {
        rows: [row],
      } = await tx.query<{ actor_id: string }>(
        `SELECT actor_id FROM memberships
          WHERE tenant_id=$1 AND role='owner' AND active
          LIMIT 1`,
        [tenantId],
      );
      return row?.actor_id ?? null;
    });
    if (!ownerId) throw new BadRequestException("Tenant owner not found.");
    return {
      actorId: ownerId,
      tenantId,
      platform: false,
      permissions: ["payment.write", "config.write"],
      role: "owner",
    };
  }

  private async readState(actor: Actor): Promise<PayState> {
    return this.db.transaction(actor, async (tx) => {
      const {
        rows: [row],
      } = await tx.query<{ config: { zettazPay?: PayState } }>(
        "SELECT config FROM tenants WHERE id=$1",
        [actor.tenantId],
      );
      return row?.config?.zettazPay ?? {};
    });
  }

  private async writeState(actor: Actor, state: PayState) {
    await this.db.transaction(actor, async (tx) => {
      await tx.query(
        `UPDATE tenants
            SET config = jsonb_set(COALESCE(config, '{}'::jsonb), '{zettazPay}', $2::jsonb, true)
          WHERE id = $1`,
        [actor.tenantId, JSON.stringify(state)],
      );
    });
  }
}

function merchantChargesEnabled(account: unknown): boolean {
  const rec = account as {
    configuration?: {
      merchant?: { capabilities?: { card_payments?: { status?: string } } };
    };
  };
  return rec.configuration?.merchant?.capabilities?.card_payments?.status ===
    "active";
}

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
  onboard(
    @CurrentActor() actor: Actor,
    @Body() body: { returnUrl?: string; refreshUrl?: string },
  ) {
    const origin = (process.env.WEB_ORIGIN ?? "http://127.0.0.1:3191").replace(
      /\/$/,
      "",
    );
    const fallback = `${origin}/settings?tab=payments`;
    return this.pay.startOnboarding(
      actor,
      body.returnUrl || fallback,
      body.refreshUrl || fallback,
    );
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
    @Body() body: { successUrl?: string; cancelUrl?: string },
  ) {
    const origin = (process.env.WEB_ORIGIN ?? "http://127.0.0.1:3191").replace(
      /\/$/,
      "",
    );
    const fallback = `${origin}/reservations/${bookingId}`;
    return this.pay.createBookingCheckout(
      actor,
      bookingId,
      body.successUrl || `${fallback}?pay=ok`,
      body.cancelUrl || `${fallback}?pay=cancel`,
    );
  }
}

@Controller("webhooks")
export class ZettazPayWebhookController {
  constructor(private readonly pay: ZettazPayService) {}

  @Post("stripe-pay")
  @Access("public")
  @HttpCode(200)
  async handleWebhook(
    @Headers("stripe-signature") sig: string,
    @Headers("stripe-account") stripeAccount: string,
    @Req() req: ExpressRequest,
    @Res() res: ExpressResponse,
  ) {
    const webhookSecret = process.env.STRIPE_PAY_WEBHOOK_SECRET;
    const isProduction = process.env.NODE_ENV === "production";
    if (!webhookSecret) {
      if (isProduction) {
        res.status(500).json({ error: "Zettaz Pay webhook not configured" });
        return;
      }
      console.warn("[ZettazPay] STRIPE_PAY_WEBHOOK_SECRET missing");
      res.status(500).json({ error: "Webhook secret not configured" });
      return;
    }
    if (!sig) {
      res.status(400).json({ error: "Missing stripe-signature header" });
      return;
    }
    const rawBody = req.body as Buffer;
    if (!rawBody || rawBody.length === 0) {
      res.status(400).json({ error: "Missing request body" });
      return;
    }
    const stripe = getStripePay();
    let parsed: { type?: string; id?: string; data?: unknown };
    try {
      parsed = JSON.parse(rawBody.toString()) as {
        type?: string;
        id?: string;
        data?: unknown;
      };
    } catch {
      res.status(400).json({ error: "Invalid JSON" });
      return;
    }
    try {
      if (typeof parsed.type === "string" && parsed.type.startsWith("v2.")) {
        stripe.webhooks.signature!.verifyHeader(
          rawBody.toString(),
          sig,
          webhookSecret,
        );
        const related =
          (
            parsed as {
              related_object?: { id?: string };
            }
          ).related_object?.id ?? "";
        if (related) await this.pay.handleThinAccountEvent(related);
        res.json({ received: true, format: "thin" });
        return;
      }
      const event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
      const connected =
        stripeAccount ||
        (event as Stripe.Event & { account?: string }).account;
      await this.pay.handleWebhookEvent(event, connected);
      res.json({ received: true, format: "snapshot" });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[ZettazPay] Webhook rejected: ${msg}`);
      res.status(400).json({ error: "Invalid signature" });
    }
  }
}

@Module({
  controllers: [
    ZettazPayController,
    ZettazPayCheckoutController,
    ZettazPayWebhookController,
  ],
  providers: [ZettazPayService],
  exports: [ZettazPayService],
})
export class ZettazPayModule {}

