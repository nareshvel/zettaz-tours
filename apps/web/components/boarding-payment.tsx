"use client";

import { useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import type { Manifest, Session } from "@/lib/types";
import {
  digits,
  label,
  minor,
  money,
  useMutation,
} from "@/lib/client";
import { Field, Notice } from "./common";

function paymentMethodLabel(method: string) {
  if (method === "reseller_payment") return "Guest payment via reseller";
  return label(method);
}

/** Equal share of remaining balance; last share absorbs rounding remainder. */
export function suggestedBoardingShare(
  balanceMinor: number,
  rosterCount: number,
) {
  if (balanceMinor <= 0) return 0;
  if (rosterCount <= 1) return balanceMinor;
  const share = Math.floor(balanceMinor / rosterCount);
  const lastShare = balanceMinor - share * (rosterCount - 1);
  return balanceMinor <= lastShare ? balanceMinor : share;
}

function attributionPassenger(
  booking: Manifest["bookings"][number],
  passenger?: Manifest["bookings"][number]["passengers"][number],
) {
  if (!passenger) return undefined;
  if (!passenger.is_minor) return passenger;
  const adult = booking.passengers.find((item) => !item.is_minor);
  return adult ?? passenger;
}

export function BoardingPaymentModal({
  session,
  booking,
  passenger,
  onClose,
  onPaid,
}: {
  session: Session;
  booking: Manifest["bookings"][number];
  passenger?: Manifest["bookings"][number]["passengers"][number];
  onClose: () => void;
  onPaid: () => void;
}) {
  const pay = useMutation();
  const currency = booking.currency ?? session.tenant.config.bookingCurrency;
  const balanceMinor = booking.guest_balance_minor ?? 0;
  const rosterCount = Math.max(
    1,
    booking.passengers.length || booking.party_size || 1,
  );
  const attributed = useMemo(
    () => attributionPassenger(booking, passenger),
    [booking, passenger],
  );
  const splitMode = Boolean(passenger) && rosterCount >= 2;
  const suggested = splitMode
    ? suggestedBoardingShare(balanceMinor, rosterCount)
    : balanceMinor;
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [inputError, setInputError] = useState("");
  const [occurredAt] = useState(() => new Date().toISOString());

  useEffect(() => {
    setAmount(
      (suggested / 10 ** digits(currency)).toFixed(digits(currency)),
    );
  }, [suggested, currency]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setInputError("");
    if (!session.permissions.includes("payment.write")) {
      setInputError("Payment permission is required to collect here.");
      return;
    }
    if (!method) {
      setInputError("Select a payment method.");
      return;
    }
    let amountMinor = 0;
    try {
      amountMinor = minor(amount, currency);
    } catch {
      setInputError("Enter a valid amount.");
      return;
    }
    if (amountMinor <= 0) {
      setInputError("Enter a payment amount greater than zero.");
      return;
    }
    const result = await pay.run(
      `staff/v1/bookings/${booking.booking_id}/payments`,
      {
        amountMinor,
        currency,
        method,
        status: "settled",
        reference: reference.trim(),
        reason:
          note.trim() ||
          (attributed
            ? `Collected at boarding · ${attributed.name}`
            : "Collected at boarding"),
        occurredAt,
        ...(attributed ? { passengerId: attributed.id } : {}),
      },
    );
    if (result) onPaid();
  }

  return (
    <div className="boarding-waiver-scrim open" role="presentation">
      <div
        className="panel boarding-waiver-sheet"
        role="dialog"
        aria-modal="true"
        aria-label="Collect balance"
      >
        <header className="boarding-waiver-head">
          <div>
            <p className="eyebrow">PAYMENT AT BOARDING</p>
            <h2>{passenger?.name || booking.lead_name}</h2>
            <p className="muted">
              {booking.booking_id.slice(0, 8).toUpperCase()} · Balance due{" "}
              {money(balanceMinor, currency, session.tenant.config.locale)}
            </p>
            {splitMode ? (
              <p className="muted">
                Suggested share ·{" "}
                {money(suggested, currency, session.tenant.config.locale)} (of{" "}
                {rosterCount} travellers)
                {attributed && attributed.id !== passenger?.id
                  ? ` · attributed to ${attributed.name}`
                  : null}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            className="icon-button boarding-summary-close"
            aria-label="Close"
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </header>
        <form className="boarding-waiver-body" onSubmit={(e) => void submit(e)}>
          <div className="balance-lines">
            <div>
              <span>Booking total</span>
              <strong>
                {money(
                  booking.total_minor ?? 0,
                  currency,
                  session.tenant.config.locale,
                )}
              </strong>
            </div>
            <div>
              <span>Already paid</span>
              <strong>
                {money(
                  booking.paid_minor ?? 0,
                  currency,
                  session.tenant.config.locale,
                )}
              </strong>
            </div>
            <div>
              <span>Balance due</span>
              <strong>
                {money(balanceMinor, currency, session.tenant.config.locale)}
              </strong>
            </div>
          </div>
          <div className="form-grid">
            <Field label={"Amount received · " + currency}>
              <input
                className="amount-input"
                inputMode="decimal"
                required
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </Field>
            <Field label="Payment method">
              <select
                required
                value={method}
                onChange={(e) => setMethod(e.target.value)}
              >
                <option value="">Select</option>
                {session.tenant.config.manualPaymentMethods
                  .filter((item) => item !== "reseller_payment")
                  .map((item) => (
                    <option key={item} value={item}>
                      {paymentMethodLabel(item)}
                    </option>
                  ))}
              </select>
            </Field>
            <Field label="Receipt / bank reference">
              <input
                maxLength={120}
                value={reference}
                onChange={(e) => setReference(e.target.value)}
              />
            </Field>
            <Field label="Collection note">
              <input
                maxLength={500}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Collected at boarding"
              />
            </Field>
          </div>
          {(inputError || pay.error) && (
            <Notice error>{inputError || pay.error}</Notice>
          )}
          <div className="form-actions">
            <button
              type="submit"
              className="button full"
              disabled={pay.busy || balanceMinor <= 0}
            >
              {pay.busy ? "Recording…" : "Record payment"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
