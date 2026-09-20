/**
 * Stripe Billing module
 *
 * Handles:
 *  - POST /webhooks/stripe  — signature-verified lifecycle events
 *  - POST /staff/v1/workspace/billing-portal — create a Stripe Customer Portal session
 *
 * Environment variables required:
 *   STRIPE_SECRET_KEY        — sk_live_... (Zettaz SaaS Billing only)
 *   STRIPE_WEBHOOK_SECRET    — whsec_...   (Billing webhooks only)
 *
 * Traveler collections use apps/api/src/stripe-pay.ts (STRIPE_PAY_*).
 */

import {
  Module,
  Injectable,
  Controller,
  Post,
  Headers,
  Req,
  Res,
  Body,
  HttpCode,
  BadRequestException,
} from "@nestjs/common";
import { z } from "zod";
import { Database } from "./database";
import { Actor } from "../../../packages/shared/src/contracts";
import { Access, CurrentActor } from "./http";
import type {
  Request as ExpressRequest,
  Response as ExpressResponse,
} from "express";
import {
  sendCheckoutConfirmation,
  sendPlanSwitched,
  sendPaymentFailed,
} from "./email";
import Stripe from "stripe";

// ─── Stripe singleton ─────────────────────────────────────────────────────────

function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY is not set");
  return new Stripe(key, { apiVersion: "2026-08-26.dahlia" });
}

// ─── Service ──────────────────────────────────────────────────────────────────

@Injectable()
export class StripeBillingService {
  constructor(private readonly db: Database) {}

  // ── Webhook event handler ───────────────────────────────────────────────────

  async handleWebhookEvent(event: Stripe.Event): Promise<void> {
    switch (event.type) {
      case "customer.subscription.created":
      case "customer.subscription.updated": {
        const sub = event.data.object as Stripe.Subscription;
        await this.upsertSubscription(sub);
        break;
      }
      case "customer.subscription.deleted": {
        const sub = event.data.object as Stripe.Subscription;
        await this.markSubscriptionCanceled(sub);
        break;
      }
      case "invoice.payment_failed": {
        const inv = event.data.object as Stripe.Invoice;
        const subId1 = (inv as unknown as { subscription: string | null })
          .subscription;
        if (subId1) {
          await this.setSubscriptionStatus(subId1, "past_due");
          // Send dunning email (non-blocking)
          void this.sendPaymentFailedEmail(subId1, inv).catch(() => {});
        }
        break;
      }
      case "invoice.paid": {
        const inv = event.data.object as Stripe.Invoice;
        const subId2 = (inv as unknown as { subscription: string | null })
          .subscription;
        if (subId2) {
          await this.setSubscriptionStatus(subId2, "active");
        }
        break;
      }
      default:
        // Unhandled event — safe to ignore
        break;
    }
  }

  // ── DB helpers ──────────────────────────────────────────────────────────────

  private async sendPaymentFailedEmail(
    stripeSubId: string,
    inv: Stripe.Invoice,
  ): Promise<void> {
    const res = await this.db.pool.query<{
      email: string;
      tenantName: string;
      planName: string;
      amountDue: number;
      currency: string;
    }>(
      `SELECT s.email, t.name AS "tenantName", p.name AS "planName"
         FROM tenant_subscriptions ts
         JOIN tenants t ON t.id = ts.tenant_id
         JOIN subscription_plans p ON p.id = ts.plan_id
         JOIN memberships m ON m.tenant_id = t.id AND m.role = 'owner' AND m.active
         JOIN staff_users s ON s.id = m.actor_id
         WHERE ts.stripe_subscription_id = $1 LIMIT 1`,
      [stripeSubId],
    );
    const row = res.rows[0];
    if (!row) return;
    const invObj = inv as unknown as {
      amount_due: number;
      currency: string;
      attempt_count?: number;
    };
    await sendPaymentFailed({
      to: row.email,
      tenantName: row.tenantName,
      planName: row.planName,
      amountDue: invObj.amount_due ?? 0,
      currency: (invObj.currency ?? "usd").toUpperCase(),
      attemptNumber: invObj.attempt_count ?? 1,
      manageUrl: `${process.env.FRONTEND_URL ?? "https://tours.zettaz.com"}/profile?tab=subscription`,
    });
  }

  private async upsertSubscription(sub: Stripe.Subscription): Promise<void> {
    // Map the Stripe price ID back to our subscription_plans row
    const priceId = sub.items.data[0]?.price?.id ?? null;
    if (!priceId) return;

    const planRes = await this.db.pool.query<{ id: string; name: string }>(
      `SELECT id FROM subscription_plans
        WHERE stripe_price_id_monthly = $1 OR stripe_price_id_yearly = $1
        LIMIT 1`,
      [priceId],
    );
    if (!planRes.rows.length) {
      console.warn(`[StripeBilling] No plan found for price ${priceId}`);
      return;
    }

    const planId = planRes.rows[0]!.id;
    const customerId = String(sub.customer);
    const status = sub.status as string;
    const billingCycle: "monthly" | "yearly" =
      sub.items.data[0]?.price?.recurring?.interval === "year"
        ? "yearly"
        : "monthly";
    const periodEndsAt = new Date(
      (sub as unknown as { current_period_end: number }).current_period_end *
        1000,
    ).toISOString();
    const trialEndsAt = sub.trial_end
      ? new Date(sub.trial_end * 1000).toISOString()
      : null;

    // Find the tenant by stripe_customer_id
    const tenantRes = await this.db.pool.query<{ tenant_id: string }>(
      `SELECT tenant_id FROM tenant_subscriptions WHERE stripe_customer_id = $1 LIMIT 1`,
      [customerId],
    );

    if (tenantRes.rows.length) {
      // Update existing subscription row
      await this.db.pool.query(
        `UPDATE tenant_subscriptions SET
           plan_id = $1, status = $2, billing_cycle = $3,
           period_ends_at = $4, trial_ends_at = $5,
           stripe_subscription_id = $6, cancel_at_period_end = $7, updated_at = NOW()
         WHERE stripe_customer_id = $8`,
        [
          planId,
          status,
          billingCycle,
          periodEndsAt,
          trialEndsAt,
          sub.id,
          sub.cancel_at_period_end ?? false,
          customerId,
        ],
      );
    } else {
      console.warn(
        `[StripeBilling] Received subscription event for unknown customer ${customerId}`,
      );
    }
  }

  private async markSubscriptionCanceled(
    sub: Stripe.Subscription,
  ): Promise<void> {
    await this.db.pool.query(
      `UPDATE tenant_subscriptions SET status = 'canceled', updated_at = NOW()
        WHERE stripe_subscription_id = $1`,
      [sub.id],
    );
  }

  private async setSubscriptionStatus(
    subscriptionId: string,
    status: string,
  ): Promise<void> {
    await this.db.pool.query(
      `UPDATE tenant_subscriptions SET status = $1, updated_at = NOW()
        WHERE stripe_subscription_id = $2`,
      [status, subscriptionId],
    );
  }

  // ── Checkout Session ────────────────────────────────────────────────────────

  async createCheckoutSession(
    tenantId: string,
    planId: string,
    cycle: "monthly" | "yearly",
    successUrl: string,
    cancelUrl: string,
  ): Promise<string> {
    const stripe = getStripe();

    // Resolve plan → Stripe price ID
    const planRes = await this.db.pool.query<{
      name: string;
      stripe_price_id_monthly: string;
      stripe_price_id_yearly: string | null;
    }>(
      `SELECT name, stripe_price_id_monthly, stripe_price_id_yearly
         FROM subscription_plans WHERE id = $1 AND active LIMIT 1`,
      [planId],
    );
    if (!planRes.rows.length) throw new BadRequestException("Plan not found");
    const plan = planRes.rows[0]!;
    const priceId =
      cycle === "yearly" && plan.stripe_price_id_yearly
        ? plan.stripe_price_id_yearly
        : plan.stripe_price_id_monthly;
    if (!priceId || priceId.startsWith("price_REPLACE"))
      throw new BadRequestException(
        "Stripe price not configured for this plan",
      );

    // Get or create Stripe customer for this tenant
    const subRes = await this.db.pool.query<{
      stripe_customer_id: string | null;
    }>(
      `SELECT stripe_customer_id FROM tenant_subscriptions WHERE tenant_id = $1 LIMIT 1`,
      [tenantId],
    );
    let customerId = subRes.rows[0]?.stripe_customer_id ?? null;

    if (!customerId) {
      // Pull tenant name + owner email for the customer record
      const tenantRes = await this.db.pool.query<{
        name: string;
        email: string;
      }>(
        `SELECT t.name, s.email
           FROM tenants t
           JOIN memberships m ON m.tenant_id = t.id AND m.role = 'owner' AND m.active
           JOIN staff_users s ON s.id = m.actor_id
           WHERE t.id = $1 LIMIT 1`,
        [tenantId],
      );
      const tenantInfo = tenantRes.rows[0];
      const customer = await stripe.customers.create({
        name: tenantInfo?.name,
        email: tenantInfo?.email,
        metadata: { tenantId },
      });
      customerId = customer.id;
      // Persist customer ID immediately so webhooks can match it
      await this.db.pool.query(
        `UPDATE tenant_subscriptions SET stripe_customer_id = $1, updated_at = NOW()
           WHERE tenant_id = $2`,
        [customerId, tenantId],
      );
    }

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: successUrl,
      cancel_url: cancelUrl,
      subscription_data: {
        metadata: { tenantId },
        trial_period_days: 14,
      },
      allow_promotion_codes: true,
    });

    // Fire confirmation email (non-blocking)
    void (async () => {
      try {
        const ownerRes = await this.db.pool.query<{
          email: string;
          name: string;
        }>(
          `SELECT s.email, t.name
             FROM tenants t
             JOIN memberships m ON m.tenant_id = t.id AND m.role = 'owner' AND m.active
             JOIN staff_users s ON s.id = m.actor_id
             WHERE t.id = $1 LIMIT 1`,
          [tenantId],
        );
        const owner = ownerRes.rows[0];
        if (owner) {
          await sendCheckoutConfirmation({
            to: owner.email,
            tenantName: owner.name,
            planName: plan.name,
            billingCycle: cycle,
            trialEndsAt: new Date(
              Date.now() + 14 * 24 * 60 * 60 * 1000,
            ).toISOString(),
            manageUrl: successUrl,
          });
        }
      } catch (e) {
        console.error(
          "[StripeBilling] Checkout confirmation email failed:",
          e instanceof Error ? e.message : e,
        );
      }
    })();

    return session.url!;
  }

  // ── Billing Portal ──────────────────────────────────────────────────────────

  async createPortalSession(
    tenantId: string,
    returnUrl: string,
  ): Promise<string> {
    const res = await this.db.pool.query<{ stripe_customer_id: string }>(
      `SELECT stripe_customer_id FROM tenant_subscriptions WHERE tenant_id = $1 LIMIT 1`,
      [tenantId],
    );
    const customerId = res.rows[0]?.stripe_customer_id;
    if (!customerId)
      throw new Error("No Stripe customer found for this tenant.");

    const stripe = getStripe();
    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: returnUrl,
    });
    return session.url;
  }

  // ── Plan switching (for active/trialing subscribers) ──────────────────────

  async switchPlan(
    tenantId: string,
    planId: string,
    cycle: "monthly" | "yearly",
  ): Promise<{ status: "switched"; planName: string }> {
    const stripe = getStripe();

    // Get plan + current subscription
    const [planRes, subRes] = await Promise.all([
      this.db.pool.query<{
        name: string;
        stripe_price_id_monthly: string;
        stripe_price_id_yearly: string | null;
      }>(
        `SELECT name, stripe_price_id_monthly, stripe_price_id_yearly
           FROM subscription_plans WHERE id = $1 AND active LIMIT 1`,
        [planId],
      ),
      this.db.pool.query<{
        stripe_subscription_id: string | null;
        stripe_customer_id: string | null;
      }>(
        `SELECT stripe_subscription_id, stripe_customer_id
           FROM tenant_subscriptions WHERE tenant_id = $1 LIMIT 1`,
        [tenantId],
      ),
    ]);

    if (!planRes.rows.length) throw new BadRequestException("Plan not found");
    const plan = planRes.rows[0]!;

    const priceId =
      cycle === "yearly" && plan.stripe_price_id_yearly
        ? plan.stripe_price_id_yearly
        : plan.stripe_price_id_monthly;
    if (!priceId || priceId.startsWith("price_REPLACE"))
      throw new BadRequestException(
        "Stripe price not configured for this plan",
      );

    const stripeSubId = subRes.rows[0]?.stripe_subscription_id;
    if (!stripeSubId)
      throw new BadRequestException(
        "No active Stripe subscription found. Please start a new plan.",
      );

    // Retrieve the Stripe subscription to get the item ID
    const stripeSub = await stripe.subscriptions.retrieve(stripeSubId);
    const itemId = stripeSub.items.data[0]?.id;
    if (!itemId) throw new BadRequestException("No subscription item found");

    // Update the subscription with proration — charges/credits prorated immediately
    await stripe.subscriptions.update(stripeSubId, {
      items: [{ id: itemId, price: priceId }],
      proration_behavior: "create_prorations",
      metadata: { tenantId },
    });

    // Webhook (customer.subscription.updated) will update our DB automatically.
    // Optimistically update plan_id and billing_cycle in DB for immediate UI feedback.
    await this.db.pool.query(
      `UPDATE tenant_subscriptions
         SET plan_id = $1, billing_cycle = $2, updated_at = NOW()
         WHERE tenant_id = $3`,
      [planId, cycle, tenantId],
    );

    // Fire plan-switched email (non-blocking)
    void (async () => {
      try {
        const ownerRes = await this.db.pool.query<{
          email: string;
          tenantName: string;
          oldPlanName: string;
        }>(
          `SELECT s.email, t.name AS "tenantName", p.name AS "oldPlanName"
             FROM tenants t
             JOIN memberships m ON m.tenant_id = t.id AND m.role = 'owner' AND m.active
             JOIN staff_users s ON s.id = m.actor_id
             LEFT JOIN tenant_subscriptions ts ON ts.tenant_id = t.id
             LEFT JOIN subscription_plans p ON p.id = ts.plan_id
             WHERE t.id = $1 LIMIT 1`,
          [tenantId],
        );
        const owner = ownerRes.rows[0];
        if (owner) {
          await sendPlanSwitched({
            to: owner.email,
            tenantName: owner.tenantName,
            oldPlanName: owner.oldPlanName ?? "Previous plan",
            newPlanName: plan.name,
            billingCycle: cycle,
            manageUrl: `${process.env.FRONTEND_URL ?? "https://tours.zettaz.com"}/profile?tab=subscription`,
          });
        }
      } catch (e) {
        console.error(
          "[StripeBilling] Plan switched email failed:",
          e instanceof Error ? e.message : e,
        );
      }
    })();

    return { status: "switched", planName: plan.name };
  }
}

// ─── Webhook Controller (public route — no auth guard) ────────────────────────

@Controller("webhooks")
export class StripeWebhookController {
  constructor(private readonly billing: StripeBillingService) {}

  @Post("stripe")
  @HttpCode(200)
  async handleWebhook(
    @Headers("stripe-signature") sig: string,
    @Req() req: ExpressRequest,
    @Res() res: ExpressResponse,
  ) {
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    const isProduction = process.env.NODE_ENV === "production";
    // Set STRIPE_WEBHOOK_SKIP_VERIFICATION=true in .env for local dev without Stripe CLI.
    // Never set this in production — webhook secret is always required there.
    const skipVerification =
      process.env.STRIPE_WEBHOOK_SKIP_VERIFICATION === "true";

    if (!webhookSecret) {
      if (isProduction) {
        console.error(
          "[StripeBilling] STRIPE_WEBHOOK_SECRET not configured — rejecting webhook in production",
        );
        res.status(500).json({ error: "Webhook not configured" });
        return;
      }
      if (!skipVerification) {
        console.error(
          "[StripeBilling] STRIPE_WEBHOOK_SECRET not set. Use Stripe CLI (stripe listen --forward-to ...) or set STRIPE_WEBHOOK_SKIP_VERIFICATION=true for local dev.",
        );
        res.status(500).json({ error: "Webhook secret not configured" });
        return;
      }
      console.warn(
        "[StripeBilling] ⚠️  Webhook signature verification SKIPPED (STRIPE_WEBHOOK_SKIP_VERIFICATION=true) — dev only",
      );
    }

    if (webhookSecret && !sig) {
      console.warn(
        "[StripeBilling] Webhook rejected: missing stripe-signature header",
      );
      res.status(400).json({ error: "Missing stripe-signature header" });
      return;
    }

    const rawBody = req.body as Buffer;
    if (!rawBody || rawBody.length === 0) {
      res.status(400).json({ error: "Missing request body" });
      return;
    }

    let event: Stripe.Event;
    try {
      const stripe = getStripe();
      if (webhookSecret) {
        // Always verify when secret is configured
        event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
      } else {
        // Only reachable in dev with STRIPE_WEBHOOK_SKIP_VERIFICATION=true
        event = JSON.parse(rawBody.toString()) as Stripe.Event;
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(
        `[StripeBilling] Webhook signature verification failed: ${msg}`,
      );
      res.status(400).json({ error: "Invalid signature" });
      return;
    }

    console.log(
      `[StripeBilling] Received Stripe webhook: ${event.type} (id: ${event.id})`,
    );

    try {
      await this.billing.handleWebhookEvent(event);
    } catch (err) {
      console.error("[StripeBilling] Error processing event", event.type, err);
      // Return 200 so Stripe doesn't retry events we received but failed to process internally.
      // Log to your error tracker here.
    }

    res.json({ received: true });
  }
}

// ─── Billing Portal Controller (staff auth required) ──────────────────────────

@Controller("staff/v1/workspace")
export class BillingPortalController {
  constructor(private readonly billing: StripeBillingService) {}

  @Post("billing-portal")
  async createPortal(
    @Req() req: ExpressRequest & { tenantId?: string },
    @Body() body: { returnUrl: string },
  ): Promise<{ url: string }> {
    const tenantId = req.tenantId;
    if (!tenantId) throw new Error("Unauthorized");
    const url = await this.billing.createPortalSession(
      tenantId,
      body.returnUrl,
    );
    return { url };
  }

  @Post("checkout")
  @Access("config.write")
  async createCheckout(
    @CurrentActor() actor: Actor,
    @Body() body: unknown,
  ): Promise<{ url: string }> {
    const input = z
      .object({
        planId: z.string().uuid(),
        cycle: z.enum(["monthly", "yearly"]),
        successUrl: z.string().url(),
        cancelUrl: z.string().url(),
      })
      .parse(body);

    if (!actor.tenantId) throw new BadRequestException("No tenant context");
    const url = await this.billing.createCheckoutSession(
      actor.tenantId,
      input.planId,
      input.cycle,
      input.successUrl,
      input.cancelUrl,
    );
    return { url };
  }

  @Post("switch-plan")
  @Access("config.write")
  async switchPlan(
    @CurrentActor() actor: Actor,
    @Body() body: unknown,
  ): Promise<{ status: "switched"; planName: string }> {
    if (!actor.tenantId) throw new BadRequestException("No tenant context");
    const input = z
      .object({
        planId: z.string().uuid(),
        cycle: z.enum(["monthly", "yearly"]),
      })
      .parse(body);
    return this.billing.switchPlan(actor.tenantId, input.planId, input.cycle);
  }
}

// ─── Module ───────────────────────────────────────────────────────────────────

@Module({
  controllers: [StripeWebhookController, BillingPortalController],
  providers: [StripeBillingService],
  exports: [StripeBillingService],
})
export class StripeBillingModule {}
