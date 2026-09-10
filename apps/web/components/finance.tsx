"use client";
import { useState } from "react";
import { Landmark, Check, X } from "lucide-react";
import type { PartnerClaim, Session } from "@/lib/types";
import { dateTime, money, useMutation, useResource } from "@/lib/client";
import { Empty, Field, Heading, Loading, Notice, Status } from "./common";

function amount(value: string | number) {
  return typeof value === "number" ? value : Number(value);
}

export function Finance({ session }: { session: Session }) {
  const claims = useResource<PartnerClaim[]>("finance/v1/partner-claims");
  const statements = useResource<{ id: string; booking_id: string; partner_id: string; partner_name: string; amount_minor: string; currency: string; kind: string; created_at: string }[]>("finance/v1/partner-statements");
  const [reason, setReason] = useState<Record<string, string>>({});
  const [stateFilter, setStateFilter] = useState<"all" | "unverified" | "accepted" | "rejected">("unverified");
  const [partnerFilter, setPartnerFilter] = useState("all");
  const decision = useMutation();
  async function decide(claim: PartnerClaim, value: "accepted" | "rejected") {
    const result = await decision.run(`finance/v1/partner-claims/${claim.id}/decision`, {
      decision: value,
      reason: reason[claim.id] ?? "",
    });
    if (result) claims.reload();
  }
  return (
    <>
      <Heading title="Partner collections" description="Review hotel and reseller collection evidence. Accepted claims create a partner obligation; they never create a guest payment." />
      {claims.error ? <Notice error>{claims.error}</Notice> : !claims.data ? <Loading /> : <><section className="panel form-panel"><div className="form-grid compact"><Field label="Review state"><select value={stateFilter} onChange={(event) => setStateFilter(event.target.value as typeof stateFilter)}><option value="unverified">Unverified</option><option value="accepted">Accepted</option><option value="rejected">Rejected</option><option value="all">All claims</option></select></Field><Field label="Partner"><select value={partnerFilter} onChange={(event) => setPartnerFilter(event.target.value)}><option value="all">All partners</option>{[...new Map(claims.data.map((claim) => [claim.partner_id, claim.partner_name])).entries()].map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></Field></div></section>{!claims.data.filter((claim) => (stateFilter === "all" || (claim.decision ?? "unverified") === stateFilter) && (partnerFilter === "all" || claim.partner_id === partnerFilter)).length ? (
        <Empty title="No partner collection claims"><p>Claims recorded against confirmed partner-collection bookings appear here.</p></Empty>
      ) : (
        <div className="stack-list">
          {claims.data.filter((claim) => (stateFilter === "all" || (claim.decision ?? "unverified") === stateFilter) && (partnerFilter === "all" || claim.partner_id === partnerFilter)).map((claim) => (
            <article className="panel finance-claim" key={claim.id}>
              <div className="panel-heading plain">
                <div>
                  <p className="eyebrow">{claim.partner_name}</p>
                  <h2>{money(amount(claim.amount_minor), claim.currency)}</h2>
                  <p>{claim.reference} · recorded {dateTime(claim.recorded_at, session.tenant.timezone)}</p>
                </div>
                <Status state={claim.decision ?? "unverified"} />
              </div>
              <p className="muted">{claim.notes || "No collection note supplied."}</p>
              {claim.decision ? (
                <p className="decision-note"><Landmark size={16} /> {claim.decision_reason}</p>
              ) : (
                <div className="finance-decision">
                  <Field label="Finance decision reason">
                    <input required maxLength={500} value={reason[claim.id] ?? ""} onChange={(event) => setReason({ ...reason, [claim.id]: event.target.value })} placeholder="Explain the approval or rejection" />
                  </Field>
                  {decision.error && <Notice error>{decision.error}</Notice>}
                  <div className="button-row">
                    <button className="button secondary" disabled={!reason[claim.id]?.trim() || decision.busy} onClick={() => void decide(claim, "accepted")}><Check size={16} /> Accept claim</button>
                    <button className="text-link danger" disabled={!reason[claim.id]?.trim() || decision.busy} onClick={() => void decide(claim, "rejected")}><X size={16} /> Reject claim</button>
                  </div>
                </div>
              )}
            </article>
          ))}
        </div>
      )}{statements.error ? <Notice error>{statements.error}</Notice> : statements.data?.length ? <section className="panel"><div className="panel-heading"><div><p className="eyebrow">PARTNER OBLIGATIONS</p><h2>Statement lines</h2></div></div><div className="table-scroll"><table><thead><tr><th>Partner</th><th>Kind</th><th>Amount</th><th>Booking</th><th>Recorded</th></tr></thead><tbody>{statements.data.filter((line) => partnerFilter === "all" || line.partner_id === partnerFilter).map((line) => <tr key={line.id}><td>{line.partner_name}</td><td>{line.kind.replaceAll("_", " ")}</td><td>{money(Number(line.amount_minor), line.currency)}</td><td className="mono">{line.booking_id.slice(0, 8).toUpperCase()}</td><td>{dateTime(line.created_at, session.tenant.timezone)}</td></tr>)}</tbody></table></div></section> : null}</>}
    </>
  );
}
