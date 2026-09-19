"use client";

import { useEffect, useState } from "react";
import {
  FolderOpen,
  Pencil,
  Plus,
  Receipt,
  Settings,
  Trash2,
  X,
} from "lucide-react";
import type { Session } from "@/lib/types";
import { dateOnly, money, useMutation, useResource } from "@/lib/client";
import {
  Empty,
  Field,
  FormDialog,
  Loading,
  Notice,
  SearchBox,
  TenantDateInput,
} from "./common";

// ─── Types ────────────────────────────────────────────────────────────────────

type Vendor = { id: string; name: string; is_active: boolean };
type ExpenseCategory = {
  id: string;
  name: string;
  sort_order: number;
  is_active: boolean;
};
type Expense = {
  id: string;
  category_id: string;
  category_name: string;
  amount_minor: number;
  currency: string;
  fx_rate?: number | null;
  amount_reporting_minor?: number | null;
  expense_date: string;
  vendor?: string | null;
  description?: string | null;
  reference?: string | null;
  voided_at?: string | null;
  recorded_by_name?: string;
  created_at: string;
};
type CategoryTotal = {
  category_name: string;
  total_minor: number;
  total_reporting_minor: number | null;
  currency: string;
};
type ExpenseListResponse = {
  expenses: Expense[];
  category_totals: CategoryTotal[];
  currency: string;
};

// ─── Vendor Manager Dialog ────────────────────────────────────────────────────

function VendorManagerDialog({
  open,
  vendors,
  onClose,
  onVendorsChanged,
}: {
  open: boolean;
  vendors: Vendor[];
  onClose: () => void;
  onVendorsChanged: () => void;
}) {
  const [newName, setNewName] = useState("");
  const [dupError, setDupError] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const addMut = useMutation();
  const archiveMut = useMutation();
  const renameMut = useMutation();

  useEffect(() => {
    if (open) {
      setNewName("");
      setDupError("");
      setEditingId(null);
      setEditName("");
      addMut.clear();
      archiveMut.clear();
      renameMut.clear();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function addVendor() {
    const trimmed = newName.trim();
    if (!trimmed) return;
    // Client-side duplicate check
    if (
      vendors.some(
        (v) => v.is_active && v.name.toLowerCase() === trimmed.toLowerCase(),
      )
    ) {
      setDupError(`"${trimmed}" already exists.`);
      return;
    }
    setDupError("");
    await addMut.run("finance/v1/vendors", { name: trimmed });
    if (!addMut.error) {
      setNewName("");
      addMut.clear();
      onVendorsChanged();
    }
  }

  async function archiveVendor(id: string) {
    await archiveMut.run(`finance/v1/vendors/${id}`, {}, "DELETE");
    if (!archiveMut.error) {
      archiveMut.clear();
      onVendorsChanged();
    }
  }

  function startEdit(v: Vendor) {
    setEditingId(v.id);
    setEditName(v.name);
    renameMut.clear();
  }

  function cancelEdit() {
    setEditingId(null);
    setEditName("");
    renameMut.clear();
  }

  async function saveEdit(id: string) {
    const trimmed = editName.trim();
    if (!trimmed) return;
    // Client-side duplicate check (excluding the vendor being renamed)
    if (
      vendors.some(
        (v) =>
          v.is_active &&
          v.id !== id &&
          v.name.toLowerCase() === trimmed.toLowerCase(),
      )
    ) {
      renameMut.clear();
      return;
    }
    await renameMut.run(`finance/v1/vendors/${id}`, { name: trimmed }, "PATCH");
    if (!renameMut.error) {
      setEditingId(null);
      setEditName("");
      renameMut.clear();
      onVendorsChanged();
    }
  }

  const active = vendors.filter((v) => v.is_active);

  if (!open) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1200,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: "rgba(0,0,0,0.5)",
        }}
        onClick={onClose}
      />
      <div
        className="panel"
        style={{
          position: "relative",
          zIndex: 1,
          width: "min(440px, calc(100vw - 32px))",
          borderRadius: 12,
          padding: 24,
          display: "flex",
          flexDirection: "column",
          gap: 16,
          maxHeight: "70vh",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <h3 style={{ margin: 0, fontSize: "1rem", fontWeight: 600 }}>
            Manage Vendors
          </h3>
          <button type="button" className="icon-button" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        {/* Add row */}
        <div style={{ display: "flex", gap: 8 }}>
          <input
            placeholder="Vendor name…"
            value={newName}
            onChange={(e) => {
              setNewName(e.target.value);
              setDupError("");
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void addVendor();
              }
            }}
            style={{ flex: 1 }}
            autoFocus
          />
          <button
            type="button"
            className="button small primary"
            onClick={() => void addVendor()}
            disabled={addMut.busy || !newName.trim()}
            style={{ display: "flex", alignItems: "center", gap: 4 }}
          >
            <Plus size={14} /> Add
          </button>
        </div>
        {dupError && <Notice error>{dupError}</Notice>}
        {addMut.error && <Notice error>{addMut.error}</Notice>}
        {archiveMut.error && <Notice error>{archiveMut.error}</Notice>}
        {renameMut.error && <Notice error>{renameMut.error}</Notice>}

        {/* Vendor list */}
        <div
          style={{
            overflowY: "auto",
            flex: 1,
            display: "flex",
            flexDirection: "column",
            gap: 4,
          }}
        >
          {active.length === 0 && (
            <p
              style={{ color: "var(--muted)", fontSize: "0.85rem", margin: 0 }}
            >
              No vendors yet. Add one above.
            </p>
          )}
          {active.map((v) => (
            <div
              key={v.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "6px 12px",
                borderRadius: 8,
                background: "var(--surface-raised, var(--bg-muted))",
              }}
            >
              {editingId === v.id ? (
                <>
                  <input
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        void saveEdit(v.id);
                      }
                      if (e.key === "Escape") {
                        e.preventDefault();
                        cancelEdit();
                      }
                    }}
                    style={{ flex: 1, fontSize: "0.9rem" }}
                    autoFocus
                  />
                  <button
                    type="button"
                    className="button small primary"
                    onClick={() => void saveEdit(v.id)}
                    disabled={renameMut.busy || !editName.trim()}
                    style={{ fontSize: "0.78rem", padding: "3px 10px" }}
                  >
                    Save
                  </button>
                  <button
                    type="button"
                    className="button small"
                    onClick={cancelEdit}
                    style={{ fontSize: "0.78rem", padding: "3px 10px" }}
                  >
                    Cancel
                  </button>
                </>
              ) : (
                <>
                  <span style={{ flex: 1, fontSize: "0.9rem" }}>{v.name}</span>
                  <button
                    type="button"
                    className="icon-button"
                    title="Rename vendor"
                    style={{ color: "var(--muted)" }}
                    onClick={() => startEdit(v)}
                    disabled={archiveMut.busy || renameMut.busy}
                  >
                    <Pencil size={14} />
                  </button>
                  <button
                    type="button"
                    className="icon-button"
                    title="Archive vendor"
                    style={{ color: "var(--muted)" }}
                    onClick={() => void archiveVendor(v.id)}
                    disabled={archiveMut.busy || renameMut.busy}
                  >
                    <Trash2 size={14} />
                  </button>
                </>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Vendor select + manage button ───────────────────────────────────────────

function VendorField({
  value,
  onChange,
  vendors,
  onManage,
}: {
  value: string;
  onChange: (v: string) => void;
  vendors: Vendor[];
  onManage: () => void;
}) {
  const active = vendors.filter((v) => v.is_active);
  return (
    <div style={{ display: "flex", gap: 8 }}>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{ flex: 1, minWidth: 0 }}
      >
        <option value="">— select vendor —</option>
        {active.map((v) => (
          <option key={v.id} value={v.name}>
            {v.name}
          </option>
        ))}
      </select>
      <button
        type="button"
        className="button small secondary"
        onClick={onManage}
        style={{
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          gap: 4,
          whiteSpace: "nowrap",
        }}
      >
        <Settings size={13} /> Manage
      </button>
    </div>
  );
}

// ─── Bill entry modal ─────────────────────────────────────────────────────────

type Line = { category_id: string; description: string; amount: string };
const emptyLine = (): Line => ({
  category_id: "",
  description: "",
  amount: "",
});

function BillEntryModal({
  open,
  categories,
  vendors,
  onClose,
  onSaved,
  onVendorsChanged,
  defaultCurrency,
  reportingCurrency,
  recentExpenses,
  editExpense,
  dateFormat,
  locale,
}: {
  open: boolean;
  categories: ExpenseCategory[];
  vendors: Vendor[];
  onClose: () => void;
  onSaved: () => void;
  onVendorsChanged: () => void;
  defaultCurrency: string;
  reportingCurrency: string;
  recentExpenses: Expense[];
  editExpense?: Expense | null;
  dateFormat: "DD/MM/YYYY" | "MM/DD/YYYY" | "YYYY-MM-DD";
  locale: string;
}) {
  const isEdit = !!editExpense;
  const [vendor, setVendor] = useState("");
  const [expenseDate, setExpenseDate] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const [reference, setReference] = useState("");
  const [taxAmount, setTaxAmount] = useState("");
  const [discountAmount, setDiscountAmount] = useState("");
  const [lines, setLines] = useState<Line[]>([emptyLine()]);
  const [currency, setCurrency] = useState(defaultCurrency);
  const [fxRate, setFxRate] = useState("");

  // Look up the most recent fx_rate for a currency pair.
  // Stored fx_rate = reporting per 1 expense unit (e.g. 0.368050 USD/XCD).
  // UI shows the bank-board convention: expense units per 1 reporting unit (e.g. 2.7169 XCD/USD).
  // So we display 1/stored_rate and convert back on submit.
  function lastFxRate(curr: string): string {
    if (curr === reportingCurrency) return "";
    const match = recentExpenses.find(
      (e) => e.currency === curr && e.fx_rate != null && !e.voided_at,
    );
    if (match?.fx_rate == null || match.fx_rate === 0) return "";
    // Invert: stored 0.368050 → display 2.7169
    return (1 / match.fx_rate).toFixed(6).replace(/\.?0+$/, "");
  }
  const [vendorMgrOpen, setVendorMgrOpen] = useState(false);
  const mut = useMutation();

  useEffect(() => {
    if (open) {
      if (editExpense) {
        // Edit mode: seed from existing expense (single line)
        setVendor(editExpense.vendor ?? "");
        // Normalize expense_date to YYYY-MM-DD for the date input
        // (node-postgres may return DATE as a full ISO timestamp string)
        setExpenseDate(
          editExpense.expense_date
            ? String(editExpense.expense_date).slice(0, 10)
            : new Date().toISOString().slice(0, 10),
        );
        setReference(editExpense.reference ?? "");
        setTaxAmount("");
        setDiscountAmount("");
        const editCurrency = editExpense.currency ?? defaultCurrency;
        setCurrency(editCurrency);
        // Invert stored rate (reporting/expense) back to bank-board display (expense/reporting)
        const storedRate = editExpense.fx_rate;
        setFxRate(
          storedRate != null && storedRate > 0
            ? (1 / storedRate).toFixed(6).replace(/\.?0+$/, "")
            : lastFxRate(editCurrency),
        );
        setLines([
          {
            category_id: editExpense.category_id,
            description: editExpense.description ?? "",
            amount: String(editExpense.amount_minor / 100),
          },
        ]);
      } else {
        // Add mode: blank form
        setVendor("");
        setExpenseDate(new Date().toISOString().slice(0, 10));
        setReference("");
        setTaxAmount("");
        setDiscountAmount("");
        setLines([emptyLine()]);
        const nc = defaultCurrency;
        setCurrency(nc);
        setFxRate(lastFxRate(nc));
      }
      mut.clear();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editExpense?.id]);

  function setLine(i: number, field: keyof Line, val: string) {
    setLines((ls) =>
      ls.map((l, idx) => (idx === i ? { ...l, [field]: val } : l)),
    );
  }
  function addLine() {
    setLines((ls) => [...ls, emptyLine()]);
  }
  function removeLine(i: number) {
    setLines((ls) => ls.filter((_, idx) => idx !== i));
  }

  const subtotal = lines.reduce((s, l) => {
    const n = parseFloat(l.amount);
    return s + (isNaN(n) ? 0 : Math.round(n * 100));
  }, 0);
  const taxMinor = Math.round((parseFloat(taxAmount) || 0) * 100);
  const discountMinor = Math.round((parseFloat(discountAmount) || 0) * 100);
  const grandTotal = subtotal + taxMinor - discountMinor;

  // currency is now state (defaultCurrency prop)

  async function submit() {
    // grandTotal already accounts for tax and discount.
    // Tax/discount are UI-only entry helpers — the net amount is what we store.
    // For multi-line: distribute the net total proportionally across lines by weight.
    function netAmountForLine(
      lineAmount: number,
      lineSubtotalMinor: number,
    ): number {
      if (subtotal === 0) return 0;
      // Each line gets its share of the grand total
      const share = lineSubtotalMinor / subtotal;
      return Math.round(grandTotal * share);
    }

    const storedFxRate =
      currency !== reportingCurrency && fxRate
        ? +(1 / parseFloat(fxRate)).toFixed(6)
        : undefined;

    if (isEdit && editExpense) {
      // Edit mode — PATCH single expense (first valid line wins)
      const line = lines.find((l) => l.category_id && parseFloat(l.amount) > 0);
      if (!line) return;
      const lineSubtotal = Math.round(parseFloat(line.amount) * 100);
      // Apply discount/tax: net amount = grandTotal (single line = full adjustment)
      const amountMinor = netAmountForLine(
        parseFloat(line.amount),
        lineSubtotal,
      );
      await mut.run(
        `finance/v1/expenses/${editExpense.id}`,
        {
          expense_date: expenseDate,
          category_id: line.category_id,
          amount_minor: amountMinor,
          currency: currency,
          fx_rate: storedFxRate,
          vendor: vendor || null,
          description: line.description || null,
          reference: reference || null,
        },
        "PATCH",
      );
    } else {
      // Add mode — POST batch
      const validLines = lines.filter(
        (l) => l.category_id && parseFloat(l.amount) > 0,
      );
      if (validLines.length === 0) return;
      await mut.run("finance/v1/expenses/batch", {
        expense_date: expenseDate,
        vendor: vendor || null,
        reference: reference || null,
        currency: currency,
        fx_rate: storedFxRate,
        lines: validLines.map((l) => ({
          category_id: l.category_id,
          description: l.description || null,
          amount_minor: netAmountForLine(
            parseFloat(l.amount),
            Math.round(parseFloat(l.amount) * 100),
          ),
        })),
      });
    }
    if (!mut.error) {
      mut.clear();
      onSaved();
    }
  }

  const activeCategories = categories.filter((c) => c.is_active);
  const hasValidLine = lines.some(
    (l) => l.category_id && parseFloat(l.amount) > 0,
  );

  return (
    <>
      <FormDialog
        open={open}
        title={isEdit ? "Edit Expense" : "Add Expense"}
        busy={mut.busy}
        error={mut.error}
        onSubmit={submit}
        onClose={onClose}
        className="bill-entry-dialog"
        submitLabel={`Save${grandTotal > 0 ? ` — ${money(grandTotal, currency)}` : ""}`}
        submitDisabled={!hasValidLine}
      >
        {/* Header: Vendor (left) | Invoice # + Date as inline label+input rows (right) */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr auto",
            gap: 24,
            alignItems: "start",
          }}
        >
          <Field label="Vendor">
            <VendorField
              value={vendor}
              onChange={setVendor}
              vendors={vendors}
              onManage={() => setVendorMgrOpen(true)}
            />
          </Field>

          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {/* Fixed label col + 180px input col — both fields same width */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "auto 180px",
                gap: 10,
                alignItems: "center",
              }}
            >
              <span
                style={{
                  fontSize: "0.82rem",
                  fontWeight: 600,
                  color: "var(--muted)",
                  textAlign: "right",
                }}
              >
                Invoice #
              </span>
              <input
                placeholder="INV-2024-001"
                value={reference}
                onChange={(e) => setReference(e.target.value)}
              />
            </div>
            <TenantDateInput
              label="Date"
              value={expenseDate}
              onChange={setExpenseDate}
              max={new Date().toISOString().slice(0, 10)}
              dateFormat={dateFormat}
              locale={locale}
              compact
            />
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "auto 180px",
                gap: 10,
                alignItems: "center",
              }}
            >
              <span
                style={{
                  fontSize: "0.82rem",
                  fontWeight: 600,
                  color: "var(--muted)",
                  textAlign: "right",
                }}
              >
                Currency
              </span>
              <select
                value={currency}
                onChange={(e) => {
                  const nc = e.target.value;
                  setCurrency(nc);
                  setFxRate(lastFxRate(nc));
                }}
              >
                {Array.from(
                  new Set([
                    defaultCurrency,
                    "USD",
                    "XCD",
                    "ANG",
                    "EUR",
                    "GBP",
                    "CAD",
                  ]),
                ).map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            {currency !== reportingCurrency && (
              <div>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "auto 180px",
                    gap: 10,
                    alignItems: "center",
                  }}
                >
                  <span
                    style={{
                      fontSize: "0.82rem",
                      fontWeight: 600,
                      color: "var(--muted)",
                      textAlign: "right",
                    }}
                  >
                    Bank rate
                  </span>
                  <input
                    type="text"
                    inputMode="decimal"
                    placeholder={`${currency} per 1 ${reportingCurrency}`}
                    value={fxRate}
                    onChange={(e) => setFxRate(e.target.value)}
                    style={{ textAlign: "right" }}
                  />
                </div>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "auto 180px",
                    gap: 10,
                  }}
                >
                  <span />
                  <span
                    style={{
                      fontSize: "0.72rem",
                      color: "var(--muted)",
                      textAlign: "right",
                      marginTop: 2,
                    }}
                  >
                    Bank rate as quoted (e.g. {currency} 2.7169 ={" "}
                    {reportingCurrency} 1)
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Divider */}
        <div
          style={{ borderTop: "1px solid var(--border)", margin: "4px 0" }}
        />

        {/* Line items */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <span
              style={{
                fontSize: "0.72rem",
                fontWeight: 700,
                color: "var(--muted)",
                textTransform: "uppercase",
                letterSpacing: "0.06em",
              }}
            >
              Line Items
            </span>
            {!isEdit && (
              <button
                type="button"
                className="button small secondary"
                onClick={addLine}
                style={{ display: "flex", alignItems: "center", gap: 4 }}
              >
                <Plus size={13} /> Add line
              </button>
            )}
          </div>

          {/* Column headers */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1.2fr 1.4fr 110px 28px",
              gap: 8,
            }}
          >
            <span
              style={{
                fontSize: "0.72rem",
                fontWeight: 600,
                color: "var(--muted)",
              }}
            >
              Category
            </span>
            <span
              style={{
                fontSize: "0.72rem",
                fontWeight: 600,
                color: "var(--muted)",
              }}
            >
              Description
            </span>
            <span
              style={{
                fontSize: "0.72rem",
                fontWeight: 600,
                color: "var(--muted)",
                textAlign: "right",
              }}
            >
              Amount
            </span>
            <span />
          </div>

          {lines.map((line, i) => (
            <div
              key={i}
              style={{
                display: "grid",
                gridTemplateColumns: "1.2fr 1.4fr 110px 28px",
                gap: 8,
                alignItems: "center",
              }}
            >
              <select
                value={line.category_id}
                onChange={(e) => setLine(i, "category_id", e.target.value)}
              >
                <option value="">— category —</option>
                {activeCategories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <input
                placeholder="Description"
                value={line.description}
                onChange={(e) => setLine(i, "description", e.target.value)}
              />
              <input
                type="text"
                inputMode="decimal"
                placeholder="0.00"
                value={line.amount}
                onChange={(e) => setLine(i, "amount", e.target.value)}
                style={{ textAlign: "right" }}
              />
              <button
                type="button"
                className="icon-button"
                style={{
                  color: "var(--muted)",
                  opacity: lines.length === 1 ? 0.3 : 1,
                }}
                disabled={lines.length === 1 || isEdit}
                onClick={() => removeLine(i)}
                title="Remove line"
              >
                <X size={14} />
              </button>
            </div>
          ))}
        </div>

        {/* Divider */}
        <div
          style={{ borderTop: "1px solid var(--border)", margin: "4px 0" }}
        />

        {/* Purchase summary — 3-col grid mirrors line items: [label] [110px amount] [28px spacer]
             so Amount inputs above and summary values share the exact same right edge        */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 110px 28px",
            gap: "6px 8px",
            alignItems: "center",
          }}
        >
          <span
            style={{
              fontSize: "0.82rem",
              color: "var(--muted)",
              textAlign: "right",
            }}
          >
            Subtotal
          </span>
          <span
            style={{ fontSize: "0.82rem", textAlign: "right", paddingRight: 2 }}
          >
            {money(subtotal, currency)}
          </span>
          <span />

          <span
            style={{
              fontSize: "0.82rem",
              color: "var(--muted)",
              textAlign: "right",
            }}
          >
            Tax charged
          </span>
          <input
            type="text"
            inputMode="decimal"
            placeholder="0.00"
            value={taxAmount}
            onChange={(e) => setTaxAmount(e.target.value)}
            style={{ textAlign: "right" }}
          />
          <span />

          <span
            style={{
              fontSize: "0.82rem",
              color: "var(--muted)",
              textAlign: "right",
            }}
          >
            Discount
          </span>
          <input
            type="text"
            inputMode="decimal"
            placeholder="0.00"
            value={discountAmount}
            onChange={(e) => setDiscountAmount(e.target.value)}
            style={{ textAlign: "right" }}
          />
          <span />

          <div
            style={{
              gridColumn: "1 / -1",
              borderTop: "1px solid var(--border)",
              margin: "2px 0",
            }}
          />

          <span
            style={{ fontSize: "0.92rem", fontWeight: 700, textAlign: "right" }}
          >
            Total
          </span>
          <span
            style={{
              fontSize: "0.92rem",
              fontWeight: 700,
              textAlign: "right",
              paddingRight: 2,
            }}
          >
            {money(grandTotal, currency)}
          </span>
          <span />
        </div>
      </FormDialog>

      <VendorManagerDialog
        open={vendorMgrOpen}
        vendors={vendors}
        onClose={() => setVendorMgrOpen(false)}
        onVendorsChanged={() => {
          setVendorMgrOpen(false);
          onVendorsChanged();
        }}
      />
    </>
  );
}

// ─── Edit modal — reuses BillEntryModal in edit mode ─────────────────────────
//
// BillEntryModal accepts an optional `editExpense` prop. When set it:
//  • pre-populates all header fields + a single line from the existing expense
//  • changes the title to "Edit Expense"
//  • on submit calls PATCH finance/v1/expenses/:id (single-line update)
//    instead of POST finance/v1/expenses/batch
//
// No separate EditExpenseModal component needed.

function EditExpenseModal({
  open,
  expense,
  categories,
  vendors,
  onClose,
  onSaved,
  onVendorsChanged,
  defaultCurrency,
  reportingCurrency,
  recentExpenses,
  dateFormat,
  locale,
}: {
  open: boolean;
  expense: Expense | null;
  categories: ExpenseCategory[];
  vendors: Vendor[];
  onClose: () => void;
  onSaved: () => void;
  onVendorsChanged: () => void;
  defaultCurrency: string;
  reportingCurrency: string;
  recentExpenses: Expense[];
  dateFormat: "DD/MM/YYYY" | "MM/DD/YYYY" | "YYYY-MM-DD";
  locale: string;
}) {
  if (!open || !expense) return null;
  return (
    <BillEntryModal
      open={open}
      categories={categories}
      vendors={vendors}
      onClose={onClose}
      onSaved={onSaved}
      onVendorsChanged={onVendorsChanged}
      defaultCurrency={defaultCurrency}
      reportingCurrency={reportingCurrency}
      recentExpenses={recentExpenses}
      editExpense={expense}
      dateFormat={dateFormat}
      locale={locale}
    />
  );
}

// ─── Void dialog ──────────────────────────────────────────────────────────────

function VoidExpenseDialog({
  expense,
  open,
  onClose,
  onVoided,
}: {
  expense: Expense | null;
  open: boolean;
  onClose: () => void;
  onVoided: () => void;
}) {
  const [reason, setReason] = useState("");
  const mut = useMutation();

  async function submit() {
    if (!expense || !reason.trim()) return;
    await mut.run(
      `finance/v1/expenses/${expense.id}`,
      { void_reason: reason },
      "DELETE",
    );
    if (!mut.error) {
      mut.clear();
      onVoided();
    }
  }

  return (
    <FormDialog
      open={open && !!expense}
      title={
        expense
          ? `Void — ${money(expense.amount_minor, expense.currency)}`
          : "Void expense"
      }
      busy={mut.busy}
      error={mut.error}
      onSubmit={submit}
      onClose={onClose}
      submitLabel="Void expense"
    >
      <p
        style={{
          fontSize: "0.85rem",
          color: "var(--muted)",
          margin: "0 0 4px",
        }}
      >
        This marks the expense as voided and cannot be undone.
      </p>
      <Field label="Reason" required>
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          required
          autoFocus
        />
      </Field>
    </FormDialog>
  );
}

// ─── Expense row ──────────────────────────────────────────────────────────────

function ExpenseRow({
  expense,
  dateFormat,
  onEdit,
  onVoid,
}: {
  expense: Expense;
  dateFormat: string;
  onEdit: () => void;
  onVoid: () => void;
}) {
  return (
    <tr className={expense.voided_at ? "voided" : ""}>
      <td>{dateOnly(expense.expense_date, dateFormat as any)}</td>
      <td>{expense.vendor ?? <span className="muted">—</span>}</td>
      <td style={{ maxWidth: 200 }}>
        <span
          style={{
            display: "block",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {expense.description ?? <span className="muted">—</span>}
        </span>
        <span style={{ fontSize: "0.78rem", color: "var(--muted)" }}>
          {expense.category_name}
        </span>
      </td>
      <td>{expense.reference ?? <span className="muted">—</span>}</td>
      <td className="num">{money(expense.amount_minor, expense.currency)}</td>
      <td>
        {expense.voided_at ? (
          <span className="ledger-badge voided">Voided</span>
        ) : (
          <div style={{ display: "flex", gap: 4 }}>
            <button
              className="button small secondary"
              style={{ padding: "3px 7px" }}
              onClick={onEdit}
              title="Edit"
            >
              <Pencil size={12} />
            </button>
            <button
              className="button small secondary"
              style={{ padding: "3px 7px", color: "#dc2626" }}
              onClick={onVoid}
              title="Void"
            >
              <Trash2 size={12} />
            </button>
          </div>
        )}
      </td>
    </tr>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

// ─── Reporting-currency total display ────────────────────────────────────────

/**
 * Sum amount_reporting_minor for a category (or all categories) and render
 * as a single reporting-currency amount. This is correct multi-currency
 * accounting: each expense is frozen at its bank rate on entry, so we just
 * sum the pre-converted amounts.
 *
 * Returns "—" with a warning dot when any foreign-currency row is missing
 * a bank rate (total_reporting_minor is null for that row).
 */
function ReportingAmount({
  totals,
  forCategory,
  reportingCurrency,
}: {
  totals: CategoryTotal[];
  forCategory?: string;
  reportingCurrency: string;
}) {
  const filtered = forCategory
    ? totals.filter((t) => t.category_name === forCategory)
    : totals;
  if (filtered.length === 0) return <span>{money(0, reportingCurrency)}</span>;
  const total = filtered.reduce(
    (sum, t) => sum + (t.total_reporting_minor ?? 0),
    0,
  );
  const hasGap = filtered.some(
    (t) => t.currency !== reportingCurrency && t.total_reporting_minor == null,
  );
  return (
    <span
      title={
        hasGap
          ? "Some expenses are missing a bank rate and are excluded from this total"
          : undefined
      }
    >
      {money(total, reportingCurrency)}
      {hasGap && (
        <span style={{ color: "var(--warning, #c97700)", marginLeft: 2 }}>
          ⚠
        </span>
      )}
    </span>
  );
}

export function FinanceExpenses({ session }: { session: Session }) {
  const [selectedCatId, setSelectedCatId] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [vendorRefresh, setVendorRefresh] = useState(0);
  const [addOpen, setAddOpen] = useState(false);
  const [editExpense, setEditExpense] = useState<Expense | null>(null);
  const [voidExpense, setVoidExpense] = useState<Expense | null>(null);
  const [search, setSearch] = useState("");

  const { data: catData } = useResource<{ categories: ExpenseCategory[] }>(
    "finance/v1/expense-categories",
  );
  const { data: vendorData } = useResource<{ vendors: Vendor[] }>(
    `finance/v1/vendors?_r=${vendorRefresh}`,
  );
  const { data: listData, error: listError } = useResource<ExpenseListResponse>(
    `finance/v1/expenses?_r=${refresh}${selectedCatId ? `&categoryId=${selectedCatId}` : ""}`,
  );

  const categories = catData?.categories ?? [];
  const vendors = vendorData?.vendors ?? [];
  const expenses = listData?.expenses ?? [];
  const q = search.trim().toLowerCase();
  const visibleExpenses = q
    ? expenses.filter(
        (e) =>
          (e.vendor ?? "").toLowerCase().includes(q) ||
          (e.description ?? "").toLowerCase().includes(q) ||
          (e.reference ?? "").toLowerCase().includes(q) ||
          e.category_name.toLowerCase().includes(q),
      )
    : expenses;
  const currency =
    listData?.currency ?? session.tenant.config.collectionCurrency ?? "XCD";
  const reportingCurrency =
    session.tenant.config.reportingCurrency ??
    session.tenant.config.collectionCurrency ??
    "XCD";

  const categoryTotals = listData?.category_totals ?? [];

  function saved() {
    setAddOpen(false);
    setEditExpense(null);
    setRefresh((r) => r + 1);
  }
  function vendorsChanged() {
    setVendorRefresh((r) => r + 1);
  }

  return (
    <div className="finance-split">
      {/* Left: categories */}
      <div className="finance-list-panel">
        <div className="finance-panel-toolbar">
          <span style={{ fontWeight: 600, fontSize: "0.82rem", flex: 1 }}>
            Categories
          </span>
          <button
            className="button small primary"
            onClick={() => setAddOpen(true)}
            title="Add expense"
          >
            <Plus size={14} />
          </button>
        </div>
        <div className="finance-list-scroll">
          {!catData && <Loading />}
          <div
            className={`expense-category-item ${selectedCatId === null ? "active" : ""}`}
            onClick={() => setSelectedCatId(null)}
          >
            <FolderOpen
              size={15}
              style={{ color: "var(--muted)", flexShrink: 0 }}
            />
            <span className="expense-category-name">All expenses</span>
            <span className="expense-category-total">
              <ReportingAmount
                totals={categoryTotals}
                reportingCurrency={reportingCurrency}
              />
            </span>
          </div>
          {categories
            .filter((c) => c.is_active)
            .map((cat) => (
              <div
                key={cat.id}
                className={`expense-category-item ${selectedCatId === cat.id ? "active" : ""}`}
                onClick={() => setSelectedCatId(cat.id)}
              >
                <Receipt
                  size={15}
                  style={{ color: "var(--muted)", flexShrink: 0 }}
                />
                <span className="expense-category-name">{cat.name}</span>
                <span className="expense-category-total">
                  <ReportingAmount
                    totals={categoryTotals}
                    forCategory={cat.name}
                    reportingCurrency={reportingCurrency}
                  />
                </span>
              </div>
            ))}
        </div>
      </div>

      {/* Right: expense table */}
      <div className="finance-detail-panel">
        <div className="finance-detail-toolbar">
          <div className="staff-list-tools finance-expense-bar">
            <SearchBox
              value={search}
              onChange={setSearch}
              placeholder="Search expenses"
            />
            <button
              type="button"
              className="button catalog-add-btn"
              onClick={() => setAddOpen(true)}
            >
              <Plus size={16} /> Add expense
            </button>
          </div>
        </div>
        <div className="finance-detail-scroll">
          {listError && <Notice error>{listError}</Notice>}
          {!listData && <Loading />}
          {listData && expenses.length === 0 && (
            <Empty title="No expenses recorded">
              <p>Add an operating cost to start the register.</p>
            </Empty>
          )}
          {listData && expenses.length > 0 && visibleExpenses.length === 0 && (
            <Empty title="No expenses match">
              <p>Try a different vendor, description, or reference.</p>
            </Empty>
          )}
          {listData && visibleExpenses.length > 0 && (
            <div className="table-scroll">
              <table className="expense-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Vendor</th>
                    <th>Description / Category</th>
                    <th>Reference</th>
                    <th className="num">Amount</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {visibleExpenses.map((e) => (
                    <ExpenseRow
                      key={e.id}
                      expense={e}
                      dateFormat={session.tenant.config.dateFormat}
                      onEdit={() => setEditExpense(e)}
                      onVoid={() => setVoidExpense(e)}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <BillEntryModal
        open={addOpen}
        categories={categories}
        vendors={vendors}
        onClose={() => setAddOpen(false)}
        onSaved={saved}
        onVendorsChanged={vendorsChanged}
        defaultCurrency={session.tenant.config.collectionCurrency ?? "XCD"}
        reportingCurrency={
          session.tenant.config.reportingCurrency ??
          session.tenant.config.collectionCurrency ??
          "XCD"
        }
        recentExpenses={expenses}
        dateFormat={
          session.tenant.config.dateFormat as
            "DD/MM/YYYY" | "MM/DD/YYYY" | "YYYY-MM-DD"
        }
        locale={session.tenant.config.locale}
      />
      <EditExpenseModal
        open={!!editExpense}
        expense={editExpense}
        categories={categories}
        vendors={vendors}
        onClose={() => setEditExpense(null)}
        onSaved={saved}
        onVendorsChanged={vendorsChanged}
        defaultCurrency={session.tenant.config.collectionCurrency ?? "XCD"}
        reportingCurrency={
          session.tenant.config.reportingCurrency ??
          session.tenant.config.collectionCurrency ??
          "XCD"
        }
        recentExpenses={expenses}
        dateFormat={
          session.tenant.config.dateFormat as
            "DD/MM/YYYY" | "MM/DD/YYYY" | "YYYY-MM-DD"
        }
        locale={session.tenant.config.locale}
      />
      <VoidExpenseDialog
        expense={voidExpense}
        open={!!voidExpense}
        onClose={() => setVoidExpense(null)}
        onVoided={() => {
          setVoidExpense(null);
          setRefresh((r) => r + 1);
        }}
      />
    </div>
  );
}
