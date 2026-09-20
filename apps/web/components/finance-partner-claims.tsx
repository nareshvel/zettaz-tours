"use client";

import { useEffect, useMemo, useState } from "react";
import type { Session } from "@/lib/types";
import { dateTime, money, useMutation, useResource } from "@/lib/client";
import { ConfirmDialog, Field, FormDialog, Loading, Notice } from "./common";

type ClaimRow = {
  id: string;
  booking_id: string;
  partner_id: string;
  partner_name: string;
  amount_minor: string | number;
  currency: string;
  reference: string;
  notes: string;
  recorded_at: string;
  decision?: string | null;
  decision_reason?: string | null;
  decided_at?: string | null;
};

type ClaimableBooking = {
  id: string;
  lead_name: string;
  starts_at: string;
  total_minor: number;
  currency: string;
};

export function PartnerClaimsPanel({
  partnerId,
  partnerName,
  session,
  onChanged,
}: {
  partnerId: string;
  partnerName: string;
  session: Session;
  onChanged: () => void;
}) {
  const canRecord = session.permissions.includes("partner.collection.record");
  const canVerify = session.permissions.includes("partner.collection.verify");
  const [rev, setRev] = useState(0);
  const [recordOpen, setRecordOpen] = useState(false);
  const [decide, setDecide] = useState<{
    id: string;
    decision: "accepted" | "rejected";
  } | null>(null);
  const { data, error } = useResource<ClaimRow[]>(
    `finance/v1/partner-claims?_r=${rev}`,
  );
  const claims = useMemo(
    () => (data ?? []).filter((row) => row.partner_id === partnerId),
    [data, partnerId],
  );
  const pending = claims.filter((row) => !row.decision);
  const decided = claims.filter((row) => row.decision);
  const decideMut = useMutation();

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.location.hash === "#claims") {
      document.getElementById("partner-claims")?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    }
  }, [partnerId, data]);

  function refresh() {
    setRev((n) => n + 1);
    onChanged();
  }

  return (
    <section id="partner-claims" className="partner-claims-panel">
      <div className="finance-section-heading-row">
        <h3 className="finance-section-heading" style={{ marginTop: 18 }}>
          Collection claims
        </h3>
        {canRecord && (
          <button
            type="button"
            className="button small secondary"
            onClick={() => setRecordOpen(true)}
          >
            Record claim
          </button>
        )}
      </div>
      <p className="muted" style={{ margin: "0 0 10px", fontSize: 13 }}>
        Partner-collected money is not guest payment until finance accepts it.
      </p>
      {error && <Notice error>{error}</Notice>}
      {!data && !error && <Loading />}
      {data && pending.length === 0 && decided.length === 0 && (
        <p className="muted" style={{ fontSize: 13 }}>
          No collection claims for {partnerName}.
        </p>
      )}
      {pending.length > 0 && (
        <div className="partner-claim-list">
          {pending.map((row) => (
            <div key={row.id} className="partner-claim-row pending">
              <div>
                <strong>
                  {money(Number(row.amount_minor), row.currency)}
                </strong>
                <span>
                  {row.reference} · booking {row.booking_id.slice(0, 8)}
                </span>
              </div>
              {canVerify && (
                <div className="button-row">
                  <button
                    type="button"
                    className="button small"
                    onClick={() =>
                      setDecide({ id: row.id, decision: "accepted" })
                    }
                  >
                    Accept
                  </button>
                  <button
                    type="button"
                    className="button small secondary"
                    onClick={() =>
                      setDecide({ id: row.id, decision: "rejected" })
                    }
                  >
                    Reject
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {decided.length > 0 && (
        <details className="partner-claim-history">
          <summary>{decided.length} decided</summary>
          {decided.map((row) => (
            <p key={row.id}>
              {row.decision} · {money(Number(row.amount_minor), row.currency)} ·{" "}
              {row.reference}
              {row.decision_reason ? ` — ${row.decision_reason}` : ""}
            </p>
          ))}
        </details>
      )}
      <RecordClaimDialog
        open={recordOpen}
        partnerId={partnerId}
        session={session}
        onClose={() => setRecordOpen(false)}
        onSaved={() => {
          setRecordOpen(false);
          refresh();
        }}
      />
      <ConfirmDialog
        open={!!decide}
        title={decide?.decision === "accepted" ? "Accept claim" : "Reject claim"}
        description="This decision is append-only. Accepted claims may credit the guest balance and create a partner obligation."
        confirmLabel={decide?.decision === "accepted" ? "Accept" : "Reject"}
        danger={decide?.decision === "rejected"}
        reasonRequired
        reasonLabel="Reason"
        busy={decideMut.busy}
        error={decideMut.error}
        onConfirm={async (reason) => {
          if (!decide) return;
          await decideMut.run(
            `finance/v1/partner-claims/${decide.id}/decision`,
            { decision: decide.decision, reason },
          );
          if (!decideMut.error) {
            decideMut.clear();
            setDecide(null);
            refresh();
          }
        }}
        onClose={() => {
          decideMut.clear();
          setDecide(null);
        }}
      />
    </section>
  );
}

function RecordClaimDialog({
  open,
  partnerId,
  session,
  onClose,
  onSaved,
}: {
  open: boolean;
  partnerId: string;
  session: Session;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { data: bookings } = useResource<ClaimableBooking[]>(
            open ? `finance/v1/partners/${partnerId}/claimable-bookings` : null,
  );
  const mut = useMutation();
  const [bookingId, setBookingId] = useState("");
  const [amount, setAmount] = useState("");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const selected = bookings?.find((row) => row.id === bookingId);

  useEffect(() => {
    if (!open) {
      setBookingId("");
      setAmount("");
      setReference("");
      setNotes("");
      mut.clear();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <FormDialog
      open={open}
      title="Record collection claim"
      busy={mut.busy}
      error={mut.error}
      onClose={onClose}
      onSubmit={async () => {
        if (!selected) return;
        const amountMinor = Math.round(Number(amount) * 100);
        if (!Number.isFinite(amountMinor) || amountMinor < 1) return;
        await mut.run("finance/v1/partner-claims", {
          bookingId: selected.id,
          partnerId,
          amountMinor,
          currency: selected.currency,
          reference,
          notes,
        });
        if (!mut.error) onSaved();
      }}
      submitLabel="Record"
    >
      <Field label="Booking" required>
        <select
          value={bookingId}
          onChange={(e) => setBookingId(e.target.value)}
          required
        >
          <option value="">Select a partner-collects booking</option>
          {(bookings ?? []).map((row) => (
            <option key={row.id} value={row.id}>
              {row.lead_name} ·{" "}
              {dateTime(row.starts_at, session.tenant.timezone)} ·{" "}
              {money(row.total_minor, row.currency)}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Amount collected" required>
        <input
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          required
        />
      </Field>
      <Field label="Reference" required>
        <input
          value={reference}
          onChange={(e) => setReference(e.target.value)}
          required
          maxLength={120}
        />
      </Field>
      <Field label="Notes">
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          maxLength={2000}
        />
      </Field>
    </FormDialog>
  );
}
