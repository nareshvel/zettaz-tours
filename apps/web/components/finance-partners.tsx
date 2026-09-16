"use client";

import { useEffect, useRef, useState, useMemo } from "react";
import {
  CheckCircle,
  ChevronRight,
  Circle,
  FileText,
  Landmark,
  ListFilter,
  Pencil,
  Plus,
  Search,
} from "lucide-react";
import type { Session } from "@/lib/types";
import { dateOnly, label, money, useMutation, useResource } from "@/lib/client";
import {
  Empty,
  Field,
  FormDialog,
  TenantDateInput,
  Loading,
  Notice,
  Toggle,
} from "./common";

// ─── Types ────────────────────────────────────────────────────────────────────

type Partner = {
  id: string;
  name: string;
  email?: string | null;
  phone?: string | null;
  status: "active" | "inactive";
  notes?: string | null;
  partner_type?: "ota" | "reseller" | "affiliate" | "wholesale" | null;
  commission_type?: "percentage" | "flat_per_booking" | "flat_per_pax" | "net_rate" | null;
  commission_rate?: number | string | null;
  commission_amount_minor?: number | string | null;
  commission_direction?: "partner_owes_tenant" | "tenant_owes_partner" | null;
  commission_currency?: string | null;
  settlement_schedule?: "monthly" | "biweekly" | "per_booking" | "custom" | "manual" | null;
  settlement_day?: number | null;
  payment_terms_days?: number | null;
  requires_formal_invoice?: boolean | null;
  contract_ref?: string | null;
};

type LedgerEntry = {
  id: string;
  kind: string;
  event_at: string;
  description: string;
  dr_minor: number;
  cr_minor: number;
  balance_minor: number;
  currency: string;
  status: string;
  ref?: string | null;
};

type LedgerResponse = {
  partner: {
    id: string;
    name: string;
    partner_type: string | null;
    commission_type: string | null;
    commission_rate: number | null;
    commission_amount_minor: number | null;
    commission_direction: string | null;
    commission_currency: string | null;
    settlement_schedule: string | null;
    payment_terms_days: number | null;
    balance_minor: number;
    unsettled_count: number;
  };
  entries: LedgerEntry[];
  has_more: boolean;
};

type Settlement = {
  id: string;
  status: string;
  period_start: string;
  period_end: string;
  gross_minor: number;
  net_minor: number;
  currency: string;
  created_at: string;
  booking_count?: number;
  invoice_number?: string;
};

type UnsettledBooking = { id: string; amount_minor: number; currency: string };

const WEEKDAYS = ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"];
const DAY_SCHEDULES = ["monthly","weekly","biweekly"];
const NEXT_STATUSES: Record<string, string[]> = {
  draft: ["invoiced", "voided"],
  invoiced: ["sent", "voided"],
  sent: ["paid", "voided"],
  paid: [],
  voided: [],
};

const emptyForm = {
  name: "", email: "", phone: "", notes: "",
  partnerType: "", commissionType: "", commissionRate: "", commissionAmount: "",
  commissionDirection: "partner_owes_tenant", commissionCurrency: "",
  settlementSchedule: "manual", settlementDay: "", paymentTermsDays: "30",
  requiresFormalInvoice: false, contractRef: "",
};
type PartnerForm = typeof emptyForm;

function numeric(v: number | string | null | undefined) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function commissionSummary(p: Partner, fallback: string) {
  if (!p.commission_type) return "No commission configured";
  const cur = p.commission_currency || fallback;
  const rate = numeric(p.commission_rate);
  const amt = numeric(p.commission_amount_minor);
  const terms =
    p.commission_type === "percentage" && rate !== null
      ? `${(rate * 100).toFixed((rate * 100) % 1 === 0 ? 0 : 1)}%`
      : p.commission_type === "flat_per_booking" && amt !== null
        ? `${money(amt, cur)} / booking`
        : p.commission_type === "flat_per_pax" && amt !== null
          ? `${money(amt, cur)} / pax`
          : label(p.commission_type);
  const dir = p.commission_direction === "partner_owes_tenant" ? "partner pays us" : "we pay partner";
  return `${terms} · ${dir}`;
}

function formFromPartner(p: Partner | undefined, fallback: string): PartnerForm {
  if (!p) return { ...emptyForm, commissionCurrency: fallback };
  const rate = numeric(p.commission_rate);
  const amt = numeric(p.commission_amount_minor);
  return {
    name: p.name, email: p.email ?? "", phone: p.phone ?? "", notes: p.notes ?? "",
    partnerType: p.partner_type ?? "", commissionType: p.commission_type ?? "",
    commissionRate: rate !== null ? String(rate * 100) : "",
    commissionAmount: amt !== null ? String(amt / 100) : "",
    commissionDirection: p.commission_direction ?? "partner_owes_tenant",
    commissionCurrency: p.commission_currency || fallback,
    settlementSchedule: p.settlement_schedule ?? "manual",
    settlementDay: p.settlement_day != null ? String(p.settlement_day) : "",
    paymentTermsDays: String(p.payment_terms_days ?? 30),
    requiresFormalInvoice: p.requires_formal_invoice ?? false,
    contractRef: p.contract_ref ?? "",
  };
}

// ─── Partner form modal ───────────────────────────────────────────────────────

function PartnerFormModal({
  open, mode, partner, session, onClose, onSaved,
}: {
  open: boolean;
  mode: "create" | "edit";
  partner?: Partner;
  session: Session;
  onClose: () => void;
  onSaved: () => void;
}) {
  const fallback = session.tenant.config.settlementCurrency || session.tenant.config.collectionCurrency;
  const [form, setForm] = useState<PartnerForm>(() => formFromPartner(partner, fallback));
  const mut = useMutation();

  // Reset form whenever the modal opens or the partner changes
  useEffect(() => {
    if (open) {
      setForm(formFromPartner(partner, fallback));
      mut.clear();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, partner?.id]);
  const set = <K extends keyof PartnerForm>(k: K, v: PartnerForm[K]) => setForm((f) => ({ ...f, [k]: v }));

  const isEdit = mode === "edit";
  const showRate = form.commissionType === "percentage";
  const showAmount = form.commissionType === "flat_per_booking" || form.commissionType === "flat_per_pax";
  const showDay = DAY_SCHEDULES.includes(form.settlementSchedule);

  function commissionPayload() {
    const p: Record<string, unknown> = {
      commission_type: form.commissionType || null,
      commission_direction: form.commissionDirection,
      commission_currency: form.commissionCurrency || fallback,
      settlement_schedule: form.settlementSchedule || "manual",
      payment_terms_days: Number(form.paymentTermsDays) || 30,
      requires_formal_invoice: form.requiresFormalInvoice,
    };
    if (form.partnerType) p.partner_type = form.partnerType;
    if (form.commissionType === "percentage" && form.commissionRate)
      p.commission_rate = Number(form.commissionRate) / 100;
    if ((form.commissionType === "flat_per_booking" || form.commissionType === "flat_per_pax") && form.commissionAmount)
      p.commission_amount_minor = Math.round(Number(form.commissionAmount) * 100);
    if (DAY_SCHEDULES.includes(form.settlementSchedule) && form.settlementDay)
      p.settlement_day = Number(form.settlementDay);
    if (form.contractRef) p.contract_ref = form.contractRef;
    return p;
  }

  async function submit() {
    if (!form.name.trim()) return;
    let partnerId = isEdit && partner ? partner.id : (null as string | null);

    if (!isEdit) {
      const created = await mut.run<Partner>("finance/v1/partners", {
        name: form.name,
        email: form.email || undefined,
        phone: form.phone || undefined,
        notes: form.notes,
      });
      if (!created) return;
      partnerId = created.id;
    } else if (partner) {
      const before = partner;
      const changes: Record<string, unknown> = {};
      if (form.name.trim() !== before.name) changes.name = form.name.trim();
      if (form.email.trim() !== (before.email ?? "")) changes.email = form.email.trim() || null;
      if (form.phone.trim() !== (before.phone ?? "")) changes.phone = form.phone.trim() || null;
      if (form.notes.trim() !== (before.notes ?? "")) changes.notes = form.notes.trim();
      if (Object.keys(changes).length) {
        const updated = await mut.run(`finance/v1/partners/${partnerId}`, changes, "PATCH");
        if (!updated) return;
      }
    }

    if (form.commissionType && partnerId) {
      const saved = await mut.run(
        `finance/v1/partners/${partnerId}/commission`,
        commissionPayload(),
        "PATCH",
      );
      if (!saved) return;
    }

    mut.clear();
    onSaved();
  }

  return (
    <FormDialog
      open={open}
      title={isEdit ? `Edit ${partner?.name ?? "Partner"}` : "Add partner"}
      description={
        isEdit
          ? "Contact details apply immediately. Commission terms apply to bookings attributed from now on."
          : "Create the partner, then set how commission is calculated and settled."
      }
      busy={mut.busy}
      error={mut.error}
      submitLabel={isEdit ? "Save changes" : "Add partner"}
      submitDisabled={!form.name.trim()}
      className="partner-dialog"
      onClose={() => { if (!mut.busy) onClose(); }}
      onSubmit={submit}
    >
      <div className="form-grid three">
        <Field label="Partner name" required>
          <input
            required
            maxLength={160}
            value={form.name}
            placeholder="e.g. Viator"
            onChange={(e) => set("name", e.target.value)}
          />
        </Field>
        <Field label="Email">
          <input
            type="email"
            maxLength={254}
            value={form.email}
            onChange={(e) => set("email", e.target.value)}
          />
        </Field>
        <Field label="Phone">
          <input
            maxLength={40}
            value={form.phone}
            onChange={(e) => set("phone", e.target.value)}
          />
        </Field>
      </div>

      <div className={showRate || showAmount ? "form-grid three" : "form-grid"}>
        <Field label="Partner type">
          <select value={form.partnerType} onChange={(e) => set("partnerType", e.target.value)}>
            <option value="">— Select —</option>
            <option value="ota">OTA / Platform</option>
            <option value="reseller">Reseller / Agency</option>
            <option value="affiliate">Affiliate / Referral</option>
            <option value="wholesale">Wholesale / Net rate</option>
          </select>
        </Field>
        <Field label="Commission basis" hint="Leave unset to add the partner without commission terms.">
          <select value={form.commissionType} onChange={(e) => set("commissionType", e.target.value)}>
            <option value="">— Not configured —</option>
            <option value="percentage">Percentage of gross</option>
            <option value="flat_per_booking">Flat per booking</option>
            <option value="flat_per_pax">Flat per guest</option>
            <option value="net_rate">Net rate</option>
          </select>
        </Field>
        {showRate && (
          <Field label="Commission rate (%)" required>
            <input
              required
              type="number"
              min={0}
              max={100}
              step={0.1}
              value={form.commissionRate}
              placeholder="e.g. 15"
              onChange={(e) => set("commissionRate", e.target.value)}
            />
          </Field>
        )}
        {showAmount && (
          <Field label={`Amount (${form.commissionCurrency || fallback})`} required>
            <input
              required
              type="number"
              min={0}
              step={0.01}
              value={form.commissionAmount}
              placeholder="e.g. 10.00"
              onChange={(e) => set("commissionAmount", e.target.value)}
            />
          </Field>
        )}
      </div>

      {form.commissionType && (
        <>
          <div className="form-grid three">
            <Field
              label="Money direction"
              hint={
                form.commissionDirection === "partner_owes_tenant"
                  ? "Partner collects from the guest, remits your share."
                  : "You collect from the guest, remit their commission."
              }
            >
              <select
                value={form.commissionDirection}
                onChange={(e) => set("commissionDirection", e.target.value)}
              >
                <option value="partner_owes_tenant">Partner pays us</option>
                <option value="tenant_owes_partner">We pay the partner</option>
              </select>
            </Field>
            <Field label="Settlement currency">
              <input
                maxLength={3}
                pattern="[A-Za-z]{3}"
                value={form.commissionCurrency}
                onChange={(e) => set("commissionCurrency", e.target.value.toUpperCase())}
              />
            </Field>
            <Field label="Payment terms (days)" hint="Net days until due.">
              <input
                type="number"
                min={0}
                max={365}
                value={form.paymentTermsDays}
                onChange={(e) => set("paymentTermsDays", e.target.value)}
              />
            </Field>
          </div>

          <div className={showDay ? "form-grid three" : "form-grid"}>
            <Field label="Settlement schedule">
              <select
                value={form.settlementSchedule}
                onChange={(e) => {
                  set("settlementSchedule", e.target.value);
                  set("settlementDay", "");
                }}
              >
                <option value="manual">Manual</option>
                <option value="weekly">Weekly</option>
                <option value="biweekly">Bi-weekly</option>
                <option value="monthly">Monthly</option>
                <option value="per_booking">Per booking</option>
                <option value="custom">Custom</option>
              </select>
            </Field>
            {showDay && (
              form.settlementSchedule === "monthly" ? (
                <Field label="Day of month" hint="1–31. Short months fall back to their last day.">
                  <input
                    type="number"
                    min={1}
                    max={31}
                    value={form.settlementDay}
                    onChange={(e) => set("settlementDay", e.target.value)}
                  />
                </Field>
              ) : (
                <Field label="Day of week">
                  <select
                    value={form.settlementDay}
                    onChange={(e) => set("settlementDay", e.target.value)}
                  >
                    <option value="">— Any —</option>
                    {WEEKDAYS.map((d, i) => (
                      <option key={d} value={String(i + 1)}>{d}</option>
                    ))}
                  </select>
                </Field>
              )
            )}
            <Field label="Contract reference" hint="Contract number or link.">
              <input
                maxLength={200}
                value={form.contractRef}
                onChange={(e) => set("contractRef", e.target.value)}
              />
            </Field>
          </div>

          <Toggle
            label="Requires a formal invoice"
            description="Settlements must reach Invoiced with a number before they can be paid."
            checked={form.requiresFormalInvoice}
            onChange={(checked) => set("requiresFormalInvoice", checked)}
          />
        </>
      )}

      <Field label="Notes" hint="Internal only — not visible to the partner.">
        <textarea
          maxLength={2000}
          rows={3}
          value={form.notes}
          onChange={(e) => set("notes", e.target.value)}
        />
      </Field>
    </FormDialog>
  );
}


// ─── Settlement pipeline stepper ─────────────────────────────────────────────

const PIPELINE_STEPS = ["draft", "invoiced", "sent", "paid"] as const;
const PIPELINE_LABELS: Record<string, string> = {
  draft: "Draft", invoiced: "Invoiced", sent: "Sent", paid: "Paid",
};

function SettlementStepper({
  settlement,
  partnerId,
  onAdvance,
}: {
  settlement: Settlement;
  partnerId: string;
  onAdvance: (toStatus: string) => void;
}) {
  const currentIdx = PIPELINE_STEPS.indexOf(settlement.status as typeof PIPELINE_STEPS[number]);
  const isVoided = settlement.status === "voided";

  return (
    <div className="settlement-pipeline">
      {PIPELINE_STEPS.map((step, i) => {
        const done = currentIdx > i;
        const active = currentIdx === i;
        const isNext = currentIdx >= 0 && i === currentIdx + 1 && !isVoided;
        return (
          <div key={step} className={`pipeline-step ${done ? "done" : active ? "active" : isVoided ? "voided" : "future"}`}>
            {i > 0 && <ChevronRight size={12} className="pipeline-chevron" />}
            <button
              className={`pipeline-node ${isNext ? "pipeline-action" : ""}`}
              onClick={() => isNext && onAdvance(step)}
              disabled={!isNext}
              title={isNext ? `Advance to ${PIPELINE_LABELS[step]}` : undefined}
            >
              {done ? <CheckCircle size={14} /> : <Circle size={14} />}
              <span>{PIPELINE_LABELS[step]}</span>
            </button>
          </div>
        );
      })}
      {isVoided && <span className="pipeline-voided-badge">Voided</span>}
    </div>
  );
}

// ─── Generate Settlement dialog ───────────────────────────────────────────────

function GenerateDialog({
  partner, session, open, onClose, onGenerated,
}: {
  partner: Partner;
  session: Session;
  open: boolean;
  onClose: () => void;
  onGenerated: (settlement: Settlement) => void;
}) {
  const fallback = session.tenant.config.settlementCurrency || session.tenant.config.collectionCurrency;
  const currency = partner.commission_currency || fallback;

  // Auto-suggest: last month
  function defaultPeriod() {
    const now = new Date();
    const from = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const to = new Date(now.getFullYear(), now.getMonth(), 0);
    return {
      start: from.toISOString().slice(0, 10),
      end: to.toISOString().slice(0, 10),
    };
  }
  const { start: defStart, end: defEnd } = defaultPeriod();

  const [periodStart, setPeriodStart] = useState(defStart);
  const [periodEnd, setPeriodEnd] = useState(defEnd);
  const gen = useMutation();

  // Preview: how many unsettled bookings in period — cleared whenever dates change
  const { data: preview } = useResource<{ count: number; total_minor: number; currency: string }>(
    open ? `finance/v1/partners/${partner.id}/bookings/unsettled-summary?from=${periodStart}&to=${periodEnd}` : null,
  );

  useEffect(() => {
    if (open) { gen.clear(); setPeriodStart(defStart); setPeriodEnd(defEnd); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Clear any previous submission error when dates change
  useEffect(() => { gen.clear(); }, [periodStart, periodEnd]); // eslint-disable-line react-hooks/exhaustive-deps

  const noBookings = preview != null && preview.count === 0;

  async function submit() {
    if (noBookings) return;
    const result = await gen.run<Settlement>(
      `finance/v1/partners/${partner.id}/settlements`,
      { period_start: periodStart, period_end: periodEnd },
    );
    if (result) { gen.clear(); onGenerated(result); }
  }

  return (
    <FormDialog
      open={open}
      title={`Generate Settlement — ${partner.name}`}
      description="Creates a settlement grouping all unsettled bookings in the period. You can then issue, send and record payment."
      busy={gen.busy}
      error={noBookings ? undefined : gen.error}
      onSubmit={submit}
      onClose={onClose}
      submitLabel="Generate"
      submitDisabled={noBookings}
    >
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <TenantDateInput
          label="Period start"
          value={periodStart}
          onChange={setPeriodStart}
          dateFormat={session.tenant.config.dateFormat as "DD/MM/YYYY" | "MM/DD/YYYY" | "YYYY-MM-DD"}
          locale={session.tenant.config.locale}
        />
        <TenantDateInput
          label="Period end"
          value={periodEnd}
          onChange={setPeriodEnd}
          dateFormat={session.tenant.config.dateFormat as "DD/MM/YYYY" | "MM/DD/YYYY" | "YYYY-MM-DD"}
          locale={session.tenant.config.locale}
        />
      </div>

      {/* Preview / no-bookings notice — toast-style banner */}
      {preview && (
        noBookings ? (
          <div style={{
            display: "flex", alignItems: "center", gap: 8,
            background: "color-mix(in srgb, var(--warning, #f59e0b) 12%, transparent)",
            border: "1px solid color-mix(in srgb, var(--warning, #f59e0b) 35%, transparent)",
            borderRadius: 8, padding: "10px 14px", fontSize: "0.82rem",
            color: "var(--warning-text, #92400e)",
          }}>
            <span style={{ fontSize: "1rem" }}>⚠️</span>
            No unsettled bookings found in this period. Adjust the dates to include bookings.
          </div>
        ) : (
          <div style={{
            display: "flex", alignItems: "center", gap: 8,
            background: "color-mix(in srgb, var(--success, #10b981) 10%, transparent)",
            border: "1px solid color-mix(in srgb, var(--success, #10b981) 30%, transparent)",
            borderRadius: 8, padding: "10px 14px", fontSize: "0.82rem",
          }}>
            <span style={{ fontSize: "1rem" }}>✓</span>
            <span>
              <strong>{preview.count}</strong> unsettled booking{preview.count !== 1 ? "s" : ""} ·{" "}
              <strong>{money(preview.total_minor, preview.currency || currency)}</strong>
            </span>
          </div>
        )
      )}
    </FormDialog>
  );
}

// ─── Mark Paid dialog ─────────────────────────────────────────────────────────

function MarkPaidDialog({
  partnerId, settlement, open, onClose, onPaid, session,
}: {
  partnerId: string;
  settlement: Settlement | null;
  open: boolean;
  onClose: () => void;
  onPaid: () => void;
  session: Session;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const [paymentDate, setPaymentDate] = useState(today);
  const [paymentRef, setPaymentRef] = useState("");
  const [confirmedAmount, setConfirmedAmount] = useState("");
  const mut = useMutation();

  useEffect(() => {
    if (open) { mut.clear(); setPaymentDate(today); setPaymentRef(""); setConfirmedAmount(""); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function submit() {
    if (!settlement) return;
    const body: Record<string, unknown> = { status: "paid" };
    if (paymentRef) body.payment_ref = paymentRef;
    if (paymentDate) body.payment_date = paymentDate;
    if (confirmedAmount) body.confirmed_amount_minor = Math.round(Number(confirmedAmount) * 100);
    const result = await mut.run(
      `finance/v1/partners/${partnerId}/settlements/${settlement.id}`, body, "PATCH",
    );
    if (result) { mut.clear(); onPaid(); }
  }

  return (
    <FormDialog
      open={open && !!settlement}
      title="Record Payment Received"
      description="Confirm receipt of this settlement payment. This marks the settlement as fully paid."
      busy={mut.busy}
      error={mut.error}
      onSubmit={submit}
      onClose={onClose}
      submitLabel="Confirm Payment"
    >
      {settlement && (
        <div style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 8, padding: "10px 14px", fontSize: "0.82rem", marginBottom: 8 }}>
          <span style={{ color: "var(--muted)" }}>Settlement amount: </span>
          <strong>{money(settlement.net_minor, settlement.currency)}</strong>
        </div>
      )}
      <TenantDateInput
        label="Date received"
        value={paymentDate}
        onChange={setPaymentDate}
        max={today}
        dateFormat={session.tenant.config.dateFormat as "DD/MM/YYYY" | "MM/DD/YYYY" | "YYYY-MM-DD"}
        locale={session.tenant.config.locale}
      />
      <Field label="Payment reference" hint="Bank transfer ref, cheque number, or remittance advice.">
        <input
          placeholder="e.g. TT-2024-0823"
          value={paymentRef}
          onChange={(e) => setPaymentRef(e.target.value)}
        />
      </Field>
      <Field label="Confirmed amount" hint={`Leave blank if exact match (${settlement ? money(settlement.net_minor, settlement.currency) : ""})`}>
        <input
          type="number"
          step="0.01"
          placeholder="0.00"
          value={confirmedAmount}
          onChange={(e) => setConfirmedAmount(e.target.value)}
        />
      </Field>
    </FormDialog>
  );
}

// ─── Advance status dialog (non-paid transitions) ─────────────────────────────

function AdvanceDialog({
  partnerId, settlement, open, preSelectedStatus, onClose, onAdvanced,
}: {
  partnerId: string;
  settlement: Settlement | null;
  open: boolean;
  preSelectedStatus?: string;
  onClose: () => void;
  onAdvanced: () => void;
}) {
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [voidReason, setVoidReason] = useState("");
  const advance = useMutation();
  const effectiveStatus = preSelectedStatus ?? "";

  useEffect(() => {
    if (open) { advance.clear(); setInvoiceNumber(""); setVoidReason(""); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function submit() {
    if (!settlement || !effectiveStatus) return;
    const body: Record<string, unknown> = { status: effectiveStatus };
    if (invoiceNumber) body.invoice_number = invoiceNumber;
    if (effectiveStatus === "voided") body.void_reason = voidReason;
    const result = await advance.run(
      `finance/v1/partners/${partnerId}/settlements/${settlement.id}`, body, "PATCH",
    );
    if (result) { advance.clear(); onAdvanced(); }
  }

  const titleMap: Record<string, string> = { invoiced: "Issue Settlement", sent: "Mark as Sent", voided: "Void Settlement" };

  return (
    <FormDialog open={open && !!settlement} title={titleMap[effectiveStatus] ?? "Advance Settlement"} busy={advance.busy}
      error={advance.error} onSubmit={submit} onClose={onClose}
      submitLabel={effectiveStatus === "voided" ? "Void" : "Confirm"}>
      {effectiveStatus === "invoiced" && (
        <Field label="Invoice number" hint="Reference number you'll send to the partner.">
          <input value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} />
        </Field>
      )}
      {effectiveStatus === "sent" && (
        <p style={{ fontSize: "0.82rem", color: "var(--muted)", margin: 0 }}>
          Confirm you've sent the statement to <strong>{settlement?.currency}</strong> partner. You can record the payment once it arrives.
        </p>
      )}
      {effectiveStatus === "voided" && (
        <Field label="Void reason" required>
          <textarea rows={2} value={voidReason} onChange={(e) => setVoidReason(e.target.value)} required />
        </Field>
      )}
    </FormDialog>
  );
}

// ─── Partner detail (right panel) ────────────────────────────────────────────

function LedgerEntryRow({ entry, dateFormat }: { entry: LedgerEntry; dateFormat: string }) {
  return (
    <tr>
      <td>{dateOnly(entry.event_at, dateFormat as "DD/MM/YYYY" | "MM/DD/YYYY" | "YYYY-MM-DD")}</td>
      <td>
        {entry.description}
        {entry.ref && entry.kind !== "booking" && (
          <span style={{ marginLeft: 6, fontSize: "0.72rem", color: "var(--muted)" }}>{entry.ref}</span>
        )}
      </td>
      <td><span className={`ledger-badge ${entry.status ?? ""}`}>{entry.status ? label(entry.status) : "—"}</span></td>
      <td className="num dr">{entry.dr_minor > 0 ? money(entry.dr_minor, entry.currency) : "—"}</td>
      <td className="num cr">{entry.cr_minor > 0 ? money(entry.cr_minor, entry.currency) : "—"}</td>
      <td className={`num ${entry.balance_minor >= 0 ? "bal-pos" : "bal-neg"}`}>
        {money(Math.abs(entry.balance_minor), entry.currency)}
      </td>
    </tr>
  );
}

function PartnerDetailPanel({
  partner, session, onEdit, onRefresh,
}: {
  partner: Partner;
  session: Session;
  onEdit: () => void;
  onRefresh: () => void;
}) {
  const [page, setPage] = useState(1);
  // Status filter covers both booking states and settlement pipeline states
  const [statusFilter, setStatusFilter] = useState<"" | "unsettled" | "settled" | "draft" | "invoiced" | "sent" | "paid" | "voided">("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [filterOpen, setFilterOpen] = useState(false);
  const [deletingSettlement, setDeletingSettlement] = useState<Settlement | null>(null);
  const delSmt = useMutation();
  const filterRef = useRef<HTMLDivElement>(null);
  const [advancing, setAdvancing] = useState<{ settlement: Settlement; status: string } | null>(null);
  const [markingPaid, setMarkingPaid] = useState<Settlement | null>(null);
  const [generating, setGenerating] = useState(false);
  const [highlightSettlement, setHighlightSettlement] = useState<Settlement | null>(null);

  // Close popover on outside click / Escape
  useEffect(() => {
    if (!filterOpen) return;
    function handleClick(e: MouseEvent) {
      const t = e.target as Node;
      // Ignore clicks inside the calendar picker portal (renders outside filterRef via createPortal)
      if ((t as Element).closest?.(".tdp-popup")) return;
      if (filterRef.current && !filterRef.current.contains(t)) setFilterOpen(false);
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") setFilterOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => { document.removeEventListener("mousedown", handleClick); document.removeEventListener("keydown", handleKey); };
  }, [filterOpen]);

  // Map settlement-specific statuses to API status param
  const apiStatus: string = (
    statusFilter === "unsettled" ? "unsettled" :
    statusFilter === "settled"   ? "settled"   :
    // For settlement pipeline statuses, we show settled bookings + filter by settlement status client-side
    ["draft","invoiced","sent","paid","voided"].includes(statusFilter) ? "settled" :
    ""
  );

  const ledgerQs = [
    `page=${page}`,
    apiStatus ? `status=${apiStatus}` : "",
    dateFrom ? `dateFrom=${dateFrom}` : "",
    dateTo   ? `dateTo=${dateTo}` : "",
  ].filter(Boolean).join("&");

  const filterCount = [statusFilter, dateFrom || dateTo].filter(Boolean).length;

  const { data: ledger, error: ledgerError, reload: reloadLedger } = useResource<LedgerResponse>(
    `finance/v1/partners/${partner.id}/ledger?${ledgerQs}`,
  );
  const { data: settlementData, reload: reloadSettlements } = useResource<Settlement[]>(
    `finance/v1/partners/${partner.id}/settlements`,
  );

  const fallback = session.tenant.config.settlementCurrency || session.tenant.config.collectionCurrency;
  const currency = ledger?.partner.commission_currency || partner.commission_currency || fallback;
  // balance_minor is now returned directly from the improved API
  const balance = ledger?.partner.balance_minor ?? 0;
  const unsettledCount = ledger?.partner.unsettled_count ?? 0;
  const latestSettlement = highlightSettlement ?? (settlementData?.[0] ?? null);

  // Direction tooltip label
  const directionLabel = partner.commission_direction === "partner_owes_tenant"
    ? "Dr — partner owes you"
    : partner.commission_direction === "tenant_owes_partner"
    ? "Cr — you owe partner"
    : null;

  function refresh() { reloadLedger(); reloadSettlements(); onRefresh(); }

  function handlePipelineStep(settlement: Settlement, toStatus: string) {
    if (toStatus === "paid") {
      setMarkingPaid(settlement);
    } else {
      setAdvancing({ settlement, status: toStatus });
    }
  }

  // When filtering by a settlement pipeline status, further filter entries client-side
  const settlementStatusFilter = ["draft","invoiced","sent","paid","voided"].includes(statusFilter) ? statusFilter : null;

  return (
    <>
      {/* Toolbar — title left, filters + generate right */}
      <div className="finance-detail-toolbar">
        <div className="finance-detail-toolbar-title">
          {partner.name}
          {partner.partner_type && (
            <span className="ledger-badge settled" style={{ marginLeft: 8 }}>{label(partner.partner_type)}</span>
          )}
          {directionLabel && (
            <span
              className="partner-dir-chip"
              title={directionLabel}
            >
              {partner.commission_direction === "partner_owes_tenant" ? "Dr" : "Cr"}
            </span>
          )}
          {partner.status === "inactive" && (
            <span className="ledger-badge voided" style={{ marginLeft: 6 }}>Inactive</span>
          )}
        </div>

        {/* Right-side controls */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
          {/* Filter button — popover */}
          <div className="filter-menu" ref={filterRef}>
            <button
              type="button"
              className={`button secondary small${filterCount > 0 ? " active-filter" : ""}`}
              aria-label="Filter ledger"
              aria-expanded={filterOpen}
              aria-haspopup="dialog"
              onClick={() => setFilterOpen((o) => !o)}
            >
              <ListFilter size={14} />
              <span>Filter</span>
              {filterCount > 0 && <span className="filter-count">{filterCount}</span>}
            </button>

            {filterOpen && (
              <div className="filter-popover" role="dialog" aria-label="Ledger filters">
                <div className="filter-popover-head">
                  <strong>Filters</strong>
                </div>

                {/* Date range */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  <TenantDateInput
                    label="From"
                    value={dateFrom}
                    onChange={(v) => { setDateFrom(v); setPage(1); }}
                    dateFormat={session.tenant.config.dateFormat as "DD/MM/YYYY" | "MM/DD/YYYY" | "YYYY-MM-DD"}
                    locale={session.tenant.config.locale}
                    compact
                  />
                  <TenantDateInput
                    label="To"
                    value={dateTo}
                    onChange={(v) => { setDateTo(v); setPage(1); }}
                    dateFormat={session.tenant.config.dateFormat as "DD/MM/YYYY" | "MM/DD/YYYY" | "YYYY-MM-DD"}
                    locale={session.tenant.config.locale}
                    compact
                  />
                </div>

                {/* Status — bookings */}
                <div className="compact-control">
                  <span>Booking status</span>
                  <div className="filter-range-options" style={{ gridTemplateColumns: "1fr 1fr 1fr" }}>
                    {([["", "All"], ["unsettled", "Unsettled"], ["settled", "Settled"]] as const).map(([v, lbl]) => (
                      <button
                        key={v}
                        type="button"
                        className={`filter-range-option${statusFilter === v ? " selected" : ""}`}
                        onClick={() => { setStatusFilter(v); setPage(1); }}
                      >
                        {lbl}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Status — settlement pipeline */}
                <div className="compact-control">
                  <span>Settlement status</span>
                  <div className="filter-range-options" style={{ gridTemplateColumns: "1fr 1fr 1fr" }}>
                    {([["draft","Draft"],["invoiced","Invoiced"],["sent","Sent"],["paid","Paid"],["voided","Voided"]] as const).map(([v, lbl]) => (
                      <button
                        key={v}
                        type="button"
                        className={`filter-range-option${statusFilter === v ? " selected" : ""}`}
                        onClick={() => { setStatusFilter(v); setPage(1); }}
                      >
                        {lbl}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="filter-popover-actions">
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => { setStatusFilter(""); setDateFrom(""); setDateTo(""); setPage(1); }}
                  >
                    Reset
                  </button>
                  <button
                    type="button"
                    className="button small primary"
                    onClick={() => setFilterOpen(false)}
                  >
                    Done
                  </button>
                </div>
              </div>
            )}
          </div>

          <button
            className="button small secondary"
            onClick={() => setGenerating(true)}
          >
            <FileText size={13} /> Generate
          </button>
        </div>
      </div>

      <div className="finance-detail-scroll">
        {/* Account summary */}
        <div className="finance-account-strip">
          <div className="finance-account-tile">
            <div className="finance-account-tile-label">
              {balance > 0 ? "You are owed" : balance < 0 ? "You owe" : "Balance"}
            </div>
            <div className={`finance-account-tile-value ${balance > 0 ? "receivable" : balance < 0 ? "payable" : ""}`}>
              {balance === 0
                ? <span style={{ color: "var(--muted)" }}>—</span>
                : money(Math.abs(balance), currency)}
            </div>
            <div style={{ fontSize: "0.68rem", color: "var(--muted)", marginTop: 2 }}>
              {balance === 0 ? "All settled" : balance > 0 ? "Net receivable" : "Net payable"}
            </div>
          </div>

          <div className="finance-account-tile">
            <div className="finance-account-tile-label">Unsettled bookings</div>
            <div className="finance-account-tile-value" style={{ color: unsettledCount > 0 ? "#d97706" : "var(--ink)" }}>
              {!ledger ? "…" : unsettledCount === 0 ? "—" : unsettledCount}
            </div>
            <div style={{ fontSize: "0.68rem", color: "var(--muted)", marginTop: 2 }}>
              {unsettledCount === 0 ? "Nothing pending" : "Ready to settle"}
            </div>
          </div>

          <div className="finance-account-tile">
            <div className="finance-account-tile-label">Latest settlement</div>
            <div className="finance-account-tile-value" style={{ fontSize: "0.82rem" }}>
              {latestSettlement
                ? <span className={`ledger-badge ${latestSettlement.status}`}>{label(latestSettlement.status)}</span>
                : <span style={{ color: "var(--muted)" }}>None yet</span>}
            </div>
            {latestSettlement && (
              <div style={{ fontSize: "0.68rem", color: "var(--muted)", marginTop: 2 }}>
                {money(latestSettlement.net_minor, latestSettlement.currency)}
              </div>
            )}
          </div>

          <div className="finance-account-tile">
            <div className="finance-account-tile-label">Commission</div>
            <div className="finance-account-tile-value" style={{ fontSize: "0.82rem" }}>
              {commissionSummary(partner, fallback)}
            </div>
            <div style={{ fontSize: "0.68rem", color: "var(--muted)", marginTop: 2 }}>
              {partner.settlement_schedule ? label(partner.settlement_schedule) : "Manual"}
              {partner.payment_terms_days ? ` · Net ${partner.payment_terms_days}d` : ""}
            </div>
          </div>
        </div>

        {/* Settlement pipeline — shown when there's a settlement in progress */}
        {latestSettlement && latestSettlement.status !== "paid" && latestSettlement.status !== "voided" && (
          <div className="settlement-pipeline-card">
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8, fontSize: "0.78rem" }}>
              <span style={{ color: "var(--muted)", fontWeight: 500 }}>
                {dateOnly(latestSettlement.period_start, session.tenant.config.dateFormat as "DD/MM/YYYY" | "MM/DD/YYYY" | "YYYY-MM-DD")}
                {" – "}
                {dateOnly(latestSettlement.period_end, session.tenant.config.dateFormat as "DD/MM/YYYY" | "MM/DD/YYYY" | "YYYY-MM-DD")}
              </span>
              <span style={{ fontWeight: 600 }}>{money(latestSettlement.net_minor, latestSettlement.currency)}</span>
            </div>
            <SettlementStepper
              settlement={latestSettlement}
              partnerId={partner.id}
              onAdvance={(toStatus) => handlePipelineStep(latestSettlement, toStatus)}
            />
            <div style={{ marginTop: 6, fontSize: "0.72rem", color: "var(--muted)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span>Click the next step to advance → it opens a confirmation dialog.</span>
              {latestSettlement.status === "draft" && (
                <button
                  className="btn-ghost btn-sm"
                  style={{ color: "var(--danger, #c0392b)", fontSize: "0.72rem" }}
                  onClick={() => setDeletingSettlement(latestSettlement)}
                >
                  Delete draft
                </button>
              )}
            </div>
          </div>
        )}

        {/* Transaction register */}
        <h3 className="finance-section-heading" style={{ marginTop: 18 }}>Transaction Register</h3>

        {ledgerError && <Notice error>{ledgerError}</Notice>}
        {!ledger && !ledgerError && <Loading />}
        {ledger?.entries.length === 0 && (
          <Empty title="No transactions">
            {filterCount > 0 ? "Nothing matches this filter." : "Attributed bookings and settlements will appear here."}
          </Empty>
        )}
        {ledger && ledger.entries.length > 0 && (
          <>
            <div className="table-scroll">
              <table className="ledger-table">
                <thead>
                  <tr>
                    <th>Date</th><th>Description</th><th>Status</th>
                    <th className="num" title="Dr — partner owes you">Dr</th>
                    <th className="num" title="Cr — you owe partner">Cr</th>
                    <th className="num">Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {ledger.entries.map((e) => <LedgerEntryRow key={e.id} entry={e} dateFormat={session.tenant.config.dateFormat} />)}
                </tbody>
              </table>
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 12, justifyContent: "center", alignItems: "center" }}>
              <button className="button small secondary" onClick={() => setPage((p) => p - 1)} disabled={page === 1}>← Prev</button>
              <span style={{ fontSize: "0.78rem", color: "var(--muted)" }}>Page {page}</span>
              <button className="button small secondary" onClick={() => setPage((p) => p + 1)} disabled={!ledger.has_more}>Next →</button>
            </div>
          </>
        )}
      </div>

      <GenerateDialog
        partner={partner}
        session={session}
        open={generating}
        onClose={() => setGenerating(false)}
        onGenerated={(s) => { setGenerating(false); setHighlightSettlement(s); refresh(); }}
      />

      <AdvanceDialog
        partnerId={partner.id}
        settlement={advancing?.settlement ?? null}
        open={!!advancing}
        preSelectedStatus={advancing?.status}
        onClose={() => setAdvancing(null)}
        onAdvanced={() => { setAdvancing(null); refresh(); }}
      />

      <MarkPaidDialog
        partnerId={partner.id}
        settlement={markingPaid}
        open={!!markingPaid}
        onClose={() => setMarkingPaid(null)}
        onPaid={() => { setMarkingPaid(null); refresh(); }}
        session={session}
      />
      {deletingSettlement && (
        <FormDialog
          open
          title="Delete Draft Settlement"
          busy={delSmt.busy}
          error={delSmt.error}
          submitLabel="Delete"
          onSubmit={async () => {
            const ok = await delSmt.run(
              `finance/v1/partners/${partner.id}/settlements/${deletingSettlement.id}`,
              undefined, "DELETE",
            );
            if (ok) { delSmt.clear(); setDeletingSettlement(null); refresh(); }
          }}
          onClose={() => { delSmt.clear(); setDeletingSettlement(null); }}
        >
          <p style={{ margin: 0 }}>
            This will delete the draft settlement for{" "}
            <strong>{dateOnly(deletingSettlement.period_start, session.tenant.config.dateFormat as any)} – {dateOnly(deletingSettlement.period_end, session.tenant.config.dateFormat as any)}</strong>{" "}
            and restore all {deletingSettlement.booking_count ?? ""} bookings to unsettled. This cannot be undone.
          </p>
        </FormDialog>
      )}
    </>
  );
}

// ─── Main ────────────────────────────────────────────────────────────────────

export function FinancePartners({ session, initialPartnerId }: { session: Session; initialPartnerId?: string }) {
  const [selectedId, setSelectedId] = useState<string | null>(initialPartnerId ?? null);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorMode, setEditorMode] = useState<"create" | "edit">("create");
  const [editorPartner, setEditorPartner] = useState<Partner | undefined>();
  const [listRev, setListRev] = useState(0);

  const { data: partners, error: partnersError } = useResource<Partner[]>(`finance/v1/partners?_r=${listRev}`);

  const filtered = useMemo(() => {
    if (!partners) return [];
    return partners.filter((p) => {
      const ms = !search || p.name.toLowerCase().includes(search.toLowerCase()) ||
        (p.email ?? "").toLowerCase().includes(search.toLowerCase());
      const mt = !typeFilter || p.partner_type === typeFilter;
      return ms && mt;
    });
  }, [partners, search, typeFilter]);

  const selectedPartner = useMemo(() => partners?.find((p) => p.id === selectedId) ?? null, [partners, selectedId]);
  const fallback = session.tenant.config.settlementCurrency || session.tenant.config.collectionCurrency;

  function openCreate() { setEditorMode("create"); setEditorPartner(undefined); setEditorOpen(true); }
  function openEdit(p: Partner) { setEditorMode("edit"); setEditorPartner(p); setEditorOpen(true); }

  return (
    <div className="finance-split">
      {/* Left panel */}
      <div className="finance-list-panel">
        <div className="finance-panel-toolbar">
          <div className="finance-panel-search" style={{ position: "relative", flex: 1 }}>
            <Search size={14} style={{ position: "absolute", left: 8, top: "50%", transform: "translateY(-50%)", color: "var(--muted)", pointerEvents: "none" }} />
            <input
              style={{ width: "100%", paddingLeft: 28, height: 32, fontSize: "0.82rem", border: "1px solid var(--line)", borderRadius: 6, background: "var(--bg)", boxSizing: "border-box" }}
              placeholder="Search partners…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <button className="button small primary" onClick={openCreate} title="Add partner"><Plus size={14} /></button>
        </div>
        <div style={{ padding: "6px 12px", borderBottom: "1px solid var(--line)" }}>
          <select
            style={{ width: "100%", fontSize: "0.78rem", border: "1px solid var(--line)", borderRadius: 6, padding: "4px 8px", background: "var(--bg)" }}
            value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}
          >
            <option value="">All types</option>
            <option value="ota">OTA</option>
            <option value="reseller">Reseller</option>
            <option value="affiliate">Affiliate</option>
            <option value="wholesale">Wholesale</option>
          </select>
        </div>
        <div className="finance-list-scroll">
          {partnersError && <Notice error>{partnersError}</Notice>}
          {!partners && <Loading />}
          {partners && filtered.length === 0 && (
            <div style={{ padding: "24px 14px", textAlign: "center", color: "var(--muted)", fontSize: "0.82rem" }}>
              {search || typeFilter ? "No partners match your filters." : "No partners yet. Add one to get started."}
            </div>
          )}
          {filtered.map((p) => (
            <div key={p.id} className={`finance-list-item ${selectedId === p.id ? "active" : ""}`}
              onClick={() => setSelectedId(p.id)}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 4 }}>
                <span className="finance-list-item-name" style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {p.name}
                </span>
                <div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
                  {p.partner_type && (
                    <span className="ledger-badge settled" style={{ fontSize: "0.6rem" }}>{label(p.partner_type)}</span>
                  )}
                  <button
                    className="button small secondary icon-only partner-list-edit-btn"
                    title={`Edit ${p.name}`}
                    onClick={(e) => { e.stopPropagation(); setSelectedId(p.id); openEdit(p); }}
                  >
                    <Pencil size={12} />
                  </button>
                </div>
              </div>
              <span className="finance-list-item-meta">{commissionSummary(p, fallback)}</span>
              {p.status === "inactive" && <span style={{ fontSize: "0.68rem", color: "#9ca3af" }}>Inactive</span>}
            </div>
          ))}
        </div>
      </div>

      {/* Right panel */}
      <div className="finance-detail-panel">
        {!selectedPartner ? (
          <>
            <div className="finance-detail-toolbar">
              <div className="finance-detail-toolbar-title" style={{ color: "var(--muted)" }}>
                Select a partner to view their account
              </div>
              <button className="button small primary" onClick={openCreate}><Plus size={14} /> Add Partner</button>
            </div>
            <div className="finance-detail-empty">
              <Landmark size={48} />
              <p>Select a partner from the list to view their transaction register and settlement history.</p>
            </div>
          </>
        ) : (
          <PartnerDetailPanel
            key={selectedPartner.id}
            partner={selectedPartner}
            session={session}
            onEdit={() => openEdit(selectedPartner)}
            onRefresh={() => setListRev((r) => r + 1)}
          />
        )}
      </div>

      <PartnerFormModal open={editorOpen} mode={editorMode} partner={editorPartner}
        session={session} onClose={() => setEditorOpen(false)}
        onSaved={() => { setEditorOpen(false); setListRev((r) => r + 1); }} />
    </div>
  );
}
