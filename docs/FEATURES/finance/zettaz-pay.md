# Zettaz Pay (traveler card collections)

**Status:** Production slice, 1 October 2026 (migration `099_zettaz_pay.sql`). Replaces the 20 September onboarding/checkout slice.
**Brand:** Zettaz Pay (Stripe Connect underneath). Not Zettaz SaaS Billing.

## What tenants and guests can do

| Who | Where | What |
| --- | --- | --- |
| Owner / admin (`config.write`) | Settings → Payment integrations | Choose the **business country for Stripe**, then finish Stripe’s hosted onboarding. Status shows Ready, Action needed (Stripe wants more information, with deadline) or Finish onboarding. |
| Desk staff (`payment.write`) | Reservation → Zettaz Pay panel | **Take card now** (hosted Checkout on the desk screen), **Pay link** (copy/send), **QR to scan**. Amount defaults to the full balance; enter less for a deposit. Withdraw open links. |
| Desk staff | Customer communications → Payment request | The email now carries a **Pay securely** button when the tenant can take cards. Otherwise the old manual-instructions copy is sent. |
| Owner / finance (`payment.refund`) | Reservation → Zettaz Pay panel | Full or partial **refund to card**. The 1% platform fee is refunded proportionally. |
| Crew / desk tablet | Boarding payment sheet | **Card · show QR to guest** for the entered amount; the screen waits for the payment and closes itself. |
| Crew / desk tablet | Walk-in → Collection → **Card — guest scans QR** | Holds the seats, shows a QR, and confirms the walk-in when the payment arrives. |
| Guest | `https://tours.zettaz.com/pay/<token>` | Sees business, tour, date, total, already paid and the amount due; pays on Stripe Checkout (card, Apple Pay, Google Pay as enabled on the merchant account). |

Card payments are never posted from a browser redirect. Only a signed webhook posts money.

## Merchant country (non-supported islands)

The tenant is the merchant of record (direct charges). Stripe requires the tenant’s **legal entity and bank account** to be in a Stripe-supported country. Antigua & Barbuda, Sint Maarten and most Caribbean islands are not merchant countries. A tenant there can onboard with a **US company (for example an LLC with EIN and US bank account; non-US owners can form one through Stripe Atlas) or a UK Ltd with a UK bank account** by choosing United States / United Kingdom as the business country. Stripe decides final eligibility. The country cannot be changed after the account is created; a wrong choice needs a new connected account.

The tenant’s accountant should confirm tax and licensing for selling through a foreign entity. Zettaz does not give that advice.

## Money model

- Direct charges on the connected account, `application_fee_amount` = `ZETTAZ_PAY_APPLICATION_FEE_BPS` (default 100 = 1%). Stripe collects processing fees and losses from the tenant (`fees_collector`/`losses_collector` = `stripe`).
- Every Checkout Session we create is stored in `zettaz_pay_checkouts`. Creating a new one expires older open sessions for the booking, so a guest cannot pay twice from two tabs.
- Settlement inserts one settled `payments` row (`method = zettaz_pay`). Idempotent on the session.
- Refunds (app or tenant Dashboard) and **lost** disputes reverse the live Zettaz Pay row and re-post the remainder (append-only). Every existing paid/balance query works unchanged.
- A failed refund puts the amount back.
- Manual “Record reversal” and manual `zettaz_pay` entries are blocked; corrections go through refunds.
- Overpayment and late payment (after cancellation or hold expiry) are recorded, never dropped, and flagged in the audit log (`payment.zettaz_pay_overpaid`, `payment.zettaz_pay_late`). The booking shows *Credit for review*.
- Supported currencies: any Stripe two-decimal currency (USD, GBP, EUR, XCD, CAD …). Zero- and three-decimal currencies are blocked with a message.

## Tables (migration 099)

`zettaz_pay_accounts` (one per tenant; moved out of `tenants.config` because Settings saves replaced config wholesale), `zettaz_pay_requests` (pay links; token stored hashed, 30-day validity, balance re-checked on every open), `zettaz_pay_checkouts`, `zettaz_pay_refunds`, `zettaz_pay_disputes`. All tenant-scoped with RLS. Webhooks and the public pay page resolve the tenant through `SECURITY DEFINER` lookups only. New permission `payment.refund` (owner, finance).

## API

| Method | Route | Permission |
| --- | --- | --- |
| GET | `/admin/v1/zettaz-pay` | authenticated |
| POST | `/admin/v1/zettaz-pay/onboard` `{merchantCountry}` | `config.write` |
| POST | `/staff/v1/bookings/:id/zettaz-pay-checkout` `{amountMinor?}` | `payment.write` |
| GET | `/staff/v1/bookings/:id/zettaz-pay` | `bookings.read` |
| POST | `/staff/v1/bookings/:id/zettaz-pay/links` `{amountMinor?, channel}` | `payment.write` |
| POST | `/staff/v1/bookings/:id/zettaz-pay/links/:requestId/cancel` | `payment.write` |
| POST | `/staff/v1/bookings/:id/zettaz-pay/refunds` `{checkoutId, amountMinor, reason}` | `payment.refund` |
| POST | `/crew/v1/bookings/:id/zettaz-pay-link`, GET `/crew/v1/bookings/:id/pay-status` | crew check-in / payment / booking |
| GET / POST | `/pay/v1/:token`, `/pay/v1/:token/checkout` | public (token) |
| POST | `/webhooks/stripe-pay` | Stripe signature |

## Environment

| Variable | Value |
| --- | --- |
| `STRIPE_PAY_SECRET_KEY` | Zettaz Pay platform secret key. Never equal to `STRIPE_SECRET_KEY`. |
| `STRIPE_PAY_WEBHOOK_SECRET` | Signing secret of destination **zettaz-pay-tours** (snapshot, connected accounts). |
| `STRIPE_PAY_THIN_WEBHOOK_SECRET` | Signing secret of destination **zettaz-pay-tours-thin** (thin v2 account events). Each destination has its own secret. |
| `ZETTAZ_PAY_APPLICATION_FEE_BPS` | `100` |
| `WEB_ORIGIN` | `https://tours.zettaz.com` (pay links, onboarding return, Checkout return URLs) |

Laptop: use a Stripe **sandbox** for the Pay platform; `stripe listen` prints its own `whsec_` for `.env.development`. Never paste production secrets into the laptop file.

## Stripe event destinations (Zettaz Pay account)

1. **zettaz-pay-tours** — Connected accounts, snapshot, URL `https://tours.zettaz.com/webhooks/stripe-pay`. Events: `checkout.session.completed`, `checkout.session.expired`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `account.updated`, `refund.created`, `refund.updated`, `refund.failed`, `charge.dispute.created`, `charge.dispute.updated`, `charge.dispute.closed`, `charge.dispute.funds_withdrawn`, `charge.dispute.funds_reinstated`.
2. **zettaz-pay-tours-thin** — Your account, thin, same URL. `v2.core.account*` requirement and capability events.

nginx must forward `POST /webhooks/stripe-pay` to the API (raw body), not to Next.js. `/pay/*` goes to Next.js.

## Go-live check (per deploy)

1. `./deploy.sh` (applies migration 099). Set `STRIPE_PAY_THIN_WEBHOOK_SECRET`, restart `tours-api`.
2. Stripe Workbench → each destination → **Send test event** → 200.
3. Tenant: Settings → Payment integrations → choose country → finish onboarding → status Ready.
4. Small live charge with a pay link → payment appears on the booking within seconds → refund it from the panel → booking balance and Stripe agree.

## Not in this slice

- **Tap to Pay / NFC** (Stripe Terminal) in the crew app: needs a native build, per-tenant Terminal locations and an eligibility check (Tap to Pay generally requires the device in the merchant’s country).
- **Public online booking** (guest catalog, availability, hold and pay).
- Payout reporting and reconciliation exports beyond the booking ledger.
