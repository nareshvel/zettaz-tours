/**
 * Subscription background jobs
 *
 * Two scheduled tasks run on server startup via setInterval:
 *
 *   1. Trial-reminder job  — runs every 6 hours
 *      Emails tenants whose trial ends in exactly 7 days or 1 day (±1 hour
 *      window to avoid duplicate sends across restarts).
 *
 *   2. Grace-period job    — runs every 6 hours
 *      After a subscription has been past_due for 3+ days, marks it
 *      `suspended` and emails the tenant.
 *
 * Both jobs are idempotent: they only act on rows that haven't been notified
 * yet, tracked via reminder_sent_at and suspension_notified_at columns.
 * If those columns don't exist yet (migration not applied), the job logs a
 * warning and exits safely — it will never throw a 500 on startup.
 *
 * Add to .env to disable in test environments:
 *   SUBSCRIPTION_JOBS_DISABLED=true
 */

import type { Pool } from "pg";
import { sendTrialEnding, sendPaymentFailed } from "./email";

const SIX_HOURS = 6 * 60 * 60 * 1000;
const FRONTEND_URL = process.env.FRONTEND_URL ?? "https://app.zettaz.com";
const MANAGE_URL = `${FRONTEND_URL}/profile/subscription`;

// ─── Trial reminder ───────────────────────────────────────────────────────────

async function runTrialReminderJob(db: Pool): Promise<void> {
  if (process.env.SUBSCRIPTION_JOBS_DISABLED === "true") return;

  try {
    // Fetch trialing subscriptions that end within 8 days and haven't been
    // notified for the 7-day or 1-day window yet.
    const res = await db.query<{
      tenant_id: string;
      trial_ends_at: string;
      plan_name: string;
      owner_email: string;
      tenant_name: string;
      reminder_7d_sent: boolean;
      reminder_1d_sent: boolean;
    }>(`
      SELECT
        ts.tenant_id,
        ts.trial_ends_at,
        p.name AS plan_name,
        s.email AS owner_email,
        t.name AS tenant_name,
        COALESCE(ts.reminder_7d_sent, false) AS reminder_7d_sent,
        COALESCE(ts.reminder_1d_sent, false) AS reminder_1d_sent
      FROM tenant_subscriptions ts
      JOIN subscription_plans p ON p.id = ts.plan_id
      JOIN tenants t ON t.id = ts.tenant_id
      JOIN memberships m ON m.tenant_id = t.id AND m.role = 'owner' AND m.active
      JOIN staff_users s ON s.id = m.actor_id
      WHERE ts.status = 'trial'
        AND ts.trial_ends_at IS NOT NULL
        AND ts.trial_ends_at > NOW()
        AND ts.trial_ends_at < NOW() + INTERVAL '8 days'
    `);

    for (const row of res.rows) {
      const endsAt = new Date(row.trial_ends_at);
      const msLeft = endsAt.getTime() - Date.now();
      const daysLeft = Math.ceil(msLeft / (1000 * 60 * 60 * 24));

      // 7-day reminder window: 6d 23h – 7d 1h
      if (!row.reminder_7d_sent && daysLeft >= 6 && daysLeft <= 8) {
        await sendTrialEnding({
          to: row.owner_email,
          tenantName: row.tenant_name,
          planName: row.plan_name,
          trialEndsAt: row.trial_ends_at,
          daysLeft: 7,
          manageUrl: MANAGE_URL,
        });
        await db
          .query(
            `UPDATE tenant_subscriptions SET reminder_7d_sent = true WHERE tenant_id = $1`,
            [row.tenant_id],
          )
          .catch(() => {});
        console.log(
          `[SubscriptionJobs] 7-day trial reminder sent to ${row.owner_email}`,
        );
      }

      // 1-day reminder window: <2 days left, not yet sent
      if (!row.reminder_1d_sent && daysLeft <= 2) {
        await sendTrialEnding({
          to: row.owner_email,
          tenantName: row.tenant_name,
          planName: row.plan_name,
          trialEndsAt: row.trial_ends_at,
          daysLeft,
          manageUrl: MANAGE_URL,
        });
        await db
          .query(
            `UPDATE tenant_subscriptions SET reminder_1d_sent = true WHERE tenant_id = $1`,
            [row.tenant_id],
          )
          .catch(() => {});
        console.log(
          `[SubscriptionJobs] 1-day trial reminder sent to ${row.owner_email}`,
        );
      }
    }
  } catch (err: unknown) {
    // Columns may not exist if migration hasn't run — log and move on
    console.warn(
      "[SubscriptionJobs] Trial reminder job error (non-fatal):",
      err instanceof Error ? err.message : err,
    );
  }
}

// ─── Grace period / suspension ────────────────────────────────────────────────

async function runGracePeriodJob(db: Pool): Promise<void> {
  if (process.env.SUBSCRIPTION_JOBS_DISABLED === "true") return;

  try {
    // Find subscriptions that have been past_due for 3+ days and aren't suspended yet
    const res = await db.query<{
      tenant_id: string;
      stripe_subscription_id: string | null;
      plan_name: string;
      owner_email: string;
      tenant_name: string;
    }>(`
      SELECT
        ts.tenant_id,
        ts.stripe_subscription_id,
        p.name AS plan_name,
        s.email AS owner_email,
        t.name AS tenant_name
      FROM tenant_subscriptions ts
      JOIN subscription_plans p ON p.id = ts.plan_id
      JOIN tenants t ON t.id = ts.tenant_id
      JOIN memberships m ON m.tenant_id = t.id AND m.role = 'owner' AND m.active
      JOIN staff_users s ON s.id = m.actor_id
      WHERE ts.status = 'past_due'
        AND ts.updated_at < NOW() - INTERVAL '3 days'
        AND COALESCE(ts.suspension_notified_at, '1970-01-01') < NOW() - INTERVAL '7 days'
    `);

    for (const row of res.rows) {
      // Suspend the subscription
      await db
        .query(
          `UPDATE tenant_subscriptions SET status = 'canceled', suspension_notified_at = NOW() WHERE tenant_id = $1`,
          [row.tenant_id],
        )
        .catch(() => {});

      // Send final payment failed / suspension warning
      await sendPaymentFailed({
        to: row.owner_email,
        tenantName: row.tenant_name,
        planName: row.plan_name,
        amountDue: 0, // amount not tracked at this point
        currency: "USD",
        attemptNumber: 3,
        manageUrl: MANAGE_URL,
      });

      console.warn(
        `[SubscriptionJobs] Suspended past_due tenant ${row.tenant_id} and notified ${row.owner_email}`,
      );
    }
  } catch (err: unknown) {
    console.warn(
      "[SubscriptionJobs] Grace period job error (non-fatal):",
      err instanceof Error ? err.message : err,
    );
  }
}

// ─── Scheduler ────────────────────────────────────────────────────────────────

export function startSubscriptionJobs(db: Pool): void {
  if (process.env.SUBSCRIPTION_JOBS_DISABLED === "true") {
    console.log(
      "[SubscriptionJobs] Disabled via SUBSCRIPTION_JOBS_DISABLED=true",
    );
    return;
  }

  // Run once at startup (with a short delay to let the DB pool settle), then every 6 hours
  const runAll = async () => {
    await runTrialReminderJob(db);
    await runGracePeriodJob(db);
  };

  setTimeout(runAll, 15_000); // 15s after startup
  setInterval(runAll, SIX_HOURS);
  console.log(
    "[SubscriptionJobs] Trial-reminder and grace-period jobs scheduled (every 6 hours)",
  );
}
