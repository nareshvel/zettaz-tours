"use client";

import { useState } from "react";
import { Archive, Handshake, Pencil, Plus, RotateCcw } from "lucide-react";
import type { Session } from "@/lib/types";
import { label, money, useMutation, useResource } from "@/lib/client";
import {
  ConfirmDialog,
  Empty,
  Field,
  FormDialog,
  Loading,
  Notice,
  Status,
  Toggle,
} from "./common";

type Partner = {
  id: string;
  name: string;
  email?: string | null;
  phone?: string | null;
  status: "active" | "inactive";
  notes: string;
  partner_type?: "ota" | "reseller" | "affiliate" | "wholesale" | null;
  commission_type?:
    "percentage" | "flat_per_booking" | "flat_per_pax" | "net_rate" | null;
  commission_rate?: number | string | null;
  commission_amount_minor?: number | string | null;
  commission_direction?: "partner_owes_tenant" | "tenant_owes_partner" | null;
  commission_currency?: string | null;
  settlement_schedule?:
    "monthly" | "biweekly" | "per_booking" | "custom" | "manual" | null;
  settlement_day?: number | null;
  payment_terms_days?: number | null;
  requires_formal_invoice?: boolean | null;
  contract_ref?: string | null;
};

/** ISO weekday order — index + 1 matches settlement_day (1 = Monday). */
const WEEKDAYS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];

/** Schedules that pin settlement to a particular day. */
const DAY_SCHEDULES = ["monthly", "weekly", "biweekly"];

const emptyForm = {
  name: "",
  email: "",
  phone: "",
  notes: "",
  partnerType: "",
  commissionType: "",
  commissionRate: "",
  commissionAmount: "",
  commissionDirection: "partner_owes_tenant",
  commissionCurrency: "",
  settlementSchedule: "manual",
  settlementDay: "",
  paymentTermsDays: "30",
  requiresFormalInvoice: false,
  contractRef: "",
};

type PartnerForm = typeof emptyForm;

function numeric(value: number | string | null | undefined) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** One-line commission summary for the list row. */
function commissionSummary(partner: Partner, fallbackCurrency: string) {
  if (!partner.commission_type) return "Commission not configured";
  const currency = partner.commission_currency || fallbackCurrency;
  const rate = numeric(partner.commission_rate);
  const amount = numeric(partner.commission_amount_minor);
  const terms =
    partner.commission_type === "percentage" && rate !== null
      ? `${(rate * 100).toFixed((rate * 100) % 1 === 0 ? 0 : 1)}% of gross`
      : partner.commission_type === "flat_per_booking" && amount !== null
        ? `${money(amount, currency)} per booking`
        : partner.commission_type === "flat_per_pax" && amount !== null
          ? `${money(amount, currency)} per guest`
          : label(partner.commission_type);
  const direction =
    partner.commission_direction === "partner_owes_tenant"
      ? "partner pays us"
      : "we pay partner";
  const schedule = partner.settlement_schedule
    ? `${label(partner.settlement_schedule)} settlement`
    : null;
  return [terms, direction, schedule].filter(Boolean).join(" · ");
}

function formFromPartner(
  partner: Partner | undefined,
  fallbackCurrency: string,
): PartnerForm {
  if (!partner) return { ...emptyForm, commissionCurrency: fallbackCurrency };
  const rate = numeric(partner.commission_rate);
  const amount = numeric(partner.commission_amount_minor);
  return {
    name: partner.name,
    email: partner.email ?? "",
    phone: partner.phone ?? "",
    notes: partner.notes ?? "",
    partnerType: partner.partner_type ?? "",
    commissionType: partner.commission_type ?? "",
    commissionRate: rate !== null ? String(rate * 100) : "",
    commissionAmount: amount !== null ? String(amount / 100) : "",
    commissionDirection: partner.commission_direction ?? "partner_owes_tenant",
    commissionCurrency: partner.commission_currency || fallbackCurrency,
    settlementSchedule: partner.settlement_schedule ?? "manual",
    settlementDay:
      partner.settlement_day !== null && partner.settlement_day !== undefined
        ? String(partner.settlement_day)
        : "",
    paymentTermsDays: String(partner.payment_terms_days ?? 30),
    requiresFormalInvoice: partner.requires_formal_invoice ?? false,
    contractRef: partner.contract_ref ?? "",
  };
}

export function PartnerSettings({ session }: { session: Session }) {
  const fallbackCurrency =
    session.tenant.config.settlementCurrency ||
    session.tenant.config.collectionCurrency;
  const partners = useResource<Partner[]>("finance/v1/partners");
  const partnerMutation = useMutation();
  const statusMutation = useMutation();
  const [form, setForm] = useState<PartnerForm>(emptyForm);
  const [editor, setEditor] = useState<
    null | { mode: "create" } | { mode: "edit"; partner: Partner }
  >(null);
  const [pendingStatus, setPendingStatus] = useState<Partner | null>(null);

  const set = <K extends keyof PartnerForm>(key: K, value: PartnerForm[K]) =>
    setForm((v) => ({ ...v, [key]: value }));

  function openCreate() {
    setForm({ ...emptyForm, commissionCurrency: fallbackCurrency });
    setEditor({ mode: "create" });
    partnerMutation.clear();
  }

  function openEdit(partner: Partner) {
    setForm(formFromPartner(partner, fallbackCurrency));
    setEditor({ mode: "edit", partner });
    partnerMutation.clear();
  }

  function commissionPayload() {
    const payload: Record<string, unknown> = {
      commission_type: form.commissionType,
      commission_direction: form.commissionDirection,
      commission_currency: form.commissionCurrency || fallbackCurrency,
      settlement_schedule: form.settlementSchedule || "manual",
      payment_terms_days: Number(form.paymentTermsDays) || 30,
      requires_formal_invoice: form.requiresFormalInvoice,
    };
    if (form.partnerType) payload.partner_type = form.partnerType;
    if (form.commissionType === "percentage" && form.commissionRate)
      payload.commission_rate = Number(form.commissionRate) / 100;
    if (
      (form.commissionType === "flat_per_booking" ||
        form.commissionType === "flat_per_pax") &&
      form.commissionAmount
    )
      payload.commission_amount_minor = Math.round(
        Number(form.commissionAmount) * 100,
      );
    if (DAY_SCHEDULES.includes(form.settlementSchedule) && form.settlementDay)
      payload.settlement_day = Number(form.settlementDay);
    if (form.contractRef) payload.contract_ref = form.contractRef;
    return payload;
  }

  async function submitPartner() {
    if (!editor) return;
    let partnerId =
      editor.mode === "edit" ? editor.partner.id : (null as string | null);

    if (editor.mode === "create") {
      const created = await partnerMutation.run<Partner>(
        "finance/v1/partners",
        {
          name: form.name,
          email: form.email || undefined,
          phone: form.phone || undefined,
          notes: form.notes,
        },
      );
      if (!created) return;
      partnerId = created.id;
    } else {
      // Only send identity fields that actually changed.
      const before = editor.partner;
      const changes: Record<string, unknown> = {};
      if (form.name.trim() !== before.name) changes.name = form.name.trim();
      if (form.email.trim() !== (before.email ?? ""))
        changes.email = form.email.trim() || null;
      if (form.phone.trim() !== (before.phone ?? ""))
        changes.phone = form.phone.trim() || null;
      if (form.notes.trim() !== (before.notes ?? ""))
        changes.notes = form.notes.trim();
      if (Object.keys(changes).length) {
        const updated = await partnerMutation.run(
          `finance/v1/partners/${partnerId}`,
          changes,
          "PATCH",
        );
        if (!updated) return;
      }
    }

    if (form.commissionType && partnerId) {
      const saved = await partnerMutation.run(
        `finance/v1/partners/${partnerId}/commission`,
        commissionPayload(),
        "PATCH",
      );
      if (!saved) return;
    }

    setEditor(null);
    setForm(emptyForm);
    partners.reload();
  }

  async function confirmStatusChange() {
    if (!pendingStatus) return;
    const next = pendingStatus.status === "active" ? "inactive" : "active";
    const result = await statusMutation.run(
      `finance/v1/partners/${pendingStatus.id}/status`,
      { status: next },
    );
    if (result) {
      setPendingStatus(null);
      partners.reload();
    }
  }

  const isEdit = editor?.mode === "edit";
  const showRate = form.commissionType === "percentage";
  const showAmount =
    form.commissionType === "flat_per_booking" ||
    form.commissionType === "flat_per_pax";
  const showDay = DAY_SCHEDULES.includes(form.settlementSchedule);

  return (
    <section>
      <div className="settings-card-head">
        <Handshake size={20} />
        <div>
          <h2>Partners / Resellers</h2>
          <p>
            Channels that sell your departures, and how commission is settled
            with each.
          </p>
        </div>
        <button
          type="button"
          className="button catalog-add-btn settings-head-action"
          aria-label="Add partner"
          onClick={openCreate}
        >
          <Plus size={17} />
          <span className="button-label">Add partner</span>
        </button>
      </div>

      {partners.error ? (
        <Notice error>{partners.error}</Notice>
      ) : !partners.data ? (
        <Loading />
      ) : !partners.data.length ? (
        <Empty title="No partners yet">
          <p>
            Add the OTAs, agencies and hotels you work with, then set how
            commission is calculated and settled with each one.
          </p>
          <button type="button" className="button" onClick={openCreate}>
            <Plus size={16} /> Add partner
          </button>
        </Empty>
      ) : (
        <>
          <div className="settings-list">
            {partners.data.map((partner) => (
              <article key={partner.id}>
                <div>
                  <strong>
                    {partner.name}
                    {partner.partner_type ? (
                      <span className="muted">
                        {" "}
                        · {label(partner.partner_type)}
                      </span>
                    ) : null}
                    {partner.status === "inactive" ? (
                      <>
                        {" "}
                        <Status state="inactive" />
                      </>
                    ) : null}
                  </strong>
                  <p>
                    {commissionSummary(partner, fallbackCurrency)}
                    {partner.email ? ` · ${partner.email}` : ""}
                  </p>
                </div>
                <div className="location-list-actions">
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={`Edit ${partner.name}`}
                    onClick={() => openEdit(partner)}
                  >
                    <Pencil size={16} />
                  </button>
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={
                      partner.status === "active"
                        ? `Archive ${partner.name}`
                        : `Restore ${partner.name}`
                    }
                    onClick={() => {
                      statusMutation.clear();
                      setPendingStatus(partner);
                    }}
                  >
                    {partner.status === "active" ? (
                      <Archive size={16} />
                    ) : (
                      <RotateCcw size={16} />
                    )}
                  </button>
                </div>
              </article>
            ))}
          </div>
        </>
      )}

      <FormDialog
        open={editor !== null}
        title={isEdit ? `Edit ${editor.partner.name}` : "Add partner"}
        description={
          isEdit
            ? "Contact details apply immediately. Commission terms apply to bookings attributed from now on — links already settled keep the terms they were created with."
            : "Create the partner, then set how commission is calculated and settled."
        }
        busy={partnerMutation.busy}
        error={partnerMutation.error}
        submitLabel={isEdit ? "Save changes" : "Add partner"}
        submitDisabled={!form.name.trim()}
        className="partner-dialog"
        onClose={() => {
          if (!partnerMutation.busy) setEditor(null);
        }}
        onSubmit={submitPartner}
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
        <Field label="Notes" hint="Internal only.">
          <textarea
            maxLength={2000}
            value={form.notes}
            onChange={(e) => set("notes", e.target.value)}
          />
        </Field>

        <div
          className={showRate || showAmount ? "form-grid three" : "form-grid"}
        >
          <Field label="Partner type">
            <select
              value={form.partnerType}
              onChange={(e) => set("partnerType", e.target.value)}
            >
              <option value="">— Select —</option>
              <option value="ota">OTA / Platform</option>
              <option value="reseller">Reseller / Agency</option>
              <option value="affiliate">Affiliate / Referral</option>
              <option value="wholesale">Wholesale / Net rate</option>
            </select>
          </Field>
          <Field
            label="Commission basis"
            hint="Leave unset to add the partner without commission terms."
          >
            <select
              value={form.commissionType}
              onChange={(e) => set("commissionType", e.target.value)}
            >
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
            <Field
              label={`Amount (${form.commissionCurrency || fallbackCurrency})`}
              required
            >
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
                  <option value="tenant_owes_partner">
                    We pay the partner
                  </option>
                </select>
              </Field>
              <Field label="Settlement currency">
                <input
                  required
                  maxLength={3}
                  pattern="[A-Za-z]{3}"
                  value={form.commissionCurrency}
                  onChange={(e) =>
                    set("commissionCurrency", e.target.value.toUpperCase())
                  }
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
                    // Day means day-of-month for monthly but day-of-week for
                    // weekly/biweekly, so a carried-over value would be wrong.
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
              {showDay &&
                (form.settlementSchedule === "monthly" ? (
                  <Field
                    label="Day of month"
                    hint="1–31. Short months fall back to their last day."
                  >
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
                        <option key={d} value={String(i + 1)}>
                          {d}
                        </option>
                      ))}
                    </select>
                  </Field>
                ))}
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
      </FormDialog>

      <ConfirmDialog
        open={pendingStatus !== null}
        title={
          pendingStatus?.status === "active"
            ? "Archive partner?"
            : "Restore partner?"
        }
        description={
          pendingStatus
            ? pendingStatus.status === "active"
              ? `${pendingStatus.name} stays on existing bookings and settlements but can no longer be attributed to new ones.`
              : `${pendingStatus.name} becomes selectable again when attributing bookings.`
            : undefined
        }
        confirmLabel={
          pendingStatus?.status === "active" ? "Archive partner" : "Restore"
        }
        busy={statusMutation.busy}
        error={statusMutation.error}
        onClose={() => {
          if (!statusMutation.busy) setPendingStatus(null);
        }}
        onConfirm={confirmStatusChange}
      />
    </section>
  );
}
