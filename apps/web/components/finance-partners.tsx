"use client";

import { useState } from "react";
import { ChevronDown, FileText } from "lucide-react";
import type { Session } from "@/lib/types";
import { dateOnly, label, money, useMutation, useResource } from "@/lib/client";
import {
  Empty,
  Field,
  FormDialog,
  Loading,
  Notice,
  SectionHeading,
} from "./common";

// ─── Types (mirror finance/v1 partner settlement responses) ───────────────────

type PartnerRollup = {
  id: string;
  name: string;
  partner_type?: string | null;
  commission_direction: "partner_owes_tenant" | "tenant_owes_partner";
  currency: string;
  unsettled_count: string;
  gross_minor: string;
  commission_minor: string;
};

type UnsettledBooking = {
  id: string;
  booking_id: string;
  reference: string;
  starts_at: string;
  booking_status: string;
  customer_name?: string | null;
  gross_amount_minor: string;
  commission_amount_minor: string;
  pax_count: number;
  currency: string;
};

type Settlement = {
  id: string;
  period_start: string;
  period_end: string;
  booking_count: number;
  gross_amount_minor: string;
  commission_amount_minor: string;
  net_amount_minor: string;
  commission_direction: string;
  currency: string;
  status: "draft" | "invoiced" | "sent" | "paid" | "overdue" | "void";
  due_date?: string | null;
  invoice_number?: string | null;
  payment_ref?: string | null;
  notes?: string | null;
};

type FinanceSummary = {
  receivable_minor: number;
  receivable_count: number;
  payable_minor: number;
  payable_count: number;
  overdue_count: number;
  overdue_minor: number;
  by_partner: PartnerRollup[];
};

/** Settlement lifecycle → an existing .status modifier in globals.css. */
const STATUS_CLASS: Record<string, string> = {
  draft: "unassigned",
  invoiced: "queued",
  sent: "sent",
  paid: "confirmed",
  overdue: "failed",
  void: "archived",
};

/** Which states a settlement may move to next. */
const NEXT_STATUSES: Record<string, string[]> = {
  draft: ["invoiced", "void"],
  invoiced: ["sent", "paid", "void"],
  sent: ["paid", "void"],
  overdue: ["paid", "void"],
  paid: ["void"],
};

function num(value: string | number) {
  return typeof value === "number" ? value : Number(value);
}

function SettlementStatus({ state }: { state: string }) {
  return (
    <span className={"status " + (STATUS_CLASS[state] ?? "")}>
      {label(state)}
    </span>
  );
}

// ─── Generate settlement dialog ───────────────────────────────────────────────

/** Default period: the last full calendar month. */
function defaultPeriod() {
  const now = new Date();
  const firstThis = new Date(now.getFullYear(), now.getMonth(), 1);
  const lastPrev = new Date(firstThis.getTime() - 86400000);
  const firstPrev = new Date(lastPrev.getFullYear(), lastPrev.getMonth(), 1);
  const iso = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
      d.getDate(),
    ).padStart(2, "0")}`;
  return { start: iso(firstPrev), end: iso(lastPrev) };
}

function GenerateDialog({
  partner,
  open,
  onClose,
  onGenerated,
}: {
  partner: PartnerRollup;
  open: boolean;
  onClose: () => void;
  onGenerated: () => void;
}) {
  const [period, setPeriod] = useState(defaultPeriod);
  const generate = useMutation();

  async function submit() {
    const result = await generate.run(
      `finance/v1/partners/${partner.id}/settlements`,
      { period_start: period.start, period_end: period.end },
    );
    if (result) {
      onGenerated();
      onClose();
    }
  }

  return (
    <FormDialog
      open={open}
      title={`Generate settlement — ${partner.name}`}
      description="Every unsettled booking whose departure falls inside this period is rolled into one settlement and marked as settled."
      busy={generate.busy}
      error={generate.error}
      submitLabel="Generate settlement"
      submitDisabled={!period.start || !period.end || period.end < period.start}
      onClose={() => {
        if (!generate.busy) onClose();
      }}
      onSubmit={submit}
    >
      <div className="form-grid">
        <Field label="Period start" required>
          <input
            required
            type="date"
            value={period.start}
            onChange={(e) =>
              setPeriod((v) => ({ ...v, start: e.target.value }))
            }
          />
        </Field>
        <Field label="Period end" required>
          <input
            required
            type="date"
            value={period.end}
            onChange={(e) => setPeriod((v) => ({ ...v, end: e.target.value }))}
          />
        </Field>
      </div>
    </FormDialog>
  );
}

// ─── Advance settlement dialog ────────────────────────────────────────────────

function AdvanceDialog({
  partnerId,
  settlement,
  open,
  onClose,
  onAdvanced,
}: {
  partnerId: string;
  settlement: Settlement | null;
  open: boolean;
  onClose: () => void;
  onAdvanced: () => void;
}) {
  const [status, setStatus] = useState("");
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [paymentRef, setPaymentRef] = useState("");
  const [voidReason, setVoidReason] = useState("");
  const [notes, setNotes] = useState("");
  const advance = useMutation();

  if (!settlement) return null;
  const allowed = NEXT_STATUSES[settlement.status] ?? [];

  async function submit() {
    if (!status || !settlement) return;
    const result = await advance.run(
      `finance/v1/partners/${partnerId}/settlements/${settlement.id}`,
      {
        status,
        invoice_number: invoiceNumber || undefined,
        payment_ref: paymentRef || undefined,
        void_reason: voidReason || undefined,
        notes: notes || undefined,
      },
      "PATCH",
    );
    if (result) {
      onAdvanced();
      onClose();
    }
  }

  return (
    <FormDialog
      open={open}
      title="Update settlement"
      description={`${dateOnlyRange(settlement)} · ${money(
        num(settlement.net_amount_minor),
        settlement.currency,
      )} net`}
      busy={advance.busy}
      error={advance.error}
      submitLabel="Update settlement"
      submitDisabled={!status || (status === "void" && !voidReason.trim())}
      onClose={() => {
        if (!advance.busy) onClose();
      }}
      onSubmit={submit}
    >
      <Field label="Move to" required>
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">— Select —</option>
          {allowed.map((s) => (
            <option key={s} value={s}>
              {label(s)}
            </option>
          ))}
        </select>
      </Field>
      {status === "invoiced" && (
        <Field
          label="Invoice number"
          hint="Reference on the invoice you issue."
        >
          <input
            maxLength={60}
            value={invoiceNumber}
            onChange={(e) => setInvoiceNumber(e.target.value)}
          />
        </Field>
      )}
      {status === "paid" && (
        <Field label="Payment reference" hint="Bank reference or transfer ID.">
          <input
            maxLength={60}
            value={paymentRef}
            onChange={(e) => setPaymentRef(e.target.value)}
          />
        </Field>
      )}
      {status === "void" && (
        <Field
          label="Void reason"
          required
          hint="Voiding releases every booking in this settlement back to unsettled."
        >
          <input
            required
            maxLength={200}
            value={voidReason}
            onChange={(e) => setVoidReason(e.target.value)}
          />
        </Field>
      )}
      <Field label="Notes">
        <textarea
          maxLength={500}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </Field>
    </FormDialog>
  );
}

function dateOnlyRange(s: Settlement) {
  return `${s.period_start} → ${s.period_end}`;
}

// ─── Expanded partner detail ──────────────────────────────────────────────────

function PartnerDetail({
  partner,
  session,
  canManage,
  onChanged,
}: {
  partner: PartnerRollup;
  session: Session;
  canManage: boolean;
  onChanged: () => void;
}) {
  const fmtDate = (value: string) =>
    dateOnly(
      value,
      session.tenant.config.dateFormat,
      session.tenant.config.locale,
    );
  const unsettled = useResource<UnsettledBooking[]>(
    `finance/v1/partners/${partner.id}/bookings/unsettled`,
  );
  const settlements = useResource<Settlement[]>(
    `finance/v1/partners/${partner.id}/settlements`,
  );
  const [generating, setGenerating] = useState(false);
  const [advancing, setAdvancing] = useState<Settlement | null>(null);

  function refreshAll() {
    unsettled.reload();
    settlements.reload();
    onChanged();
  }

  const rows = unsettled.data ?? [];
  const history = settlements.data ?? [];
  const grossTotal = rows.reduce((s, r) => s + num(r.gross_amount_minor), 0);
  const commissionTotal = rows.reduce(
    (s, r) => s + num(r.commission_amount_minor),
    0,
  );

  return (
    <div className="partner-detail">
      <SectionHeading
        title="Unsettled bookings"
        description="Attributed bookings not yet rolled into a settlement."
        action={
          canManage && rows.length > 0 ? (
            <button
              type="button"
              className="button secondary"
              onClick={() => setGenerating(true)}
            >
              <FileText size={16} /> Generate settlement
            </button>
          ) : undefined
        }
      />

      {unsettled.error ? (
        <Notice error>{unsettled.error}</Notice>
      ) : !unsettled.data ? (
        <Loading />
      ) : !rows.length ? (
        <p className="muted">
          Nothing outstanding — every attributed booking has been settled.
        </p>
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Booking</th>
                <th>Departure</th>
                <th>Guest</th>
                <th className="numeric">Guests</th>
                <th className="numeric">Gross</th>
                <th className="numeric">Commission</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>{row.reference.slice(0, 8)}</td>
                  <td>{fmtDate(row.starts_at)}</td>
                  <td>{row.customer_name ?? "—"}</td>
                  <td className="numeric">{row.pax_count}</td>
                  <td className="numeric">
                    {money(num(row.gross_amount_minor), row.currency)}
                  </td>
                  <td className="numeric">
                    {money(num(row.commission_amount_minor), row.currency)}
                  </td>
                </tr>
              ))}
              <tr>
                <td colSpan={4}>
                  <strong>{rows.length} bookings</strong>
                </td>
                <td className="numeric">
                  <strong>{money(grossTotal, partner.currency)}</strong>
                </td>
                <td className="numeric">
                  <strong>{money(commissionTotal, partner.currency)}</strong>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      <SectionHeading
        title="Settlement history"
        description="Each settlement locks the bookings it covers until it is paid or voided."
      />
      {settlements.error ? (
        <Notice error>{settlements.error}</Notice>
      ) : !settlements.data ? (
        <Loading />
      ) : !history.length ? (
        <p className="muted">No settlements generated for this partner yet.</p>
      ) : (
        <div className="settings-list">
          {history.map((s) => (
            <article key={s.id}>
              <div>
                <strong>
                  {fmtDate(s.period_start)} – {fmtDate(s.period_end)}{" "}
                  <SettlementStatus state={s.status} />
                </strong>
                <p>
                  {s.booking_count} booking{s.booking_count === 1 ? "" : "s"} ·{" "}
                  {money(num(s.commission_amount_minor), s.currency)} commission
                  {s.due_date ? ` · due ${fmtDate(s.due_date)}` : ""}
                  {s.invoice_number ? ` · invoice ${s.invoice_number}` : ""}
                  {s.payment_ref ? ` · ref ${s.payment_ref}` : ""}
                </p>
              </div>
              {canManage && (NEXT_STATUSES[s.status] ?? []).length > 0 && (
                <div className="location-list-actions">
                  <button
                    type="button"
                    className="button secondary"
                    onClick={() => setAdvancing(s)}
                  >
                    Update
                  </button>
                </div>
              )}
            </article>
          ))}
        </div>
      )}

      <GenerateDialog
        partner={partner}
        open={generating}
        onClose={() => setGenerating(false)}
        onGenerated={refreshAll}
      />
      <AdvanceDialog
        partnerId={partner.id}
        settlement={advancing}
        open={advancing !== null}
        onClose={() => setAdvancing(null)}
        onAdvanced={refreshAll}
      />
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export function FinancePartners({ session }: { session: Session }) {
  const canManage = session.permissions.includes("partner.manage");
  const summary = useResource<FinanceSummary>(
    "finance/v1/partner-finance-summary",
  );
  const [openId, setOpenId] = useState<string | null>(null);

  if (summary.error) return <Notice error>{summary.error}</Notice>;
  if (!summary.data) return <Loading />;

  const data = summary.data;
  const fallbackCurrency =
    data.by_partner[0]?.currency ||
    session.tenant.config.settlementCurrency ||
    session.tenant.config.collectionCurrency;

  return (
    <>
      <div className="finance-metrics">
        <div>
          <strong>{money(data.receivable_minor, fallbackCurrency)}</strong>
          <span>Receivable from partners ({data.receivable_count})</span>
        </div>
        <div>
          <strong>{money(data.payable_minor, fallbackCurrency)}</strong>
          <span>Payable to partners ({data.payable_count})</span>
        </div>
        <div className={data.overdue_count ? "attention" : ""}>
          <strong>{money(data.overdue_minor, fallbackCurrency)}</strong>
          <span>Overdue settlements ({data.overdue_count})</span>
        </div>
      </div>

      {!data.by_partner.length ? (
        <Empty title="No partner commission configured">
          <p>
            Set commission terms for a partner under Settings → Partners /
            Resellers. Once terms exist, attributed bookings accrue here and can
            be settled.
          </p>
        </Empty>
      ) : (
        <div className="partner-rollup-list">
          {data.by_partner.map((partner) => {
            const open = openId === partner.id;
            const receivable =
              partner.commission_direction === "partner_owes_tenant";
            const currency = partner.currency || fallbackCurrency;
            return (
              <article
                key={partner.id}
                className={"partner-rollup" + (open ? " open" : "")}
              >
                <button
                  type="button"
                  className="partner-rollup-head"
                  aria-expanded={open}
                  onClick={() => setOpenId(open ? null : partner.id)}
                >
                  <span className="partner-rollup-copy">
                    <strong>
                      {partner.name}
                      {partner.partner_type ? (
                        <span className="muted">
                          {" · "}
                          {label(partner.partner_type)}
                        </span>
                      ) : null}
                    </strong>
                    <span>
                      {partner.unsettled_count} unsettled ·{" "}
                      {receivable ? "Receivable" : "Payable"}{" "}
                      {money(num(partner.commission_minor), currency)} of{" "}
                      {money(num(partner.gross_minor), currency)} gross
                    </span>
                  </span>
                  <ChevronDown size={17} aria-hidden="true" />
                </button>
                {open && (
                  <div className="partner-rollup-body">
                    <PartnerDetail
                      partner={partner}
                      session={session}
                      canManage={canManage}
                      onChanged={summary.reload}
                    />
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </>
  );
}
