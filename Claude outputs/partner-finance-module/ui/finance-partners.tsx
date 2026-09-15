"use client";

/**
 * Finance Partners Tab  —  apps/web/components/finance-partners.tsx
 *
 * Finance module → Partners tab
 * Summary cards + per-partner settlement accordion with workflow actions.
 * Add to the existing finance.tsx tab navigation.
 */

import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { formatMinor } from "@/lib/money";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface FinanceSummary {
  receivable_minor: number;
  receivable_count: number;
  payable_minor: number;
  payable_count: number;
  overdue_count: number;
  overdue_minor: number;
  by_partner: PartnerSummaryRow[];
}

interface PartnerSummaryRow {
  id: string;
  name: string;
  partner_type?: string;
  commission_direction: "partner_owes_tenant" | "tenant_owes_partner";
  currency: string;
  unsettled_count: number;
  gross_minor: number;
  commission_minor: number;
}

interface UnsettledBooking {
  id: string;
  booking_id: string;
  reference: string;
  starts_at: string;
  customer_name?: string;
  gross_amount_minor: number;
  pax_count: number;
  commission_amount_minor: number;
  commission_type: string;
  currency: string;
}

interface Settlement {
  id: string;
  period_start: string;
  period_end: string;
  booking_count: number;
  gross_amount_minor: number;
  commission_amount_minor: number;
  net_amount_minor: number;
  commission_direction: "partner_owes_tenant" | "tenant_owes_partner";
  currency: string;
  status: "draft" | "invoiced" | "sent" | "paid" | "overdue" | "void";
  due_date?: string;
  invoice_number?: string;
  payment_ref?: string;
  paid_at?: string;
  created_at: string;
}

const STATUS_COLORS: Record<Settlement["status"], string> = {
  draft: "bg-gray-100 text-gray-700",
  invoiced: "bg-blue-100 text-blue-800",
  sent: "bg-purple-100 text-purple-800",
  paid: "bg-green-100 text-green-800",
  overdue: "bg-red-100 text-red-800",
  void: "bg-gray-100 text-gray-400 line-through",
};

function fmt(minor: number, currency: string) {
  return formatMinor(minor, currency);
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-XC", { day: "numeric", month: "short", year: "numeric" });
}

function newKey() {
  return crypto.randomUUID();
}

// ─────────────────────────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────────────────────────

export default function FinancePartners() {
  const { data: summary, isLoading } = useQuery<FinanceSummary>({
    queryKey: ["partner-finance-summary"],
    queryFn: () => api.get("/finance/v1/partner-finance-summary").then((r) => r.data),
  });

  if (isLoading) {
    return <div className="py-12 text-center text-sm text-[var(--muted)]">Loading…</div>;
  }

  if (!summary) return null;

  return (
    <div className="space-y-6">
      {/* ── Summary cards ── */}
      <div className="grid grid-cols-3 gap-4">
        <SummaryCard
          label="Receivable from partners"
          amount={summary.receivable_minor}
          currency="XCD"
          count={summary.receivable_count}
          countLabel="unsettled bookings"
          accent="teal"
        />
        <SummaryCard
          label="Payable to partners"
          amount={summary.payable_minor}
          currency="XCD"
          count={summary.payable_count}
          countLabel="unsettled bookings"
          accent="amber"
        />
        <SummaryCard
          label="Overdue settlements"
          amount={summary.overdue_minor}
          currency="XCD"
          count={summary.overdue_count}
          countLabel="settlements past due"
          accent={summary.overdue_count > 0 ? "red" : "gray"}
        />
      </div>

      {/* ── Per-partner accordions ── */}
      {summary.by_partner.length === 0 ? (
        <div className="border border-dashed border-[var(--border)] rounded-xl p-10 text-center">
          <p className="text-sm text-[var(--muted)]">
            No partners with commission configuration yet.
          </p>
          <p className="text-xs text-[var(--muted)] mt-1">
            Configure partners in Settings → Partners & Resellers.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {summary.by_partner.map((p) => (
            <PartnerAccordion key={p.id} row={p} />
          ))}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Summary card
// ─────────────────────────────────────────────────────────────────────────────

function SummaryCard({
  label,
  amount,
  currency,
  count,
  countLabel,
  accent,
}: {
  label: string;
  amount: number;
  currency: string;
  count: number;
  countLabel: string;
  accent: "teal" | "amber" | "red" | "gray";
}) {
  const accentClass = {
    teal: "text-teal-700",
    amber: "text-amber-700",
    red: "text-red-700",
    gray: "text-[var(--muted)]",
  }[accent];

  return (
    <div className="rounded-xl border border-[var(--border)] p-5 bg-[var(--surface)]">
      <p className="text-xs text-[var(--muted)] uppercase tracking-wide">{label}</p>
      <p className={`text-2xl font-bold mt-1 ${accentClass}`}>{fmt(amount, currency)}</p>
      <p className="text-xs text-[var(--muted)] mt-1">
        {count} {countLabel}
      </p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-partner accordion
// ─────────────────────────────────────────────────────────────────────────────

function PartnerAccordion({ row }: { row: PartnerSummaryRow }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="rounded-xl border border-[var(--border)] overflow-hidden">
      {/* Accordion header */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-5 py-4 hover:bg-[var(--surface-raised)] transition-colors"
      >
        <div className="flex items-center gap-3">
          <span className="font-medium">{row.name}</span>
          {row.partner_type && (
            <span className="text-xs px-2 py-0.5 rounded bg-[var(--surface-raised)] text-[var(--muted)] border border-[var(--border)]">
              {row.partner_type}
            </span>
          )}
          {row.commission_direction === "partner_owes_tenant" ? (
            <span className="text-xs px-2 py-0.5 rounded bg-teal-50 text-teal-700 border border-teal-200">→ receives</span>
          ) : (
            <span className="text-xs px-2 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200">→ pays out</span>
          )}
        </div>
        <div className="flex items-center gap-6 text-sm">
          <div className="text-right">
            <span className="text-[var(--muted)] text-xs">Unsettled</span>
            <div className="font-semibold">{fmt(row.commission_minor, row.currency)}</div>
          </div>
          <span className="text-[var(--muted)]">{open ? "▲" : "▼"}</span>
        </div>
      </button>

      {open && <PartnerDetail partnerId={row.id} currency={row.currency} />}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Partner detail panel (loaded on expand)
// ─────────────────────────────────────────────────────────────────────────────

function PartnerDetail({ partnerId, currency }: { partnerId: string; currency: string }) {
  const qc = useQueryClient();
  const [showGenerate, setShowGenerate] = useState(false);
  const [advancingId, setAdvancingId] = useState<string | null>(null);

  const { data: unsettled = [] } = useQuery<UnsettledBooking[]>({
    queryKey: ["partner-unsettled", partnerId],
    queryFn: () => api.get(`/finance/v1/partners/${partnerId}/bookings/unsettled`).then((r) => r.data),
  });

  const { data: settlements = [] } = useQuery<Settlement[]>({
    queryKey: ["partner-settlements", partnerId],
    queryFn: () => api.get(`/finance/v1/partners/${partnerId}/settlements`).then((r) => r.data),
  });

  function refetchAll() {
    qc.invalidateQueries({ queryKey: ["partner-unsettled", partnerId] });
    qc.invalidateQueries({ queryKey: ["partner-settlements", partnerId] });
    qc.invalidateQueries({ queryKey: ["partner-finance-summary"] });
  }

  return (
    <div className="border-t border-[var(--border)] bg-[var(--surface-raised)]">
      {/* Unsettled bookings */}
      <div className="p-5">
        <div className="flex items-center justify-between mb-3">
          <h4 className="text-sm font-medium">Unsettled bookings ({unsettled.length})</h4>
          {unsettled.length > 0 && (
            <button
              onClick={() => setShowGenerate(true)}
              className="px-3 py-1.5 text-xs rounded-lg bg-[var(--accent)] text-white font-medium hover:opacity-90"
            >
              Generate settlement
            </button>
          )}
        </div>

        {unsettled.length === 0 ? (
          <p className="text-xs text-[var(--muted)]">No unsettled bookings.</p>
        ) : (
          <div className="rounded-lg border border-[var(--border)] overflow-hidden bg-[var(--surface)]">
            <table className="w-full text-xs">
              <thead className="bg-[var(--surface-raised)] text-[var(--muted)] uppercase tracking-wide">
                <tr>
                  <th className="px-3 py-2 text-left">Booking</th>
                  <th className="px-3 py-2 text-left">Date</th>
                  <th className="px-3 py-2 text-left">Customer</th>
                  <th className="px-3 py-2 text-right">Gross</th>
                  <th className="px-3 py-2 text-right">Commission</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {unsettled.map((b) => (
                  <tr key={b.id} className="hover:bg-[var(--surface-raised)]">
                    <td className="px-3 py-2 font-mono">{b.reference}</td>
                    <td className="px-3 py-2 text-[var(--muted)]">{fmtDate(b.starts_at)}</td>
                    <td className="px-3 py-2 text-[var(--muted)]">{b.customer_name ?? "—"}</td>
                    <td className="px-3 py-2 text-right">{fmt(b.gross_amount_minor, b.currency)}</td>
                    <td className="px-3 py-2 text-right font-medium">{fmt(b.commission_amount_minor, b.currency)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t border-[var(--border)] bg-[var(--surface-raised)]">
                <tr>
                  <td colSpan={3} className="px-3 py-2 text-[var(--muted)]">Total ({unsettled.length} bookings)</td>
                  <td className="px-3 py-2 text-right font-medium">
                    {fmt(unsettled.reduce((s, b) => s + b.gross_amount_minor, 0), currency)}
                  </td>
                  <td className="px-3 py-2 text-right font-semibold text-[var(--accent)]">
                    {fmt(unsettled.reduce((s, b) => s + b.commission_amount_minor, 0), currency)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      {/* Settlement history */}
      <div className="px-5 pb-5">
        <h4 className="text-sm font-medium mb-3">Settlement history</h4>
        {settlements.length === 0 ? (
          <p className="text-xs text-[var(--muted)]">No settlements yet.</p>
        ) : (
          <div className="space-y-2">
            {settlements.map((s) => (
              <SettlementRow
                key={s.id}
                settlement={s}
                partnerId={partnerId}
                onAdvanced={refetchAll}
                onExpandAdvance={(id) => setAdvancingId(id === advancingId ? null : id)}
                isAdvancing={advancingId === s.id}
              />
            ))}
          </div>
        )}
      </div>

      {/* Generate settlement modal */}
      {showGenerate && (
        <GenerateSettlementModal
          partnerId={partnerId}
          onClose={() => setShowGenerate(false)}
          onGenerated={() => {
            refetchAll();
            setShowGenerate(false);
          }}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Settlement row with inline advance controls
// ─────────────────────────────────────────────────────────────────────────────

function SettlementRow({
  settlement,
  partnerId,
  onAdvanced,
  onExpandAdvance,
  isAdvancing,
}: {
  settlement: Settlement;
  partnerId: string;
  onAdvanced: () => void;
  onExpandAdvance: (id: string) => void;
  isAdvancing: boolean;
}) {
  const s = settlement;
  const isVoidOrPaid = s.status === "paid" || s.status === "void";

  const NEXT_STATUS: Record<Settlement["status"], Settlement["status"] | null> = {
    draft: "invoiced",
    invoiced: "sent",
    sent: "paid",
    overdue: "paid",
    paid: null,
    void: null,
  };

  const nextStatus = NEXT_STATUS[s.status];

  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] overflow-hidden">
      <div className="flex items-center gap-4 px-4 py-3 text-sm">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium">
              {fmtDate(s.period_start)} – {fmtDate(s.period_end)}
            </span>
            <span className={`px-2 py-0.5 rounded text-xs font-medium ${STATUS_COLORS[s.status]}`}>
              {s.status}
            </span>
          </div>
          <div className="text-xs text-[var(--muted)] mt-0.5">
            {s.booking_count} bookings
            {s.invoice_number && ` · Invoice ${s.invoice_number}`}
            {s.due_date && ` · Due ${fmtDate(s.due_date)}`}
            {s.paid_at && ` · Paid ${fmtDate(s.paid_at)}`}
          </div>
        </div>
        <div className="text-right">
          <div className="font-semibold">{fmt(s.commission_amount_minor, s.currency)}</div>
          <div className="text-xs text-[var(--muted)]">commission</div>
        </div>
        {!isVoidOrPaid && nextStatus && (
          <button
            onClick={() => onExpandAdvance(s.id)}
            className="px-3 py-1.5 text-xs rounded-lg border border-[var(--border)] hover:bg-[var(--surface-raised)] whitespace-nowrap"
          >
            Mark {nextStatus}
          </button>
        )}
      </div>

      {isAdvancing && nextStatus && (
        <AdvanceForm
          partnerId={partnerId}
          settlementId={s.id}
          newStatus={nextStatus}
          onDone={onAdvanced}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Advance settlement status form (inline)
// ─────────────────────────────────────────────────────────────────────────────

function AdvanceForm({
  partnerId,
  settlementId,
  newStatus,
  onDone,
}: {
  partnerId: string;
  settlementId: string;
  newStatus: Settlement["status"];
  onDone: () => void;
}) {
  const [paymentRef, setPaymentRef] = useState("");
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api.patch(
        `/finance/v1/partners/${partnerId}/settlements/${settlementId}`,
        {
          status: newStatus,
          payment_ref: paymentRef || undefined,
          invoice_number: invoiceNumber || undefined,
          notes: notes || undefined,
        },
        { headers: { "idempotency-key": newKey() } }
      );
      onDone();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? "Update failed.";
      setError(msg);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="border-t border-[var(--border)] bg-[var(--surface-raised)] px-4 py-3 space-y-3">
      <div className="flex items-center gap-3">
        {newStatus === "paid" && (
          <>
            <div className="flex-1">
              <label className="block text-xs text-[var(--muted)] mb-1">Payment reference</label>
              <input
                value={paymentRef}
                onChange={(e) => setPaymentRef(e.target.value)}
                className="form-input text-sm"
                placeholder="Bank ref, Stripe payout ID…"
              />
            </div>
          </>
        )}
        {newStatus === "invoiced" && (
          <div className="flex-1">
            <label className="block text-xs text-[var(--muted)] mb-1">Invoice number</label>
            <input
              value={invoiceNumber}
              onChange={(e) => setInvoiceNumber(e.target.value)}
              className="form-input text-sm"
              placeholder="INV-0001"
            />
          </div>
        )}
        <div className="flex-1">
          <label className="block text-xs text-[var(--muted)] mb-1">Notes (optional)</label>
          <input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="form-input text-sm"
          />
        </div>
        <button
          type="submit"
          disabled={saving}
          className="px-4 py-2 text-sm rounded-lg bg-[var(--accent)] text-white font-medium hover:opacity-90 disabled:opacity-50 self-end"
        >
          {saving ? "Saving…" : `Confirm ${newStatus}`}
        </button>
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </form>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Generate settlement modal
// ─────────────────────────────────────────────────────────────────────────────

function GenerateSettlementModal({
  partnerId,
  onClose,
  onGenerated,
}: {
  partnerId: string;
  onClose: () => void;
  onGenerated: () => void;
}) {
  // Default: last full month
  const today = new Date();
  const firstOfThisMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  const lastOfLastMonth = new Date(firstOfThisMonth.getTime() - 86400000);
  const firstOfLastMonth = new Date(lastOfLastMonth.getFullYear(), lastOfLastMonth.getMonth(), 1);

  const [periodStart, setPeriodStart] = useState(firstOfLastMonth.toISOString().slice(0, 10));
  const [periodEnd, setPeriodEnd] = useState(lastOfLastMonth.toISOString().slice(0, 10));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleGenerate(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api.post(
        `/finance/v1/partners/${partnerId}/settlements`,
        { period_start: periodStart, period_end: periodEnd },
        { headers: { "idempotency-key": newKey() } }
      );
      onGenerated();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? "Generation failed.";
      setError(msg);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-[var(--surface)] rounded-2xl shadow-2xl w-full max-w-md mx-4">
        <form onSubmit={handleGenerate}>
          <div className="p-6 border-b border-[var(--border)] flex items-center justify-between">
            <h3 className="font-semibold">Generate settlement</h3>
            <button type="button" onClick={onClose} className="text-[var(--muted)] hover:text-[var(--fg)]">✕</button>
          </div>
          <div className="p-6 space-y-4">
            <p className="text-sm text-[var(--muted)]">
              All unsettled bookings with a start date in the selected period will be included in the settlement.
            </p>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1">Period start</label>
                <input
                  type="date"
                  required
                  value={periodStart}
                  onChange={(e) => setPeriodStart(e.target.value)}
                  className="form-input"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Period end</label>
                <input
                  type="date"
                  required
                  value={periodEnd}
                  min={periodStart}
                  onChange={(e) => setPeriodEnd(e.target.value)}
                  className="form-input"
                />
              </div>
            </div>
            {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}
          </div>
          <div className="px-6 py-4 border-t border-[var(--border)] flex justify-end gap-3">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm rounded-lg border border-[var(--border)] hover:bg-[var(--surface-raised)]">Cancel</button>
            <button
              type="submit"
              disabled={saving}
              className="px-5 py-2 text-sm rounded-lg bg-[var(--accent)] text-white font-medium hover:opacity-90 disabled:opacity-50"
            >
              {saving ? "Generating…" : "Generate"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
