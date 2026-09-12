/**
 * EmailService — thin nodemailer wrapper
 *
 * Reads SMTP_* env vars set in .env / .env.development / .env.production.
 * All methods are fire-and-forget safe: callers should catch and log errors
 * rather than letting a failed email break a billing operation.
 *
 * Dev: point SMTP_HOST at Mailtrap sandbox — no real emails sent.
 * Prod: point SMTP_HOST at smtp.postmarkapp.com with Postmark API token.
 */

import * as nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";

// ─── Singleton transporter ────────────────────────────────────────────────────

let _transporter: Transporter | null = null;

function getTransporter(): Transporter {
  if (_transporter) return _transporter;

  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT ?? 587);
  const secure = process.env.SMTP_SECURE === "true";
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) {
    console.warn("[Email] SMTP_HOST / SMTP_USER / SMTP_PASS not fully configured — emails will be skipped.");
    // Return a null-transport so the app doesn't crash when SMTP isn't configured
    _transporter = nodemailer.createTransport({ jsonTransport: true });
    return _transporter;
  }

  _transporter = nodemailer.createTransport({ host, port, secure, auth: { user, pass } });
  return _transporter;
}

const FROM = process.env.SMTP_FROM ?? "Zettaz Tours <noreply@zettaz.com>";

// ─── Shared send helper ───────────────────────────────────────────────────────

async function send(opts: { to: string; subject: string; html: string }): Promise<void> {
  try {
    const t = getTransporter();
    await t.sendMail({ from: FROM, ...opts });
    console.log(`[Email] Sent "${opts.subject}" → ${opts.to}`);
  } catch (err: unknown) {
    console.error(`[Email] Failed to send "${opts.subject}" → ${opts.to}:`, err instanceof Error ? err.message : err);
  }
}

// ─── Shared layout ────────────────────────────────────────────────────────────

function layout(body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <style>
    body { margin:0; padding:0; background:#f5f7f7; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif; }
    .wrap { max-width:560px; margin:40px auto; background:#fff; border-radius:12px; overflow:hidden; box-shadow:0 2px 12px rgba(0,0,0,.06); }
    .header { background:#142f36; padding:28px 32px; }
    .header h1 { margin:0; color:#fff; font-size:20px; font-weight:800; letter-spacing:-0.3px; }
    .header p { margin:4px 0 0; color:rgba(255,255,255,.55); font-size:13px; }
    .body { padding:32px; color:#172f35; font-size:14px; line-height:1.6; }
    .body h2 { margin:0 0 8px; font-size:18px; font-weight:800; color:#142f36; }
    .cta { display:inline-block; margin:24px 0 0; padding:12px 28px; background:#176c63; color:#fff; border-radius:8px; text-decoration:none; font-weight:700; font-size:14px; }
    .info-row { display:flex; justify-content:space-between; padding:10px 0; border-bottom:1px solid #eef0f0; font-size:13px; }
    .info-row:last-child { border-bottom:none; }
    .info-label { color:#65777b; }
    .info-val { font-weight:600; }
    .footer { padding:20px 32px; background:#f5f7f7; font-size:11px; color:#65777b; text-align:center; }
    .footer a { color:#176c63; text-decoration:none; }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="header">
      <h1>Zettaz Tours &amp; Charters</h1>
      <p>Subscription &amp; Billing</p>
    </div>
    <div class="body">${body}</div>
    <div class="footer">
      Zettaz Global LLC &nbsp;·&nbsp; <a href="mailto:support@zettaz.com">support@zettaz.com</a><br/>
      You received this because you manage a Zettaz Tours workspace.
    </div>
  </div>
</body>
</html>`;
}

// ─── Email methods ────────────────────────────────────────────────────────────

export interface CheckoutConfirmationData {
  to: string;
  tenantName: string;
  planName: string;
  billingCycle: "monthly" | "yearly";
  trialEndsAt: string; // ISO date string
  manageUrl: string;
}

export async function sendCheckoutConfirmation(d: CheckoutConfirmationData): Promise<void> {
  const trialDate = new Date(d.trialEndsAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  const cycleLabel = d.billingCycle === "yearly" ? "annually" : "monthly";
  await send({
    to: d.to,
    subject: `Your ${d.planName} trial has started — Zettaz Tours`,
    html: layout(`
      <h2>Welcome to ${d.planName}! 🎉</h2>
      <p>Your 14-day free trial for <strong>${d.tenantName}</strong> is now active. You won't be charged until the trial ends.</p>
      <div style="margin:20px 0;background:#f5f7f7;border-radius:8px;padding:4px 16px;">
        <div class="info-row"><span class="info-label">Plan</span><span class="info-val">${d.planName}</span></div>
        <div class="info-row"><span class="info-label">Billing</span><span class="info-val">Billed ${cycleLabel} after trial</span></div>
        <div class="info-row"><span class="info-label">Trial ends</span><span class="info-val">${trialDate}</span></div>
      </div>
      <p>You can manage your subscription, update payment details, or cancel anytime from your billing portal.</p>
      <a class="cta" href="${d.manageUrl}">Manage subscription</a>
    `),
  });
}

export interface PlanSwitchedData {
  to: string;
  tenantName: string;
  oldPlanName: string;
  newPlanName: string;
  billingCycle: "monthly" | "yearly";
  manageUrl: string;
}

export async function sendPlanSwitched(d: PlanSwitchedData): Promise<void> {
  const cycleLabel = d.billingCycle === "yearly" ? "annually" : "monthly";
  await send({
    to: d.to,
    subject: `Plan changed to ${d.newPlanName} — Zettaz Tours`,
    html: layout(`
      <h2>Your plan has been updated</h2>
      <p>The subscription for <strong>${d.tenantName}</strong> has been switched. Any unused time from your previous plan will appear as a credit on your next invoice.</p>
      <div style="margin:20px 0;background:#f5f7f7;border-radius:8px;padding:4px 16px;">
        <div class="info-row"><span class="info-label">Previous plan</span><span class="info-val">${d.oldPlanName}</span></div>
        <div class="info-row"><span class="info-label">New plan</span><span class="info-val">${d.newPlanName}</span></div>
        <div class="info-row"><span class="info-label">Billing</span><span class="info-val">Billed ${cycleLabel}</span></div>
      </div>
      <a class="cta" href="${d.manageUrl}">View billing details</a>
    `),
  });
}

export interface TrialEndingData {
  to: string;
  tenantName: string;
  planName: string;
  trialEndsAt: string; // ISO date string
  daysLeft: number;
  manageUrl: string;
}

export async function sendTrialEnding(d: TrialEndingData): Promise<void> {
  const trialDate = new Date(d.trialEndsAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  const urgency = d.daysLeft <= 1 ? "tomorrow" : `in ${d.daysLeft} days`;
  await send({
    to: d.to,
    subject: `Your Zettaz Tours trial ends ${urgency}`,
    html: layout(`
      <h2>Your free trial is ending ${urgency}</h2>
      <p>The 14-day trial for <strong>${d.tenantName}</strong> on the <strong>${d.planName}</strong> plan ends on <strong>${trialDate}</strong>.</p>
      <p>To keep uninterrupted access, make sure your payment method is confirmed in the billing portal. If you decide not to continue, you can cancel before the trial ends — no charge will be made.</p>
      <a class="cta" href="${d.manageUrl}">Manage subscription</a>
      <p style="margin-top:16px;font-size:12px;color:#65777b;">Questions? Reply to this email or contact <a href="mailto:support@zettaz.com" style="color:#176c63;">support@zettaz.com</a>.</p>
    `),
  });
}

export interface PaymentFailedData {
  to: string;
  tenantName: string;
  planName: string;
  amountDue: number; // in cents
  currency: string;
  attemptNumber: number;
  manageUrl: string;
}

export async function sendPaymentFailed(d: PaymentFailedData): Promise<void> {
  const amount = (d.amountDue / 100).toLocaleString("en-US", { style: "currency", currency: d.currency });
  const isLast = d.attemptNumber >= 3;
  await send({
    to: d.to,
    subject: `Action required: payment failed for ${d.tenantName} — Zettaz Tours`,
    html: layout(`
      <h2>Payment attempt ${d.attemptNumber} failed</h2>
      <p>We were unable to collect payment of <strong>${amount}</strong> for the <strong>${d.planName}</strong> plan on the <strong>${d.tenantName}</strong> workspace.</p>
      ${isLast
        ? `<p style="color:#c0392b;font-weight:600;">This was the final attempt. Your subscription will be suspended unless payment is resolved.</p>`
        : `<p>Stripe will automatically retry. To avoid interruption, please update your payment method now.</p>`}
      <a class="cta" href="${d.manageUrl}">Update payment method</a>
      <p style="margin-top:16px;font-size:12px;color:#65777b;">Need help? Contact <a href="mailto:support@zettaz.com" style="color:#176c63;">support@zettaz.com</a>.</p>
    `),
  });
}

export interface PasswordRecoveryData {
  to: string;
  resetUrl: string;
}

export async function sendPasswordRecovery(d: PasswordRecoveryData): Promise<void> {
  await send({
    to: d.to,
    subject: "Reset your Zettaz Tours password",
    html: layout(`
      <h2>Reset your password</h2>
      <p>We received a request to reset the password for your Zettaz Tours & Charters account.</p>
      <p>Click the button below to choose a new password. This link is valid for <strong>1 hour</strong> and can only be used once.</p>
      <a class="cta" href="${d.resetUrl}">Reset my password →</a>
      <p style="margin-top:24px;font-size:12px;color:#65777b;">If you didn't request this, you can safely ignore this email — your password won't change.</p>
      <p style="font-size:12px;color:#65777b;">Or copy this link into your browser:<br><span style="word-break:break-all;">${d.resetUrl}</span></p>
    `),
  });
}
