# Zettaz Pay (traveler collections)

**Status:** Onboarding + hosted Checkout + webhook slice 20 September 2026  
**Brand:** Zettaz Pay (Stripe Connect underneath). Not Zettaz SaaS Billing.

## What this slice does

- Tenant Settings → Payment integrations: start Stripe merchant onboarding.
- Reservation money panel: **Collect balance with Zettaz Pay** (USD remaining guest balance, 1% platform application fee).
- `POST /webhooks/stripe-pay` records a settled `zettaz_pay` payment only after a signed `checkout.session.completed` with `payment_status=paid`. Browser return is not payment truth.

SaaS subscriptions stay on `POST /webhooks/stripe` and `STRIPE_*`. Never reuse those keys or that destination for Pay.

## Do not mix these four things

| | Zettaz SaaS (subscriptions) | Zettaz Pay (guest cards) |
| --- | --- | --- |
| Stripe Dashboard | **Zettaz SaaS** | **Zettaz Pay** |
| Secret key env | `STRIPE_SECRET_KEY` | `STRIPE_PAY_SECRET_KEY` |
| Webhook env | `STRIPE_WEBHOOK_SECRET` | `STRIPE_PAY_WEBHOOK_SECRET` |
| Production URL | `https://tours.zettaz.com/webhooks/stripe` | `https://tours.zettaz.com/webhooks/stripe-pay` |

`stripe listen` is **not** a Dashboard destination. It prints its **own** `whsec_`. That value is only for the laptop while listen is running. It will never match the SaaS Dashboard secret, and it will never match the Pay Dashboard secret. If listen shows a secret you recognize from subscriptions, the CLI is still logged into **Zettaz SaaS** — run `stripe logout` then `stripe login` and pick **Zettaz Pay**.

**Laptop `.env.development`:** Pay webhook secret = the `whsec_` printed by `stripe listen` (Pay account).  
**VPS `.env.production`:** Pay webhook secret = the `whsec_` from the Pay Dashboard destination.  
Do not paste one secret into both files.

## Event destinations (create these on the **Zettaz Pay** Stripe account)

Workbench → **Webhooks** → **Add destination**. Destination type = **Webhook endpoint**.

Public URL (production VPS only): `https://tours.zettaz.com/webhooks/stripe-pay`  
Never point a Dashboard destination at `localhost`. Never reuse `/webhooks/stripe`.

On the VPS, nginx (or whatever fronts `tours-api`) must send `POST /webhooks/stripe-pay` to the **API** with the raw body, the same way `/webhooks/stripe` already does. Do not route those URLs through Next.js.

### Destination 1 — connected-account snapshot (guest Checkout)

1. **Events from:** Connected accounts  
2. **Payload:** Snapshot (not thin)  
3. **Events:** `checkout.session.completed`, `account.updated`  
4. Save. Copy the signing secret (`whsec_…`) into `STRIPE_PAY_WEBHOOK_SECRET`.

Direct charges live on the connected merchant, so Checkout completion is a **connected-account** event.

### Destination 2 — platform thin events (Accounts v2 onboarding)

1. **Events from:** Your account  
2. **Payload:** Thin  
3. **Events:** search `v2.core.account` and select requirement / capability updates (at least `v2.core.account[requirements].updated` and merchant capability status updates)  
4. Same endpoint URL. If Workbench issues a **second** signing secret, prefer one destination-secret per endpoint: Stripe often reuses the endpoint secret when the URL matches. If you get two secrets, keep Destination 1’s `whsec_` in `STRIPE_PAY_WEBHOOK_SECRET` (Checkout settlement) and ask engineering before adding a second verifier.

### Local laptop (no public URL yet)

Do **not** create a Cloud destination to `localhost`. In a terminal, logged into the **Zettaz Pay** account:

```sh
stripe listen --forward-to localhost:3190/webhooks/stripe-pay \
  --events checkout.session.completed,account.updated
```

Paste the CLI `whsec_` into `.env.development` as `STRIPE_PAY_WEBHOOK_SECRET` and restart `workspace:dev`.

For connected-account events locally, add:

```sh
stripe listen --forward-to localhost:3190/webhooks/stripe-pay \
  --forward-connect-to localhost:3190/webhooks/stripe-pay \
  --events checkout.session.completed,account.updated
```

## After destinations exist

1. Put `STRIPE_PAY_SECRET_KEY` and `STRIPE_PAY_WEBHOOK_SECRET` in `.env.development` and `.env.production` (Pay account only).  
2. Restart API.  
3. Activate the **Zettaz Pay** Stripe platform account in the Stripe Dashboard when you are ready (Settings → Payment integrations stays usable without that — it shows **Waiting on Stripe** and does not dump Dashboard URLs). Then **Set up Zettaz Pay** for the tenant and finish Stripe’s merchant form.  
4. Open a USD booking with a remaining guest balance → **Collect balance with Zettaz Pay**.  
5. Confirm a `zettaz_pay` row appears only after the webhook (not merely the success redirect).

Card-present / Terminal is still out of Track A.
