"use client";

import { useMemo, useState } from "react";
import { Check, Landmark, X } from "lucide-react";
import type { PartnerClaim, Session } from "@/lib/types";
import { dateTime, money, useMutation, useResource } from "@/lib/client";
import {
  ConfirmDialog,
  Empty,
  Field,
  Heading,
  Loading,
  Notice,
  Status,
} from "./common";

function amount(value: string | number) {
  return typeof value === "number" ? value : Number(value);
}

type StatementLine = {
  id: string;
  booking_id: string;
  partner_id: string;
  partner_name: string;
  amount_minor: string;
  currency: string;
  kind: string;
  created_at: string;
};

export function Finance({ session }: { session: Session }) {
  const claims = useResource<PartnerClaim[]>("finance/v1/partner-claims");
  const statements = useResource<StatementLine[]>(
    "finance/v1/partner-statements",
  );
  const [reason, setReason] = useState<Record<string, string>>({});
  const [stateFilter, setStateFilter] = useState<
    "all" | "unverified" | "accepted" | "rejected"
  >("unverified");
  const [partnerFilter, setPartnerFilter] = useState("all");
  const [pending, setPending] = useState<{
    claim: PartnerClaim;
    decision: "accepted" | "rejected";
  } | null>(null);
  const decision = useMutation();

  const partners = useMemo(() => {
    if (!claims.data) return [];
    return [...new Map(claims.data.map((c) => [c.partner_id, c.partner_name]))];
  }, [claims.data]);

  const filteredClaims = useMemo(() => {
    if (!claims.data) return [];
    return claims.data.filter(
      (claim) =>
        (stateFilter === "all" ||
          (claim.decision ?? "unverified") === stateFilter) &&
        (partnerFilter === "all" || claim.partner_id === partnerFilter),
    );
  }, [claims.data, partnerFilter, stateFilter]);

  const unverifiedCount =
    claims.data?.filter((claim) => !claim.decision).length ?? 0;
  const acceptedCount =
    claims.data?.filter((claim) => claim.decision === "accepted").length ?? 0;
  const statementCount =
    statements.data?.filter(
      (line) => partnerFilter === "all" || line.partner_id === partnerFilter,
    ).length ?? 0;

  async function confirmDecision() {
    if (!pending) return;
    const result = await decision.run(
      `finance/v1/partner-claims/${pending.claim.id}/decision`,
      {
        decision: pending.decision,
        reason: reason[pending.claim.id] ?? "",
      },
    );
    if (result) {
      setPending(null);
      claims.reload();
      statements.reload();
    }
  }

  return (
    <>
      <Heading
        eyebrow="FINANCE"
        title="Partner collections"
        description="Review hotel and reseller collection evidence. Accepted claims create a partner obligation — they never create a guest payment."
      />

      {claims.error && <Notice error>{claims.error}</Notice>}
      {!claims.data && !claims.error && <Loading />}

      {claims.data && (
        <>
          <div className="finance-metrics">
            <div className={unverifiedCount ? "attention" : ""}>
              <strong>{unverifiedCount}</strong>
              <span>Unverified claims</span>
            </div>
            <div>
              <strong>{acceptedCount}</strong>
              <span>Accepted claims</span>
            </div>
            <div>
              <strong>{statementCount}</strong>
              <span>Statement lines</span>
            </div>
          </div>

          <section className="panel finance-filters">
            <div className="form-grid compact">
              <Field label="Review state">
                <select
                  value={stateFilter}
                  onChange={(event) =>
                    setStateFilter(
                      event.target.value as typeof stateFilter,
                    )
                  }
                >
                  <option value="unverified">Unverified</option>
                  <option value="accepted">Accepted</option>
                  <option value="rejected">Rejected</option>
                  <option value="all">All claims</option>
                </select>
              </Field>
              <Field label="Partner">
                <select
                  value={partnerFilter}
                  onChange={(event) => setPartnerFilter(event.target.value)}
                >
                  <option value="all">All partners</option>
                  {partners.map(([id, name]) => (
                    <option key={id} value={id}>
                      {name}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <Notice>
              Keep guest receipts on the reservation. Partner collections are
              verified here and stay separate by currency.
            </Notice>
          </section>

          {!filteredClaims.length ? (
            <Empty title="No partner collection claims">
              <p>
                Claims recorded against confirmed partner-collection bookings
                appear here.
              </p>
            </Empty>
          ) : (
            <div className="stack-list finance-claim-list">
              {filteredClaims.map((claim) => (
                <article className="panel finance-claim" key={claim.id}>
                  <div className="panel-heading plain">
                    <div>
                      <p className="eyebrow">{claim.partner_name}</p>
                      <h2>
                        {money(amount(claim.amount_minor), claim.currency)}
                      </h2>
                      <p>
                        {claim.reference} · recorded{" "}
                        {dateTime(claim.recorded_at, session.tenant.timezone)}
                      </p>
                      <p className="mono muted">
                        Booking {claim.booking_id.slice(0, 8).toUpperCase()} ·{" "}
                        {claim.currency}
                      </p>
                    </div>
                    <Status state={claim.decision ?? "unverified"} />
                  </div>
                  <p className="muted">
                    {claim.notes || "No collection note supplied."}
                  </p>
                  {claim.decision ? (
                    <p className="decision-note">
                      <Landmark size={16} /> {claim.decision_reason}
                    </p>
                  ) : (
                    <div className="finance-decision">
                      <Field
                        label="Finance decision reason"
                        required
                        hint="Required before accept or reject. Stored on the claim audit trail."
                      >
                        <input
                          required
                          maxLength={500}
                          value={reason[claim.id] ?? ""}
                          onChange={(event) =>
                            setReason({
                              ...reason,
                              [claim.id]: event.target.value,
                            })
                          }
                          placeholder="Explain the approval or rejection"
                        />
                      </Field>
                      {decision.error && pending?.claim.id === claim.id && (
                        <Notice error>{decision.error}</Notice>
                      )}
                      <div className="button-row finance-decision-actions">
                        <button
                          type="button"
                          className="button"
                          disabled={
                            !reason[claim.id]?.trim() || decision.busy
                          }
                          onClick={() =>
                            setPending({ claim, decision: "accepted" })
                          }
                        >
                          <Check size={16} /> Accept claim
                        </button>
                        <button
                          type="button"
                          className="button destructive"
                          disabled={
                            !reason[claim.id]?.trim() || decision.busy
                          }
                          onClick={() =>
                            setPending({ claim, decision: "rejected" })
                          }
                        >
                          <X size={16} /> Reject claim
                        </button>
                      </div>
                    </div>
                  )}
                </article>
              ))}
            </div>
          )}
        </>
      )}

      {statements.error && <Notice error>{statements.error}</Notice>}
      {statements.data && statementCount > 0 && (
        <section className="panel finance-statements">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">PARTNER OBLIGATIONS</p>
              <h2>Statement lines</h2>
              <p className="muted">
                Accepted claims and invoice obligations by partner currency.
              </p>
            </div>
          </div>
          <div className="table-scroll finance-statements-table">
            <table>
              <thead>
                <tr>
                  <th>Partner</th>
                  <th>Kind</th>
                  <th>Amount</th>
                  <th>Booking</th>
                  <th>Recorded</th>
                </tr>
              </thead>
              <tbody>
                {statements.data
                  .filter(
                    (line) =>
                      partnerFilter === "all" ||
                      line.partner_id === partnerFilter,
                  )
                  .map((line) => (
                    <tr key={line.id}>
                      <td>{line.partner_name}</td>
                      <td>{line.kind.replaceAll("_", " ")}</td>
                      <td>
                        {money(Number(line.amount_minor), line.currency)}
                        <small className="currency-tag">
                          {" "}
                          {line.currency}
                        </small>
                      </td>
                      <td className="mono">
                        {line.booking_id.slice(0, 8).toUpperCase()}
                      </td>
                      <td>
                        {dateTime(line.created_at, session.tenant.timezone)}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          <div className="finance-statement-cards">
            {statements.data
              .filter(
                (line) =>
                  partnerFilter === "all" || line.partner_id === partnerFilter,
              )
              .map((line) => (
                <article key={line.id} className="finance-statement-card">
                  <div>
                    <strong>{line.partner_name}</strong>
                    <small>{line.kind.replaceAll("_", " ")}</small>
                  </div>
                  <div className="finance-statement-amount">
                    <strong>
                      {money(Number(line.amount_minor), line.currency)}
                    </strong>
                    <small>
                      {line.currency} ·{" "}
                      {line.booking_id.slice(0, 8).toUpperCase()}
                    </small>
                  </div>
                  <small>
                    {dateTime(line.created_at, session.tenant.timezone)}
                  </small>
                </article>
              ))}
          </div>
        </section>
      )}

      <ConfirmDialog
        open={pending !== null}
        title={
          pending?.decision === "accepted"
            ? "Accept this partner claim?"
            : "Reject this partner claim?"
        }
        description={
          pending
            ? `${pending.claim.partner_name} · ${money(amount(pending.claim.amount_minor), pending.claim.currency)}. ${
                pending.decision === "accepted"
                  ? "Acceptance creates a partner obligation. It does not record a guest payment."
                  : "Rejection keeps the claim history for audit. No obligation is created."
              }`
            : undefined
        }
        confirmLabel={
          pending?.decision === "accepted" ? "Accept claim" : "Reject claim"
        }
        danger={pending?.decision === "rejected"}
        busy={decision.busy}
        error={decision.error}
        onClose={() => {
          if (!decision.busy) setPending(null);
        }}
        onConfirm={() => void confirmDecision()}
      />
    </>
  );
}
