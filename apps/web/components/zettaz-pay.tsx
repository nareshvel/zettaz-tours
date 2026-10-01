"use client";
import { useEffect, useState } from "react";
import { Copy, CreditCard, Link2, QrCode, RotateCcw } from "lucide-react";
import type { Session } from "@/lib/types";
import {
  dateTime,
  label,
  major,
  minor,
  money,
  useMutation,
  useResource,
} from "@/lib/client";
import { Field, Notice } from "./common";

type Summary = {
  ready: boolean;
  currency: string;
  currencySupported: boolean;
  balanceMinor: number;
  collectible: boolean;
  blockedReason: string | null;
  payments: {
    checkoutId: string;
    amountMinor: number;
    refundedMinor: number;
    refundableMinor: number;
    currency: string;
    paidAt: string;
    disputed: boolean;
    origin: "staff" | "pay_link";
  }[];
  refunds: {
    id: string;
    checkout_id: string;
    amount_minor: number;
    currency: string;
    status: string;
    origin: string;
    reason: string;
    created_at: string;
  }[];
  disputes: {
    id: string;
    amount_minor: number;
    currency: string;
    status: string;
    reason: string;
    evidence_due_by: string | null;
  }[];
  links: {
    id: string;
    amount_minor: number | null;
    currency: string;
    channel: string;
    status: string;
    expires_at: string;
    created_at: string;
  }[];
};

type CreatedLink = {
  requestId: string;
  url: string;
  qrDataUrl: string;
  expiresAt: string;
  amountMinor: number;
  currency: string;
};

/**
 * Card collection for one booking: staff checkout, shareable pay link / QR,
 * card payment history and refunds. Money is only posted by Stripe webhooks.
 */
export function ZettazPayBookingPanel({
  bookingId,
  session,
  onChanged,
}: {
  bookingId: string;
  session: Session;
  onChanged: () => void;
}) {
  const summary = useResource<Summary>(
    `staff/v1/bookings/${bookingId}/zettaz-pay`,
  );
  const checkout = useMutation(),
    createLink = useMutation(),
    cancelLink = useMutation(),
    refund = useMutation();
  const [amount, setAmount] = useState(""),
    [amountError, setAmountError] = useState(""),
    [link, setLink] = useState<CreatedLink | null>(null),
    [copied, setCopied] = useState(false),
    [refunding, setRefunding] = useState(""),
    [refundAmount, setRefundAmount] = useState(""),
    [refundReason, setRefundReason] = useState(""),
    [refundError, setRefundError] = useState(""),
    [done, setDone] = useState("");

  const [returned, setReturned] = useState<"" | "ok" | "cancel">("");
  // After Stripe redirects back, the webhook usually lands within seconds.
  // Refresh a few times so staff see the payment without reloading.
  useEffect(() => {
    const flag = new URLSearchParams(window.location.search).get("pay");
    if (flag !== "ok" && flag !== "cancel") return;
    setReturned(flag);
    const url = new URL(window.location.href);
    url.searchParams.delete("pay");
    window.history.replaceState(null, "", url.toString());
    if (flag !== "ok") return;
    let n = 0;
    const timer = window.setInterval(() => {
      n += 1;
      summary.reload();
      onChanged();
      if (n >= 6) window.clearInterval(timer);
    }, 4000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const s = summary.data;
  if (!s) return summary.error ? <Notice error>{summary.error}</Notice> : null;
  const canCollect = session.permissions.includes("payment.write");
  const canRefund = session.permissions.includes("payment.refund");
  if (!s.ready && s.payments.length === 0) return null;

  function requested(): number | undefined | null {
    setAmountError("");
    if (!amount.trim()) return undefined;
    try {
      const value = minor(amount.trim(), s!.currency);
      if (value <= 0) throw new Error("Enter an amount greater than zero.");
      if (value > s!.balanceMinor)
        throw new Error("The amount is more than the balance due.");
      return value;
    } catch (e) {
      setAmountError((e as Error).message);
      return null;
    }
  }

  async function openCheckout() {
    const value = requested();
    if (value === null) return;
    const here = `${window.location.origin}/reservations/${bookingId}`;
    const result = await checkout.run<{ url: string }>(
      `staff/v1/bookings/${bookingId}/zettaz-pay-checkout`,
      {
        ...(value ? { amountMinor: value } : {}),
        successUrl: `${here}?pay=ok`,
        cancelUrl: `${here}?pay=cancel`,
      },
    );
    if (result?.url) window.location.assign(result.url);
  }

  async function makeLink(channel: "link" | "qr") {
    const value = requested();
    if (value === null) return;
    setCopied(false);
    const result = await createLink.run<CreatedLink>(
      `staff/v1/bookings/${bookingId}/zettaz-pay/links`,
      { channel, ...(value ? { amountMinor: value } : {}) },
    );
    if (result) {
      setLink(result);
      summary.reload();
    }
  }

  async function withdraw(requestId: string) {
    const result = await cancelLink.run(
      `staff/v1/bookings/${bookingId}/zettaz-pay/links/${requestId}/cancel`,
      {},
    );
    if (result) {
      if (link?.requestId === requestId) setLink(null);
      summary.reload();
    }
  }

  async function submitRefund(checkoutId: string, refundable: number) {
    setRefundError("");
    let value: number;
    try {
      value = minor(refundAmount.trim(), s!.currency);
    } catch (e) {
      setRefundError((e as Error).message);
      return;
    }
    if (value <= 0 || value > refundable) {
      setRefundError(
        `Refund between ${money(1, s!.currency)} and ${money(refundable, s!.currency)}.`,
      );
      return;
    }
    if (refundReason.trim().length < 3) {
      setRefundError("Add a short reason for the refund.");
      return;
    }
    const result = await refund.run<{ status: string }>(
      `staff/v1/bookings/${bookingId}/zettaz-pay/refunds`,
      { checkoutId, amountMinor: value, reason: refundReason.trim() },
    );
    if (result) {
      setRefunding("");
      setRefundAmount("");
      setRefundReason("");
      setDone(
        result.status === "succeeded"
          ? "Refund sent to the guest's card."
          : "Refund started. Stripe will finish it shortly.",
      );
      summary.reload();
      onChanged();
    }
  }

  const openLinks = s.links.filter((l) => l.status === "open");

  return (
    <section className="booking-detail-section zettaz-pay-panel">
      <h2>
        <CreditCard size={18} /> Zettaz Pay
      </h2>
      {done ? <Notice>{done}</Notice> : null}
      {returned === "ok" ? (
        <Notice>
          Card payment submitted. It appears here once Stripe confirms it,
          usually within a few seconds.
        </Notice>
      ) : returned === "cancel" ? (
        <Notice>Card checkout was cancelled. Nothing was charged.</Notice>
      ) : null}

      {canCollect && s.ready ? (
        s.collectible ? (
          <div className="zettaz-pay-collect">
            <Field
              label={`Amount (${s.currency})`}
              hint={`Leave empty to charge the full balance of ${money(s.balanceMinor, s.currency)}. Enter less for a deposit.`}
              error={amountError}
            >
              <input
                inputMode="decimal"
                placeholder={major(s.balanceMinor, s.currency)}
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
              />
            </Field>
            <div className="button-row">
              <button
                type="button"
                className="button"
                disabled={checkout.busy}
                onClick={() => void openCheckout()}
              >
                <CreditCard size={16} />
                {checkout.busy ? "Opening checkout…" : "Take card now"}
              </button>
              <button
                type="button"
                className="button secondary"
                disabled={createLink.busy}
                onClick={() => void makeLink("link")}
              >
                <Link2 size={16} />
                {createLink.busy ? "Creating…" : "Pay link"}
              </button>
              <button
                type="button"
                className="button secondary"
                disabled={createLink.busy}
                onClick={() => void makeLink("qr")}
              >
                <QrCode size={16} /> QR to scan
              </button>
            </div>
            <p className="muted">
              To email the link, send a <strong>Payment request</strong> from
              Customer communications — it includes a pay button automatically.
            </p>
            {checkout.error ? <Notice error>{checkout.error}</Notice> : null}
            {createLink.error ? (
              <Notice error>{createLink.error}</Notice>
            ) : null}
          </div>
        ) : s.blockedReason && s.balanceMinor > 0 ? (
          <p className="muted">{s.blockedReason}</p>
        ) : null
      ) : null}

      {link ? (
        <div className="zettaz-pay-link">
          <img
            src={link.qrDataUrl}
            width={200}
            height={200}
            alt="QR code for the guest to pay by card"
          />
          <div>
            <strong>
              {money(link.amountMinor, link.currency)} · guest pay link
            </strong>
            <code>{link.url}</code>
            <div className="button-row">
              <button
                type="button"
                className="button secondary"
                onClick={() => {
                  void navigator.clipboard
                    ?.writeText(link.url)
                    .then(() => setCopied(true));
                }}
              >
                <Copy size={15} /> {copied ? "Copied" : "Copy link"}
              </button>
              <button
                type="button"
                className="text-button"
                onClick={() => {
                  setLink(null);
                  onChanged();
                  summary.reload();
                }}
              >
                Done
              </button>
            </div>
            <small className="muted">
              Valid until {dateTime(link.expiresAt, session.tenant.timezone)}.
              The booking updates as soon as Stripe confirms the payment.
            </small>
          </div>
        </div>
      ) : null}

      {openLinks.length > 0 ? (
        <div className="stack-list compact">
          {openLinks.map((l) => (
            <div className="detail-row" key={l.id}>
              <span>
                <strong>
                  Open {label(l.channel)} link ·{" "}
                  {l.amount_minor
                    ? money(l.amount_minor, l.currency)
                    : "current balance"}
                </strong>
                <small>
                  Sent {dateTime(l.created_at, session.tenant.timezone)} ·
                  expires {dateTime(l.expires_at, session.tenant.timezone)}
                </small>
              </span>
              {canCollect ? (
                <button
                  type="button"
                  className="text-button"
                  disabled={cancelLink.busy}
                  onClick={() => void withdraw(l.id)}
                >
                  Withdraw
                </button>
              ) : null}
            </div>
          ))}
          {cancelLink.error ? <Notice error>{cancelLink.error}</Notice> : null}
        </div>
      ) : null}

      {s.disputes
        .filter((d) => !["won", "warning_closed"].includes(d.status))
        .map((d) => (
          <Notice error key={d.id}>
            Card dispute {label(d.status)} · {money(d.amount_minor, d.currency)}
            {d.reason ? ` · ${label(d.reason)}` : ""}
            {d.evidence_due_by
              ? ` · respond in your Stripe Dashboard by ${dateTime(d.evidence_due_by, session.tenant.timezone)}`
              : ""}
          </Notice>
        ))}

      {s.payments.length > 0 ? (
        <div className="stack-list compact">
          {s.payments.map((p) => (
            <div key={p.checkoutId}>
              <div className="detail-row">
                <span>
                  <strong>
                    {money(p.amountMinor, p.currency)} card payment
                    {p.refundedMinor > 0
                      ? ` · ${money(p.refundedMinor, p.currency)} refunded`
                      : ""}
                  </strong>
                  <small>
                    {dateTime(p.paidAt, session.tenant.timezone)} ·{" "}
                    {p.origin === "pay_link"
                      ? "Guest pay link"
                      : "Staff checkout"}
                    {p.disputed ? " · disputed" : ""}
                  </small>
                </span>
                {canRefund && p.refundableMinor > 0 && !p.disputed ? (
                  <button
                    type="button"
                    className="button secondary"
                    onClick={() => {
                      setRefunding(p.checkoutId);
                      setRefundAmount(major(p.refundableMinor, p.currency));
                      setRefundReason("");
                      setRefundError("");
                    }}
                  >
                    <RotateCcw size={15} /> Refund
                  </button>
                ) : null}
              </div>
              {refunding === p.checkoutId ? (
                <div className="form-grid">
                  <Field
                    label={`Refund amount (${p.currency})`}
                    hint={`Up to ${money(p.refundableMinor, p.currency)}.`}
                  >
                    <input
                      inputMode="decimal"
                      value={refundAmount}
                      onChange={(event) => setRefundAmount(event.target.value)}
                    />
                  </Field>
                  <Field label="Reason">
                    <input
                      maxLength={500}
                      value={refundReason}
                      onChange={(event) => setRefundReason(event.target.value)}
                    />
                  </Field>
                  <div className="button-row">
                    <button
                      type="button"
                      className="button"
                      disabled={refund.busy}
                      onClick={() =>
                        void submitRefund(p.checkoutId, p.refundableMinor)
                      }
                    >
                      {refund.busy ? "Refunding…" : "Refund to card"}
                    </button>
                    <button
                      type="button"
                      className="text-button"
                      onClick={() => setRefunding("")}
                    >
                      Cancel
                    </button>
                  </div>
                  {refundError ? <Notice error>{refundError}</Notice> : null}
                  {refund.error ? <Notice error>{refund.error}</Notice> : null}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      {s.refunds.length > 0 ? (
        <div className="stack-list compact">
          {s.refunds.map((r) => (
            <div className="detail-row" key={r.id}>
              <span>
                <strong>
                  Refund {money(r.amount_minor, r.currency)} · {label(r.status)}
                </strong>
                <small>
                  {dateTime(r.created_at, session.tenant.timezone)} ·{" "}
                  {r.origin === "app"
                    ? r.reason
                    : "Refunded in Stripe Dashboard"}
                </small>
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}
