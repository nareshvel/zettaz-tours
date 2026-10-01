import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import request from "supertest";
import { DateTime } from "luxon";
import Stripe from "stripe";
import { INestApplication } from "@nestjs/common";
import { localDatabase } from "../scripts/local-database";
import { bootstrapPlatform, issueSession } from "../scripts/sessions";
import { createApp } from "../src/app";
import { setStripePayClientForTests } from "../src/stripe-pay";
import { mockConfig, mockProduct } from "./fixtures";

/**
 * Zettaz Pay end to end against a real PostgreSQL and a fake Stripe client.
 * Covers onboarding, staff checkout, pay links, signed webhooks, refunds,
 * disputes and tenant isolation. No network calls leave the process.
 */

const SNAPSHOT_SECRET = "whsec_test_snapshot_destination";
const THIN_SECRET = "whsec_test_thin_destination";
const signer = new Stripe("sk_test_signer_only");

let local: Awaited<ReturnType<typeof localDatabase>>,
  admin: Pool,
  app: INestApplication,
  platform: string;
let a: { tenantId: string; ownerId: string; token: string }, b: typeof a;

// ── Fake Stripe ──────────────────────────────────────────────────────────────
const fake = {
  merchantActive: false,
  requirementsDue: false,
  accounts: 0,
  sessions: [] as Array<{ id: string; params: any; opts: any }>,
  expired: [] as string[],
  refunds: [] as Array<{ params: any; opts: any; id: string }>,
};
const fakeStripe = {
  accounts: { retrieveCurrent: async () => ({ charges_enabled: true }) },
  v2: {
    core: {
      accounts: {
        create: async () => ({ id: `acct_test${++fake.accounts}` }),
        retrieve: async (_id: string, params: { include?: string[] }) => {
          assert.ok(
            params?.include?.includes("configuration.merchant"),
            "merchant configuration must be requested explicitly",
          );
          return {
            configuration: {
              merchant: {
                capabilities: {
                  card_payments: {
                    status: fake.merchantActive ? "active" : "restricted",
                  },
                },
              },
            },
            requirements: {
              entries: fake.requirementsDue
                ? [{ awaiting_action_from: "user" }]
                : [],
              summary: fake.requirementsDue
                ? { minimum_deadline: { time: "2026-12-01T00:00:00.000Z" } }
                : {},
            },
          };
        },
      },
      accountLinks: {
        create: async () => ({
          url: "https://connect.stripe.com/setup/e/test",
        }),
      },
    },
  },
  checkout: {
    sessions: {
      create: async (params: any, opts: any) => {
        const id = `cs_test_${fake.sessions.length + 1}`;
        fake.sessions.push({ id, params, opts });
        return {
          id,
          url: `https://checkout.stripe.com/c/pay/${id}`,
          status: "open",
        };
      },
      expire: async (id: string) => {
        fake.expired.push(id);
        return { id, status: "expired" };
      },
      retrieve: async (id: string) => ({
        id,
        status: "open",
        url: `https://checkout.stripe.com/c/pay/${id}`,
      }),
    },
  },
  refunds: {
    create: async (params: any, opts: any) => {
      const id = `re_test_${fake.refunds.length + 1}`;
      fake.refunds.push({ params, opts, id });
      return {
        id,
        object: "refund",
        amount: params.amount,
        currency: "usd",
        status: "succeeded",
        payment_intent: params.payment_intent,
        metadata: params.metadata,
      };
    },
  },
} as unknown as Stripe;

// ── HTTP helpers ─────────────────────────────────────────────────────────────
const key = () => randomUUID();
function post(path: string, token: string, body: unknown, k = key()) {
  return request(app.getHttpServer())
    .post(path)
    .auth(token, { type: "bearer" })
    .set("Idempotency-Key", k)
    .send(body as object);
}
function get(path: string, token: string) {
  return request(app.getHttpServer()).get(path).auth(token, { type: "bearer" });
}
function webhook(event: object, secret = SNAPSHOT_SECRET) {
  const payload = JSON.stringify(event);
  const header = signer.webhooks.generateTestHeaderString({ payload, secret });
  return request(app.getHttpServer())
    .post("/webhooks/stripe-pay")
    .set("Content-Type", "application/json")
    .set("Stripe-Signature", header)
    .send(payload);
}
function sessionEvent(
  sessionId: string,
  account: string,
  amount: number,
  tenantId: string,
  intent: string,
  type = "checkout.session.completed",
) {
  return {
    id: `evt_${randomUUID().replace(/-/g, "")}`,
    object: "event",
    type,
    account,
    data: {
      object: {
        id: sessionId,
        object: "checkout.session",
        payment_status: "paid",
        amount_total: amount,
        currency: "usd",
        payment_intent: intent,
        metadata: { purpose: "zettaz_pay_booking", tenantId },
      },
    },
  };
}
async function setupTenant(slug: string) {
  const res = await post("/platform/v1/tenants", platform, {
    slug,
    name: `Mock ${slug}`,
    timezone: "America/Antigua",
    ownerName: "Mock Owner",
    ownerEmail: `${slug}@example.invalid`,
    ownerPhone: "+12685550100",
    country: "AG",
    config: mockConfig,
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return {
    tenantId: res.body.tenantId,
    ownerId: res.body.ownerId,
    token: await issueSession(admin, res.body.ownerId, res.body.tenantId),
  };
}
async function booking(token: string, party = { adult: 2 }) {
  const p = await post("/admin/v1/products", token, mockProduct);
  assert.equal(p.status, 201, JSON.stringify(p.body));
  const date = DateTime.utc().plus({ days: 10 }).toISODate();
  const s = await post("/admin/v1/schedules", token, {
    productId: p.body.productId,
    name: "Schedule",
    startDate: date,
    endDate: date,
    weekdays: [1, 2, 3, 4, 5, 6, 7],
    localTimes: ["09:00"],
    capacity: 10,
    blackoutDates: [],
  });
  assert.equal(s.status, 201, JSON.stringify(s.body));
  const h = await post("/staff/v1/holds", token, {
    departureId: s.body.departures[0].departureId,
    party,
  });
  assert.equal(h.status, 201, JSON.stringify(h.body));
  const bk = await post("/staff/v1/bookings", token, {
    holdId: h.body.holdId,
    leadName: "Mock Traveler",
    leadEmail: "traveler@example.invalid",
    source: "phone",
    pickup: { kind: "none" },
  });
  assert.equal(bk.status, 201, JSON.stringify(bk.body));
  const read = await get(`/staff/v1/bookings/${bk.body.bookingId}`, token);
  return {
    bookingId: bk.body.bookingId as string,
    totalMinor: read.body.quote.totalMinor as number,
  };
}
async function paid(bookingId: string, token = a.token) {
  return (await get(`/staff/v1/bookings/${bookingId}`, token)).body
    .paidMinor as number;
}

before(async () => {
  local = await localDatabase();
  admin = new Pool({ connectionString: local.adminUrl });
  process.env.APP_MODE = "test";
  process.env.SUBSCRIPTION_JOBS_DISABLED = "true";
  process.env.WEBHOOK_SECRET_ENCRYPTION_KEY =
    "test-webhook-secret-encryption-key";
  process.env.DATABASE_URL = local.runtimeUrl;
  process.env.STRIPE_PAY_WEBHOOK_SECRET = SNAPSHOT_SECRET;
  process.env.STRIPE_PAY_THIN_WEBHOOK_SECRET = THIN_SECRET;
  process.env.WEB_ORIGIN = "https://tours.example.test";
  process.env.ZETTAZ_PAY_APPLICATION_FEE_BPS = "100";
  setStripePayClientForTests(fakeStripe);
  app = await createApp();
  await app.listen(0, "127.0.0.1");
  platform = await bootstrapPlatform(admin);
  a = await setupTenant(`zp-a-${randomUUID().slice(0, 6)}`);
  b = await setupTenant(`zp-b-${randomUUID().slice(0, 6)}`);
});
after(async () => {
  setStripePayClientForTests(null);
  await app?.close();
  await admin?.end();
  await local?.stop();
});

test("onboarding needs a supported merchant country and survives Settings saves", async () => {
  const before = await get("/admin/v1/zettaz-pay", a.token);
  assert.equal(before.status, 200);
  assert.equal(before.body.accountId, null);
  assert.equal(before.body.readyForCheckout, false);
  assert.ok(
    before.body.merchantCountries.some(
      (c: { code: string }) => c.code === "US",
    ),
  );

  assert.equal(
    (await post("/admin/v1/zettaz-pay/onboard", a.token, {})).status,
    400,
  );
  // Antigua is where the tours run, not a Stripe merchant country.
  assert.equal(
    (
      await post("/admin/v1/zettaz-pay/onboard", a.token, {
        merchantCountry: "AG",
      })
    ).status,
    400,
  );
  const started = await post("/admin/v1/zettaz-pay/onboard", a.token, {
    merchantCountry: "us",
    returnUrl: "https://evil.example/steal",
  });
  assert.equal(started.status, 201, JSON.stringify(started.body));
  assert.match(started.body.url, /^https:\/\/connect\.stripe\.com\//);

  const status = await get("/admin/v1/zettaz-pay", a.token);
  assert.equal(status.body.accountId, "acct_test1");
  assert.equal(status.body.merchantCountry, "US");
  assert.equal(status.body.chargesEnabled, false);

  // Continuing setup reuses the account; no second Stripe account.
  await post("/admin/v1/zettaz-pay/onboard", a.token, {});
  assert.equal(fake.accounts, 1);

  // The account link lives outside tenants.config, so a Settings save keeps it.
  const {
    rows: [t],
  } = await admin.query("SELECT config FROM tenants WHERE id=$1", [a.tenantId]);
  assert.equal(t.config.zettazPay, undefined);

  fake.merchantActive = true;
  fake.requirementsDue = true;
  const ready = await get("/admin/v1/zettaz-pay", a.token);
  assert.equal(ready.body.readyForCheckout, true);
  assert.equal(ready.body.requirementsDue, true);
  fake.requirementsDue = false;

  // Tenant B has not onboarded and cannot see A's account.
  const other = await get("/admin/v1/zettaz-pay", b.token);
  assert.equal(other.body.accountId, null);
});

test("staff checkout, signed webhook settlement, pay links, refunds and disputes", async () => {
  const { bookingId, totalMinor } = await booking(a.token);
  assert.ok(totalMinor > 4000, `total ${totalMinor}`);
  const deposit = 2500;

  // Over the balance is rejected; a deposit is allowed.
  assert.equal(
    (
      await post(
        `/staff/v1/bookings/${bookingId}/zettaz-pay-checkout`,
        a.token,
        {
          amountMinor: totalMinor + 1,
        },
      )
    ).status,
    400,
  );
  const staff = await post(
    `/staff/v1/bookings/${bookingId}/zettaz-pay-checkout`,
    a.token,
    { amountMinor: deposit, successUrl: "https://evil.example/" },
  );
  assert.equal(staff.status, 201, JSON.stringify(staff.body));
  const first = fake.sessions.at(-1)!;
  assert.equal(first.opts.stripeAccount, "acct_test1");
  assert.equal(first.params.line_items[0].price_data.unit_amount, deposit);
  assert.equal(first.params.payment_intent_data.application_fee_amount, 25);
  assert.ok(first.params.success_url.startsWith("https://tours.example.test/"));

  // A browser redirect is not money. Bad signatures are refused.
  assert.equal(await paid(bookingId), 0);
  const forged = await request(app.getHttpServer())
    .post("/webhooks/stripe-pay")
    .set("Content-Type", "application/json")
    .set("Stripe-Signature", "t=1,v1=deadbeef")
    .send(
      JSON.stringify(
        sessionEvent(first.id, "acct_test1", deposit, a.tenantId, "pi_1"),
      ),
    );
  assert.equal(forged.status, 400);

  // Wrong connected account for this session is ignored.
  const wrong = await webhook(
    sessionEvent(first.id, "acct_other", deposit, a.tenantId, "pi_1"),
  );
  assert.equal(wrong.status, 200);
  assert.equal(await paid(bookingId), 0);

  const ok = await webhook(
    sessionEvent(first.id, "acct_test1", deposit, a.tenantId, "pi_1"),
  );
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(await paid(bookingId), deposit);
  // Stripe retries the same event: still recorded once.
  await webhook(
    sessionEvent(first.id, "acct_test1", deposit, a.tenantId, "pi_1"),
  );
  assert.equal(await paid(bookingId), deposit);

  // Manual reversal of a card payment is blocked; refunds go through Stripe.
  const read = await get(`/staff/v1/bookings/${bookingId}`, a.token);
  const cardPayment = read.body.payments.find(
    (p: { method: string }) => p.method === "zettaz_pay",
  );
  assert.equal(
    (
      await post(
        `/staff/v1/bookings/${bookingId}/payments/${cardPayment.id}/adjustments`,
        a.token,
        {
          kind: "reversal",
          reference: "manual",
          reason: "Trying to reverse a card payment by hand",
          occurredAt: new Date().toISOString(),
        },
      )
    ).status,
    400,
  );
  // Staff cannot fake a Zettaz Pay payment as a manual entry.
  assert.equal(
    (
      await post(`/staff/v1/bookings/${bookingId}/payments`, a.token, {
        amountMinor: 100,
        currency: "USD",
        method: "zettaz_pay",
        status: "settled",
        occurredAt: new Date().toISOString(),
      })
    ).status,
    400,
  );

  // Pay link for the rest of the balance.
  const link = await post(
    `/staff/v1/bookings/${bookingId}/zettaz-pay/links`,
    a.token,
    {
      channel: "qr",
    },
  );
  assert.equal(link.status, 201, JSON.stringify(link.body));
  assert.match(
    link.body.url,
    /^https:\/\/tours\.example\.test\/pay\/[A-Za-z0-9_-]{32}$/,
  );
  assert.match(link.body.qrDataUrl, /^data:image\/png;base64,/);
  const token = link.body.url.split("/pay/")[1];

  const publicView = await request(app.getHttpServer()).get(`/pay/v1/${token}`);
  assert.equal(publicView.status, 200, JSON.stringify(publicView.body));
  assert.equal(publicView.body.status, "open");
  assert.equal(publicView.body.amountDueMinor, totalMinor - deposit);
  assert.equal(publicView.body.guestFirstName, "Mock");
  assert.equal(
    JSON.stringify(publicView.body).includes("example.invalid"),
    false,
  );
  assert.equal(
    (await request(app.getHttpServer()).get(`/pay/v1/${"x".repeat(32)}`))
      .status,
    404,
  );

  const guest = await request(app.getHttpServer())
    .post(`/pay/v1/${token}/checkout`)
    .send({});
  assert.equal(guest.status, 200, JSON.stringify(guest.body));
  const second = fake.sessions.at(-1)!;
  assert.equal(
    second.params.line_items[0].price_data.unit_amount,
    totalMinor - deposit,
  );
  // Tapping again reuses the open session instead of creating another.
  const again = await request(app.getHttpServer())
    .post(`/pay/v1/${token}/checkout`)
    .send({});
  assert.equal(again.body.url, guest.body.url);

  await webhook(
    sessionEvent(
      second.id,
      "acct_test1",
      totalMinor - deposit,
      a.tenantId,
      "pi_2",
    ),
  );
  assert.equal(await paid(bookingId), totalMinor);
  const afterPay = await request(app.getHttpServer()).get(`/pay/v1/${token}`);
  assert.equal(afterPay.body.status, "paid");

  // Partial refund on the deposit.
  const summary = await get(
    `/staff/v1/bookings/${bookingId}/zettaz-pay`,
    a.token,
  );
  assert.equal(summary.status, 200);
  const depositCheckout = summary.body.payments.find(
    (p: { amountMinor: number }) => p.amountMinor === deposit,
  );
  assert.equal(
    (
      await post(
        `/staff/v1/bookings/${bookingId}/zettaz-pay/refunds`,
        a.token,
        {
          checkoutId: depositCheckout.checkoutId,
          amountMinor: deposit + 1,
          reason: "Too much",
        },
      )
    ).status,
    400,
  );
  const refunded = await post(
    `/staff/v1/bookings/${bookingId}/zettaz-pay/refunds`,
    a.token,
    {
      checkoutId: depositCheckout.checkoutId,
      amountMinor: 1000,
      reason: "Guest dropped one seat",
    },
  );
  assert.equal(refunded.status, 201, JSON.stringify(refunded.body));
  assert.equal(fake.refunds.at(-1)!.params.payment_intent, "pi_1");
  assert.equal(fake.refunds.at(-1)!.params.refund_application_fee, true);
  assert.equal(fake.refunds.at(-1)!.opts.stripeAccount, "acct_test1");
  assert.equal(await paid(bookingId), totalMinor - 1000);

  // The webhook for the same refund does not post it twice.
  const refundEvent = (status: string) => ({
    id: `evt_${randomUUID().replace(/-/g, "")}`,
    object: "event",
    type: status === "failed" ? "refund.failed" : "refund.updated",
    account: "acct_test1",
    data: {
      object: {
        id: refunded.body.refundId,
        object: "refund",
        amount: 1000,
        currency: "usd",
        status,
        payment_intent: "pi_1",
        metadata: {},
      },
    },
  });
  await webhook(refundEvent("succeeded"));
  assert.equal(await paid(bookingId), totalMinor - 1000);
  // A failed refund puts the money back on the booking.
  await webhook(refundEvent("failed"));
  assert.equal(await paid(bookingId), totalMinor);

  // Refund made in the tenant's own Stripe Dashboard is picked up.
  await webhook({
    id: `evt_${randomUUID().replace(/-/g, "")}`,
    object: "event",
    type: "refund.created",
    account: "acct_test1",
    data: {
      object: {
        id: "re_dashboard_1",
        object: "refund",
        amount: 500,
        currency: "usd",
        status: "succeeded",
        payment_intent: "pi_2",
        metadata: {},
      },
    },
  });
  assert.equal(await paid(bookingId), totalMinor - 500);

  // Lost chargeback removes the disputed amount.
  const dispute = (status: string) => ({
    id: `evt_${randomUUID().replace(/-/g, "")}`,
    object: "event",
    type:
      status === "needs_response"
        ? "charge.dispute.created"
        : "charge.dispute.closed",
    account: "acct_test1",
    data: {
      object: {
        id: "dp_test_1",
        object: "dispute",
        amount: deposit,
        currency: "usd",
        status,
        reason: "fraudulent",
        payment_intent: "pi_1",
        evidence_details: { due_by: Math.floor(Date.now() / 1000) + 86400 * 7 },
      },
    },
  });
  await webhook(dispute("needs_response"));
  assert.equal(await paid(bookingId), totalMinor - 500);
  const disputed = await get(
    `/staff/v1/bookings/${bookingId}/zettaz-pay`,
    a.token,
  );
  assert.equal(disputed.body.disputes[0].status, "needs_response");
  await webhook(dispute("lost"));
  assert.equal(await paid(bookingId), totalMinor - 500 - deposit);

  // Ledger stays append-only and consistent.
  const {
    rows: [ledger],
  } = await admin.query(
    `SELECT COUNT(*)::int AS rows,
            COUNT(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM payment_adjustments a
               WHERE a.tenant_id=p.tenant_id AND a.payment_id=p.id))::int AS live
       FROM payments p WHERE p.tenant_id=$1 AND p.booking_id=$2`,
    [a.tenantId, bookingId],
  );
  assert.ok(ledger.rows > ledger.live);

  // Tenant isolation.
  assert.equal(
    (await get(`/staff/v1/bookings/${bookingId}/zettaz-pay`, b.token)).status,
    404,
  );
});

test("thin account events need their own destination secret", async () => {
  fake.merchantActive = false;
  const event = {
    id: "evt_thin_1",
    object: "v2.core.event",
    type: "v2.core.account[configuration.merchant].capability_status_updated",
    related_object: { id: "acct_test1", type: "v2.core.account" },
  };
  assert.equal((await webhook(event, "whsec_unknown")).status, 400);
  const res = await webhook(event, THIN_SECRET);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const {
    rows: [row],
  } = await admin.query(
    "SELECT charges_enabled FROM zettaz_pay_accounts WHERE tenant_id=$1",
    [a.tenantId],
  );
  assert.equal(row.charges_enabled, false);
  fake.merchantActive = true;
  await webhook(event, THIN_SECRET);
});

test("payment request email carries a pay link and crew can show a QR", async () => {
  const { bookingId } = await booking(a.token, { adult: 1 });
  const msg = await post(
    `/staff/v1/bookings/${bookingId}/notifications`,
    a.token,
    {
      kind: "payment_request",
    },
  );
  assert.equal(msg.status, 201, JSON.stringify(msg.body));
  const {
    rows: [n],
  } = await admin.query(
    "SELECT body FROM notification_messages WHERE tenant_id=$1 AND booking_id=$2",
    [a.tenantId, bookingId],
  );
  assert.match(n.body, /https:\/\/tours\.example\.test\/pay\//);
  assert.match(n.body, /securely/);

  // Tenant B (not onboarded) still gets the manual-instructions email.
  const other = await booking(b.token, { adult: 1 });
  const plain = await post(
    `/staff/v1/bookings/${other.bookingId}/notifications`,
    b.token,
    {
      kind: "payment_request",
    },
  );
  assert.equal(plain.status, 201, JSON.stringify(plain.body));
  const {
    rows: [m],
  } = await admin.query(
    "SELECT body FROM notification_messages WHERE tenant_id=$1 AND booking_id=$2",
    [b.tenantId, other.bookingId],
  );
  assert.doesNotMatch(m.body, /\/pay\//);

  const status = await get(
    `/crew/v1/bookings/${bookingId}/pay-status`,
    a.token,
  );
  assert.equal(status.status, 200, JSON.stringify(status.body));
  assert.equal(status.body.cardPaidMinor, 0);
  const qr = await post(
    `/crew/v1/bookings/${bookingId}/zettaz-pay-link`,
    a.token,
    {},
  );
  assert.equal(qr.status, 201, JSON.stringify(qr.body));
  assert.match(qr.body.qrDataUrl, /^data:image\/png;base64,/);

  const withdrawn = await post(
    `/staff/v1/bookings/${bookingId}/zettaz-pay/links/${qr.body.requestId}/cancel`,
    a.token,
    {},
  );
  assert.equal(withdrawn.status, 201, JSON.stringify(withdrawn.body));
  const token = qr.body.url.split("/pay/")[1];
  const view = await request(app.getHttpServer()).get(`/pay/v1/${token}`);
  assert.equal(view.body.status, "unavailable");
  assert.equal(
    (
      await request(app.getHttpServer())
        .post(`/pay/v1/${token}/checkout`)
        .send({})
    ).status,
    400,
  );
});
