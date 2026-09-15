"use client";

/**
 * Partner Settings Tab  —  apps/web/components/partner-settings.tsx
 *
 * Tenant Settings → Partners
 * Lists partners with commission summary, handles add/edit with the full
 * commission configuration form. Add/archive only — no hard delete.
 */

import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { formatMinor } from "@/lib/money";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

type PartnerType = "ota" | "reseller" | "affiliate" | "wholesale";
type CommissionType = "percentage" | "flat_per_booking" | "flat_per_pax" | "net_rate";
type CommissionDirection = "partner_owes_tenant" | "tenant_owes_partner";
type SettlementSchedule = "monthly" | "biweekly" | "per_booking" | "custom" | "manual";

interface Partner {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  notes?: string;
  status: "active" | "inactive";
  partner_type?: PartnerType;
  commission_type?: CommissionType;
  commission_rate?: number;
  commission_amount_minor?: number;
  commission_direction?: CommissionDirection;
  commission_currency: string;
  settlement_schedule: SettlementSchedule;
  settlement_day?: number;
  payment_terms_days: number;
  requires_formal_invoice: boolean;
  contract_ref?: string;
}

interface CommissionForm {
  partner_type: PartnerType | "";
  commission_type: CommissionType | "";
  commission_rate: string;
  commission_amount_minor: string;
  commission_direction: CommissionDirection | "";
  commission_currency: string;
  settlement_schedule: SettlementSchedule;
  settlement_day: string;
  payment_terms_days: string;
  requires_formal_invoice: boolean;
  contract_ref: string;
}

const EMPTY_COMMISSION: CommissionForm = {
  partner_type: "",
  commission_type: "",
  commission_rate: "",
  commission_amount_minor: "",
  commission_direction: "",
  commission_currency: "XCD",
  settlement_schedule: "manual",
  settlement_day: "",
  payment_terms_days: "30",
  requires_formal_invoice: false,
  contract_ref: "",
};

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const TYPE_LABELS: Record<PartnerType, string> = {
  ota: "OTA / Platform",
  reseller: "Reseller",
  affiliate: "Affiliate",
  wholesale: "Wholesale",
};

const TYPE_COLORS: Record<PartnerType, string> = {
  ota: "bg-blue-100 text-blue-800",
  reseller: "bg-purple-100 text-purple-800",
  affiliate: "bg-amber-100 text-amber-800",
  wholesale: "bg-teal-100 text-teal-800",
};

function commissionSummary(p: Partner): string {
  if (!p.commission_type || !p.commission_direction) return "Not configured";
  const direction = p.commission_direction === "partner_owes_tenant"
    ? "→ you receive net"
    : "→ you pay commission";

  switch (p.commission_type) {
    case "percentage":
      return `${((p.commission_rate ?? 0) * 100).toFixed(1)}% ${direction}`;
    case "flat_per_booking":
      return `${formatMinor(p.commission_amount_minor ?? 0, p.commission_currency)}/booking ${direction}`;
    case "flat_per_pax":
      return `${formatMinor(p.commission_amount_minor ?? 0, p.commission_currency)}/pax ${direction}`;
    case "net_rate":
      return `Net rate ${direction}`;
  }
}

function scheduleLabel(p: Partner): string {
  if (!p.commission_type) return "—";
  const labels: Record<SettlementSchedule, string> = {
    monthly: `Monthly (day ${p.settlement_day ?? "?"})`,
    biweekly: "Bi-weekly",
    per_booking: "Per booking",
    custom: "Custom",
    manual: "Manual",
  };
  return labels[p.settlement_schedule] ?? "Manual";
}

function newIdempotencyKey() {
  return crypto.randomUUID();
}

// ─────────────────────────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────────────────────────

export default function PartnerSettings() {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Partner | null>(null);

  const { data: partners = [], isLoading } = useQuery<Partner[]>({
    queryKey: ["partners"],
    queryFn: () => api.get("/finance/v1/partners").then((r) => r.data),
  });

  function openAdd() {
    setEditing(null);
    setShowForm(true);
  }

  function openEdit(p: Partner) {
    setEditing(p);
    setShowForm(true);
  }

  function closeForm() {
    setShowForm(false);
    setEditing(null);
  }

  if (isLoading) {
    return (
      <div className="py-12 text-center text-sm text-[var(--muted)]">
        Loading partners…
      </div>
    );
  }

  const active = partners.filter((p) => p.status === "active");
  const inactive = partners.filter((p) => p.status === "inactive");

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Partners & Resellers</h2>
          <p className="text-sm text-[var(--muted)] mt-0.5">
            Configure commission structures and settlement schedules for OTAs, resellers and affiliates.
          </p>
        </div>
        <button
          onClick={openAdd}
          className="px-4 py-2 rounded-lg bg-[var(--accent)] text-white text-sm font-medium hover:opacity-90"
        >
          Add partner
        </button>
      </div>

      {/* Partner list */}
      {active.length === 0 && (
        <div className="border border-dashed border-[var(--border)] rounded-xl p-10 text-center">
          <p className="text-sm text-[var(--muted)]">No active partners yet.</p>
          <button onClick={openAdd} className="mt-3 text-sm text-[var(--accent)] hover:underline">
            Add your first partner →
          </button>
        </div>
      )}

      {active.length > 0 && (
        <div className="rounded-xl border border-[var(--border)] overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-[var(--surface-raised)] text-xs text-[var(--muted)] uppercase tracking-wide">
              <tr>
                <th className="px-4 py-3 text-left">Partner</th>
                <th className="px-4 py-3 text-left">Commission</th>
                <th className="px-4 py-3 text-left">Settlement</th>
                <th className="px-4 py-3 text-left">Invoice</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {active.map((p) => (
                <PartnerRow key={p.id} partner={p} onEdit={() => openEdit(p)} onRefetch={() => qc.invalidateQueries({ queryKey: ["partners"] })} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Archived partners */}
      {inactive.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-[var(--muted)] hover:text-[var(--fg)] select-none">
            Archived ({inactive.length})
          </summary>
          <div className="mt-2 rounded-xl border border-[var(--border)] overflow-hidden">
            <table className="w-full text-sm">
              <tbody className="divide-y divide-[var(--border)] opacity-60">
                {inactive.map((p) => (
                  <PartnerRow key={p.id} partner={p} onEdit={() => openEdit(p)} onRefetch={() => qc.invalidateQueries({ queryKey: ["partners"] })} />
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}

      {/* Add / edit form */}
      {showForm && (
        <PartnerFormModal
          partner={editing}
          onClose={closeForm}
          onSaved={() => {
            qc.invalidateQueries({ queryKey: ["partners"] });
            closeForm();
          }}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Partner row
// ─────────────────────────────────────────────────────────────────────────────

function PartnerRow({
  partner,
  onEdit,
  onRefetch,
}: {
  partner: Partner;
  onEdit: () => void;
  onRefetch: () => void;
}) {
  const [toggling, setToggling] = useState(false);

  async function toggleStatus() {
    setToggling(true);
    try {
      await api.post(`/finance/v1/partners/${partner.id}/status`, {
        status: partner.status === "active" ? "inactive" : "active",
      }, { headers: { "idempotency-key": newIdempotencyKey() } });
      onRefetch();
    } finally {
      setToggling(false);
    }
  }

  return (
    <tr className="hover:bg-[var(--surface-raised)] transition-colors">
      <td className="px-4 py-3">
        <div className="font-medium">{partner.name}</div>
        {partner.partner_type && (
          <span className={`mt-0.5 inline-block px-2 py-0.5 rounded text-xs font-medium ${TYPE_COLORS[partner.partner_type]}`}>
            {TYPE_LABELS[partner.partner_type]}
          </span>
        )}
        {partner.email && (
          <div className="text-xs text-[var(--muted)] mt-0.5">{partner.email}</div>
        )}
      </td>
      <td className="px-4 py-3 text-[var(--muted)]">{commissionSummary(partner)}</td>
      <td className="px-4 py-3 text-[var(--muted)]">{scheduleLabel(partner)}</td>
      <td className="px-4 py-3">
        {partner.requires_formal_invoice ? (
          <span className="text-xs px-2 py-0.5 rounded bg-amber-100 text-amber-800">Required</span>
        ) : (
          <span className="text-xs text-[var(--muted)]">—</span>
        )}
      </td>
      <td className="px-4 py-3 text-right space-x-3">
        <button
          onClick={onEdit}
          className="text-[var(--accent)] text-xs hover:underline"
        >
          Edit
        </button>
        <button
          onClick={toggleStatus}
          disabled={toggling}
          className="text-xs text-[var(--muted)] hover:text-[var(--fg)] disabled:opacity-50"
        >
          {partner.status === "active" ? "Archive" : "Restore"}
        </button>
      </td>
    </tr>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Add / Edit modal
// ─────────────────────────────────────────────────────────────────────────────

function PartnerFormModal({
  partner,
  onClose,
  onSaved,
}: {
  partner: Partner | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = !!partner;

  const [name, setName] = useState(partner?.name ?? "");
  const [email, setEmail] = useState(partner?.email ?? "");
  const [phone, setPhone] = useState(partner?.phone ?? "");
  const [notes, setNotes] = useState(partner?.notes ?? "");

  const [commission, setCommission] = useState<CommissionForm>({
    partner_type: (partner?.partner_type ?? "") as PartnerType | "",
    commission_type: (partner?.commission_type ?? "") as CommissionType | "",
    commission_rate: partner?.commission_rate != null ? String(partner.commission_rate * 100) : "",
    commission_amount_minor: partner?.commission_amount_minor != null ? String(partner.commission_amount_minor) : "",
    commission_direction: (partner?.commission_direction ?? "") as CommissionDirection | "",
    commission_currency: partner?.commission_currency ?? "XCD",
    settlement_schedule: partner?.settlement_schedule ?? "manual",
    settlement_day: partner?.settlement_day != null ? String(partner.settlement_day) : "",
    payment_terms_days: String(partner?.payment_terms_days ?? 30),
    requires_formal_invoice: partner?.requires_formal_invoice ?? false,
    contract_ref: partner?.contract_ref ?? "",
  });

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function updateC<K extends keyof CommissionForm>(key: K, val: CommissionForm[K]) {
    setCommission((prev) => ({ ...prev, [key]: val }));
  }

  const showRate = commission.commission_type === "percentage";
  const showAmount = commission.commission_type === "flat_per_booking" || commission.commission_type === "flat_per_pax";
  const showSettlementDay = commission.settlement_schedule === "monthly";

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const key = newIdempotencyKey();

      // 1. Create or update core partner info
      if (isEdit) {
        await api.put(`/finance/v1/partners/${partner!.id}`, { name, email: email || undefined, phone: phone || undefined, notes }, { headers: { "idempotency-key": key } });
      } else {
        const { data: created } = await api.post("/finance/v1/partners", { name, email: email || undefined, phone: phone || undefined, notes }, { headers: { "idempotency-key": key } });
        partner = created; // carry forward the id
      }

      // 2. Save commission config if type selected
      if (commission.commission_type && commission.commission_direction) {
        const commKey = newIdempotencyKey();
        await api.patch(`/finance/v1/partners/${partner!.id}/commission`, {
          partner_type: commission.partner_type || undefined,
          commission_type: commission.commission_type,
          commission_rate: showRate ? Number(commission.commission_rate) / 100 : undefined,
          commission_amount_minor: showAmount ? Number(commission.commission_amount_minor) : undefined,
          commission_direction: commission.commission_direction,
          commission_currency: commission.commission_currency,
          settlement_schedule: commission.settlement_schedule,
          settlement_day: showSettlementDay ? Number(commission.settlement_day) || undefined : undefined,
          payment_terms_days: Number(commission.payment_terms_days) || 30,
          requires_formal_invoice: commission.requires_formal_invoice,
          contract_ref: commission.contract_ref || undefined,
        }, { headers: { "idempotency-key": commKey } });
      }

      onSaved();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? "Save failed. Please try again.";
      setError(msg);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-[var(--surface)] rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto mx-4">
        <form onSubmit={handleSave}>
          <div className="p-6 border-b border-[var(--border)] flex items-center justify-between">
            <h3 className="font-semibold text-base">{isEdit ? "Edit partner" : "Add partner"}</h3>
            <button type="button" onClick={onClose} className="text-[var(--muted)] hover:text-[var(--fg)]">✕</button>
          </div>

          <div className="p-6 space-y-6">
            {/* ── Basic info ── */}
            <section className="space-y-4">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">Partner details</h4>
              <Field label="Name *">
                <input
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="form-input"
                  placeholder="Viator, Rock Adventures Hotel, etc."
                />
              </Field>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Email">
                  <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="form-input" />
                </Field>
                <Field label="Phone">
                  <input value={phone} onChange={(e) => setPhone(e.target.value)} className="form-input" />
                </Field>
              </div>
              <Field label="Internal notes">
                <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="form-input" />
              </Field>
            </section>

            {/* ── Commission structure ── */}
            <section className="space-y-4 pt-2 border-t border-[var(--border)]">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">Commission structure</h4>

              <div className="grid grid-cols-2 gap-4">
                <Field label="Partner type">
                  <select value={commission.partner_type} onChange={(e) => updateC("partner_type", e.target.value as PartnerType | "")} className="form-input">
                    <option value="">Select type</option>
                    <option value="ota">OTA / Platform</option>
                    <option value="reseller">Reseller</option>
                    <option value="affiliate">Affiliate</option>
                    <option value="wholesale">Wholesale</option>
                  </select>
                </Field>
                <Field label="Commission type">
                  <select value={commission.commission_type} onChange={(e) => updateC("commission_type", e.target.value as CommissionType | "")} className="form-input">
                    <option value="">Select type</option>
                    <option value="percentage">Percentage of booking</option>
                    <option value="flat_per_booking">Flat per booking</option>
                    <option value="flat_per_pax">Flat per passenger</option>
                    <option value="net_rate">Net rate (no commission)</option>
                  </select>
                </Field>
              </div>

              {showRate && (
                <Field label="Commission rate (%)">
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="0.1"
                    value={commission.commission_rate}
                    onChange={(e) => updateC("commission_rate", e.target.value)}
                    className="form-input"
                    placeholder="e.g. 20 for 20%"
                  />
                </Field>
              )}

              {showAmount && (
                <Field label={`Commission amount (${commission.commission_currency} minor units)`}>
                  <input
                    type="number"
                    min="0"
                    value={commission.commission_amount_minor}
                    onChange={(e) => updateC("commission_amount_minor", e.target.value)}
                    className="form-input"
                    placeholder="e.g. 500 = $5.00"
                  />
                  <p className="text-xs text-[var(--muted)] mt-1">
                    Enter cents/minor units. 500 = {commission.commission_currency} 5.00
                  </p>
                </Field>
              )}

              {commission.commission_type && (
                <Field label="Money direction">
                  <div className="grid grid-cols-2 gap-3">
                    <DirectionCard
                      selected={commission.commission_direction === "partner_owes_tenant"}
                      onClick={() => updateC("commission_direction", "partner_owes_tenant")}
                      title="Partner pays us net"
                      description="OTA / wholesale — partner collects and remits net to you"
                    />
                    <DirectionCard
                      selected={commission.commission_direction === "tenant_owes_partner"}
                      onClick={() => updateC("commission_direction", "tenant_owes_partner")}
                      title="We pay partner commission"
                      description="Referral / agency — you owe a commission fee to the partner"
                    />
                  </div>
                </Field>
              )}

              <div className="grid grid-cols-2 gap-4">
                <Field label="Currency">
                  <input
                    value={commission.commission_currency}
                    onChange={(e) => updateC("commission_currency", e.target.value.toUpperCase().slice(0, 3))}
                    className="form-input uppercase"
                    maxLength={3}
                  />
                </Field>
              </div>
            </section>

            {/* ── Settlement schedule ── */}
            <section className="space-y-4 pt-2 border-t border-[var(--border)]">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">Settlement schedule</h4>

              <div className="grid grid-cols-2 gap-4">
                <Field label="Schedule">
                  <select value={commission.settlement_schedule} onChange={(e) => updateC("settlement_schedule", e.target.value as SettlementSchedule)} className="form-input">
                    <option value="manual">Manual (generate on demand)</option>
                    <option value="monthly">Monthly</option>
                    <option value="biweekly">Bi-weekly</option>
                    <option value="per_booking">Per booking</option>
                    <option value="custom">Custom</option>
                  </select>
                </Field>

                {showSettlementDay && (
                  <Field label="Day of month (1–28)">
                    <input
                      type="number"
                      min="1"
                      max="28"
                      value={commission.settlement_day}
                      onChange={(e) => updateC("settlement_day", e.target.value)}
                      className="form-input"
                    />
                  </Field>
                )}

                <Field label="Payment terms (days)">
                  <input
                    type="number"
                    min="0"
                    max="365"
                    value={commission.payment_terms_days}
                    onChange={(e) => updateC("payment_terms_days", e.target.value)}
                    className="form-input"
                    placeholder="30"
                  />
                </Field>
              </div>

              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={commission.requires_formal_invoice}
                  onChange={(e) => updateC("requires_formal_invoice", e.target.checked)}
                  className="rounded border-[var(--border)] text-[var(--accent)]"
                />
                <span className="text-sm">Requires formal invoice document</span>
              </label>

              <Field label="Contract reference">
                <input
                  value={commission.contract_ref}
                  onChange={(e) => updateC("contract_ref", e.target.value)}
                  className="form-input"
                  placeholder="Contract #, agreement ID, etc."
                />
              </Field>
            </section>

            {error && (
              <p className="text-sm text-red-600 bg-red-50 rounded-lg px-4 py-2">{error}</p>
            )}
          </div>

          <div className="px-6 py-4 border-t border-[var(--border)] flex justify-end gap-3">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm rounded-lg border border-[var(--border)] hover:bg-[var(--surface-raised)]">
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-5 py-2 text-sm rounded-lg bg-[var(--accent)] text-white font-medium hover:opacity-90 disabled:opacity-50"
            >
              {saving ? "Saving…" : isEdit ? "Save changes" : "Add partner"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Small helpers
// ─────────────────────────────────────────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="block text-sm font-medium">{label}</label>
      {children}
    </div>
  );
}

function DirectionCard({
  selected,
  onClick,
  title,
  description,
}: {
  selected: boolean;
  onClick: () => void;
  title: string;
  description: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-left p-3 rounded-lg border-2 transition-colors ${
        selected
          ? "border-[var(--accent)] bg-[var(--accent)]/5"
          : "border-[var(--border)] hover:border-[var(--accent)]/50"
      }`}
    >
      <div className="text-sm font-medium">{title}</div>
      <div className="text-xs text-[var(--muted)] mt-0.5">{description}</div>
    </button>
  );
}
