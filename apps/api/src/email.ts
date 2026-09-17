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
import { parseCommunicationBody } from "./customer-booking-email.js";

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
    console.warn(
      "[Email] SMTP_HOST / SMTP_USER / SMTP_PASS not fully configured — emails will be skipped.",
    );
    // Return a null-transport so the app doesn't crash when SMTP isn't configured
    _transporter = nodemailer.createTransport({ jsonTransport: true });
    return _transporter;
  }

  _transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
  });
  return _transporter;
}

const FROM = process.env.SMTP_FROM ?? "Zettaz Tours <noreply@zettaz.com>";

// ─── Shared send helper ───────────────────────────────────────────────────────

async function send(opts: {
  to: string;
  subject: string;
  html: string;
}): Promise<void> {
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!host || !user || !pass) {
    console.warn(
      `[Email] SKIPPED (SMTP not configured): "${opts.subject}" → ${opts.to}`,
    );
    return;
  }
  try {
    const t = getTransporter();
    await t.sendMail({ from: FROM, ...opts });
    console.log(`[Email] Sent "${opts.subject}" → ${opts.to}`);
  } catch (err: unknown) {
    console.error(
      `[Email] Failed to send "${opts.subject}" → ${opts.to}:`,
      err instanceof Error ? err.message : err,
    );
    throw err;
  }
}

// ─── Shared layout ────────────────────────────────────────────────────────────

function layout(
  body: string,
  opts: { eyebrow?: string; preheader?: string } = {},
): string {
  const eyebrow = opts.eyebrow ?? "Workspace";
  const preheader = opts.preheader ?? "";
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <meta name="color-scheme" content="light" />
  <meta name="supported-color-schemes" content="light" />
  <title>Zettaz Tours &amp; Charters</title>
  <style>
    body { margin:0; padding:0; background:#edf3f3; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; }
    a { color:#176c63; }
    .wrap { max-width:560px; margin:32px auto; background:#ffffff; border-radius:16px; overflow:hidden; box-shadow:0 10px 36px rgba(20,47,54,.08); }
    .header { background:linear-gradient(145deg,#11343b 0%,#176c63 100%); padding:28px 32px 26px; }
    .header .brand { margin:0; color:#ffffff; font-size:20px; font-weight:800; letter-spacing:-0.3px; line-height:1.25; }
    .header .eyebrow { margin:8px 0 0; color:rgba(255,255,255,.72); font-size:12px; font-weight:600; letter-spacing:.06em; text-transform:uppercase; }
    .accent { height:4px; background:#c8e8e3; }
    .body { padding:32px; color:#243b41; font-size:15px; line-height:1.65; }
    .body h2 { margin:0 0 12px; font-size:22px; font-weight:800; color:#142f36; letter-spacing:-0.3px; line-height:1.25; }
    .body p { margin:0 0 14px; }
    .cta-wrap { margin:28px 0 8px; }
    .cta {
      display:inline-block;
      padding:14px 28px;
      background-color:#176c63;
      color:#ffffff !important;
      border-radius:10px;
      text-decoration:none;
      font-weight:700;
      font-size:15px;
      line-height:1.2;
      border:1px solid #145a53;
    }
    .muted { color:#65777b; font-size:13px; line-height:1.55; }
    .link-box {
      margin:18px 0 0;
      padding:14px 16px;
      background:#f5f8f8;
      border:1px solid #e3ecec;
      border-radius:10px;
      word-break:break-all;
      font-size:12px;
      color:#45676b;
      line-height:1.5;
    }
    .info-row { display:flex; justify-content:space-between; padding:10px 0; border-bottom:1px solid #eef0f0; font-size:13px; }
    .info-row:last-child { border-bottom:none; }
    .info-label { color:#65777b; }
    .info-val { font-weight:600; }
    .footer { padding:22px 32px; background:#f5f8f8; font-size:11px; color:#65777b; text-align:center; line-height:1.6; }
    .footer a { color:#176c63; text-decoration:none; }
    @media (max-width:620px) {
      .wrap { margin:0; border-radius:0; }
      .header, .body, .footer { padding-left:22px; padding-right:22px; }
    }
  </style>
</head>
<body>
  ${
    preheader
      ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${preheader}</div>`
      : ""
  }
  <div class="wrap">
    <div class="header">
      <p class="brand">Zettaz Tours &amp; Charters</p>
      <p class="eyebrow">${eyebrow}</p>
    </div>
    <div class="accent"></div>
    <div class="body">${body}</div>
    <div class="footer">
      Zettaz Global LLC &nbsp;·&nbsp; <a href="mailto:support@zettaz.com">support@zettaz.com</a><br/>
      You received this because you manage a Zettaz Tours workspace.
    </div>
  </div>
</body>
</html>`;
}

function ctaButton(href: string, label: string): string {
  // Nested span + inline color fights Gmail/Outlook link recoloring.
  return `<div class="cta-wrap" style="margin:28px 0 8px;">
  <a class="cta" href="${href}" style="display:inline-block;padding:14px 28px;background-color:#176c63;color:#ffffff !important;border-radius:10px;text-decoration:none;font-weight:700;font-size:15px;line-height:1.2;border:1px solid #145a53;">
    <span style="color:#ffffff !important;text-decoration:none;">${label}</span>
  </a>
</div>`;
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

export async function sendCheckoutConfirmation(
  d: CheckoutConfirmationData,
): Promise<void> {
  const trialDate = new Date(d.trialEndsAt).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
  const cycleLabel = d.billingCycle === "yearly" ? "annually" : "monthly";
  await send({
    to: d.to,
    subject: `Your ${d.planName} trial has started — Zettaz Tours`,
    html: layout(
      `
      <h2>Welcome to ${d.planName}</h2>
      <p>Your 14-day free trial for <strong>${d.tenantName}</strong> is now active. You won't be charged until the trial ends.</p>
      <div style="margin:20px 0;background:#f5f8f8;border-radius:10px;padding:4px 16px;border:1px solid #e3ecec;">
        <div class="info-row"><span class="info-label">Plan</span><span class="info-val">${d.planName}</span></div>
        <div class="info-row"><span class="info-label">Billing</span><span class="info-val">Billed ${cycleLabel} after trial</span></div>
        <div class="info-row"><span class="info-label">Trial ends</span><span class="info-val">${trialDate}</span></div>
      </div>
      <p>You can manage your subscription, update payment details, or cancel anytime from your billing portal.</p>
      ${ctaButton(d.manageUrl, "Manage subscription")}
    `,
      { eyebrow: "Subscription & billing" },
    ),
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
    html: layout(
      `
      <h2>Your plan has been updated</h2>
      <p>The subscription for <strong>${d.tenantName}</strong> has been switched. Any unused time from your previous plan will appear as a credit on your next invoice.</p>
      <div style="margin:20px 0;background:#f5f8f8;border-radius:10px;padding:4px 16px;border:1px solid #e3ecec;">
        <div class="info-row"><span class="info-label">Previous plan</span><span class="info-val">${d.oldPlanName}</span></div>
        <div class="info-row"><span class="info-label">New plan</span><span class="info-val">${d.newPlanName}</span></div>
        <div class="info-row"><span class="info-label">Billing</span><span class="info-val">Billed ${cycleLabel}</span></div>
      </div>
      ${ctaButton(d.manageUrl, "View billing details")}
    `,
      { eyebrow: "Subscription & billing" },
    ),
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
  const trialDate = new Date(d.trialEndsAt).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
  const urgency = d.daysLeft <= 1 ? "tomorrow" : `in ${d.daysLeft} days`;
  await send({
    to: d.to,
    subject: `Your Zettaz Tours trial ends ${urgency}`,
    html: layout(
      `
      <h2>Your free trial is ending ${urgency}</h2>
      <p>The 14-day trial for <strong>${d.tenantName}</strong> on the <strong>${d.planName}</strong> plan ends on <strong>${trialDate}</strong>.</p>
      <p>To keep uninterrupted access, make sure your payment method is confirmed in the billing portal. If you decide not to continue, you can cancel before the trial ends — no charge will be made.</p>
      ${ctaButton(d.manageUrl, "Manage subscription")}
      <p class="muted" style="margin-top:16px;">Questions? Reply to this email or contact <a href="mailto:support@zettaz.com" style="color:#176c63;">support@zettaz.com</a>.</p>
    `,
      { eyebrow: "Subscription & billing" },
    ),
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
  const amount = (d.amountDue / 100).toLocaleString("en-US", {
    style: "currency",
    currency: d.currency,
  });
  const isLast = d.attemptNumber >= 3;
  await send({
    to: d.to,
    subject: `Action required: payment failed for ${d.tenantName} — Zettaz Tours`,
    html: layout(
      `
      <h2>Payment attempt ${d.attemptNumber} failed</h2>
      <p>We were unable to collect payment of <strong>${amount}</strong> for the <strong>${d.planName}</strong> plan on the <strong>${d.tenantName}</strong> workspace.</p>
      ${
        isLast
          ? `<p style="color:#c0392b;font-weight:600;">This was the final attempt. Your subscription will be suspended unless payment is resolved.</p>`
          : `<p>Stripe will automatically retry. To avoid interruption, please update your payment method now.</p>`
      }
      ${ctaButton(d.manageUrl, "Update payment method")}
      <p class="muted" style="margin-top:16px;">Need help? Contact <a href="mailto:support@zettaz.com" style="color:#176c63;">support@zettaz.com</a>.</p>
    `,
      { eyebrow: "Subscription & billing" },
    ),
  });
}

export interface PasswordRecoveryData {
  to: string;
  resetUrl: string;
}

export async function sendPasswordRecovery(
  d: PasswordRecoveryData,
): Promise<void> {
  await send({
    to: d.to,
    subject: "Reset your Zettaz Tours password",
    html: layout(
      `
      <h2>Reset your password</h2>
      <p>We received a request to reset the password for your Zettaz Tours &amp; Charters account.</p>
      <p>Click the button below to choose a new password. This link is valid for <strong>1 hour</strong> and can only be used once.</p>
      ${ctaButton(d.resetUrl, "Reset my password →")}
      <p class="muted" style="margin-top:24px;">If you didn't request this, you can safely ignore this email — your password won't change.</p>
      <p class="muted">Or copy this link into your browser:</p>
      <div class="link-box">${d.resetUrl}</div>
    `,
      {
        eyebrow: "Account security",
        preheader:
          "Reset your Zettaz Tours password. This link expires in 1 hour.",
      },
    ),
  });
}

export interface EmailVerificationData {
  to: string;
  name: string;
  verifyUrl: string;
}

export async function sendEmailVerification(
  d: EmailVerificationData,
): Promise<void> {
  const firstName = escapeHtml(d.name.split(" ")[0] || d.name);
  const verifyUrl = escapeHtml(d.verifyUrl);
  await send({
    to: d.to,
    subject: "Verify your Zettaz Tours email address",
    html: layout(
      `
      <h2>You're almost there, ${firstName}</h2>
      <p>Thanks for signing up for Zettaz Tours &amp; Charters. Verify your email to open your workspace — your <strong>14-day free trial</strong> is ready once you confirm.</p>
      <p>This link is valid for <strong>24 hours</strong>.</p>
      ${ctaButton(d.verifyUrl, "Verify my email →")}
      <p class="muted" style="margin-top:24px;">Or copy this link into your browser:</p>
      <div class="link-box">${verifyUrl}</div>
      <p class="muted" style="margin-top:18px;">If you didn't create an account, you can safely ignore this email.</p>
    `,
      {
        eyebrow: "Email verification",
        preheader:
          "Verify your email to activate your Zettaz Tours workspace. Link expires in 24 hours.",
      },
    ),
  });
}

export interface StaffAccessInviteData {
  to: string;
  name: string;
  tenantName: string;
  roleName: string;
  activateUrl: string;
  token: string;
}

export async function sendStaffAccessInvite(
  d: StaffAccessInviteData,
): Promise<void> {
  await send({
    to: d.to,
    subject: `Activate your ${d.tenantName} workspace access`,
    html: layout(
      `
      <h2>You're invited to ${escapeHtml(d.tenantName)}</h2>
      <p>Hello ${escapeHtml(d.name.split(" ")[0] || d.name)},</p>
      <p>You have been granted workspace access as <strong>${escapeHtml(d.roleName)}</strong>. Use the button below to set your password and activate your account.</p>
      <p>This invitation expires in <strong>7 days</strong>.</p>
      ${ctaButton(d.activateUrl, "Activate access →")}
      <p class="muted" style="margin-top:24px;">Or open <span style="word-break:break-all;">${escapeHtml(d.activateUrl)}</span> and enter this one-time token:</p>
      <div class="link-box" style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px;">${escapeHtml(d.token)}</div>
    `,
      {
        eyebrow: "Workspace invitation",
        preheader: `Activate your ${d.tenantName} workspace access.`,
      },
    ),
  });
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function smtpConfigured(): boolean {
  return Boolean(
    process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS,
  );
}

function customerLayout(tenantName: string, body: string): string {
  const paragraphs = escapeHtml(body)
    .split(/\n+/)
    .filter(Boolean)
    .map((line) => `<p>${line}</p>`)
    .join("");
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
    .footer { padding:20px 32px; background:#f5f7f7; font-size:11px; color:#65777b; text-align:center; }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="header">
      <h1>${escapeHtml(tenantName)}</h1>
      <p>Booking communication</p>
    </div>
    <div class="body">${paragraphs}</div>
    <div class="footer">Sent on behalf of ${escapeHtml(tenantName)} via Zettaz Tours &amp; Charters.</div>
  </div>
</body>
</html>`;
}

/** Tenant booking / customer communications via platform SMTP_* settings. */
export async function sendCustomerMessage(d: {
  to: string;
  subject: string;
  /** Plain text, HTML document, or JSON snapshot `{ v:1, text, html }`. */
  body: string;
  tenantName: string;
}): Promise<{ messageId: string }> {
  if (!smtpConfigured()) {
    throw new Error(
      "SMTP is not configured (SMTP_HOST / SMTP_USER / SMTP_PASS).",
    );
  }
  const parsed = parseCommunicationBody(d.body);
  const text = parsed.text;
  const html = parsed.html ?? customerLayout(d.tenantName, text);
  const t = getTransporter();
  const info = await t.sendMail({
    from: FROM,
    to: d.to,
    subject: d.subject,
    text,
    html,
  });
  console.log(`[Email] Sent customer message "${d.subject}" → ${d.to}`);
  return { messageId: String(info.messageId ?? "") };
}
