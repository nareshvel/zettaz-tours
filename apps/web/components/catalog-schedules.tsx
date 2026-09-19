"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight, ListFilter, Pause, Pencil, Play } from "lucide-react";
import type { AvailabilityRule, Product, Session } from "@/lib/types";
import { occupancyLabel, weekdayLabels } from "@/lib/types";
import { formatMediumDateRange, useMutation } from "@/lib/client";
import { Empty, Loading, Notice, Status, TenantDateInput, Toast } from "./common";
import { ScheduleFormDialog } from "./schedule-form-dialog";

export type ScheduleRange = "any" | "week" | "month" | "custom";

export type ScheduleListFilters = {
  search: string;
  status: "all" | "active" | "paused";
  range: ScheduleRange;
  customFrom: string;
  customTo: string;
};

function tenantDay(timezone: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function shiftDay(day: string, days: number) {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function mondayOf(day: string) {
  const date = new Date(`${day}T12:00:00Z`);
  const dow = (date.getUTCDay() + 6) % 7;
  return shiftDay(day, -dow);
}

function sundayOf(day: string) {
  return shiftDay(mondayOf(day), 6);
}

function monthBounds(day: string): [string, string] {
  const [year, month] = day.split("-").map(Number);
  const start = `${year}-${String(month).padStart(2, "0")}-01`;
  const last = new Date(Date.UTC(year!, month!, 0)).getUTCDate();
  const end = `${year}-${String(month).padStart(2, "0")}-${String(last).padStart(2, "0")}`;
  return [start, end];
}

export function scheduleRangeBounds(
  range: ScheduleRange,
  today: string,
  customFrom: string,
  customTo: string,
): [string, string] | null {
  if (range === "any") return null;
  if (range === "week") return [mondayOf(today), sundayOf(today)];
  if (range === "month") return monthBounds(today);
  return [customFrom || today, customTo || today];
}

function periodsOverlap(start: string, end: string, from: string, to: string) {
  return start <= to && end >= from;
}

export function scheduleFilterCount(
  filters: ScheduleListFilters,
  productId: string,
) {
  return (
    (filters.search.trim() ? 1 : 0) +
    (filters.status !== "all" ? 1 : 0) +
    (filters.range !== "any" ? 1 : 0) +
    (productId ? 1 : 0)
  );
}

export function SchedulesFilterButton({
  products,
  productId,
  filters,
  timezone,
  locale,
  dateFormat,
  onFiltersChange,
  onProductFilter,
  onClearProductFilter,
}: {
  products: Product[];
  productId: string;
  filters: ScheduleListFilters;
  timezone: string;
  locale: string;
  dateFormat: "DD/MM/YYYY" | "MM/DD/YYYY" | "YYYY-MM-DD";
  onFiltersChange: (next: ScheduleListFilters) => void;
  onProductFilter: (productId: string) => void;
  onClearProductFilter: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const today = tenantDay(timezone);
  const count = scheduleFilterCount(filters, productId);
  const scheduledProducts = products.filter(
    (item) =>
      (item.availability_mode ?? "fixed_departure") === "fixed_departure",
  );
  const activeBounds = scheduleRangeBounds(
    filters.range,
    today,
    filters.customFrom,
    filters.customTo,
  );

  useEffect(() => {
    if (!open) return;
    function onPointer(event: MouseEvent) {
      if (
        ref.current &&
        !ref.current.contains(event.target as Node) &&
        !document.getElementById("tdp-popup")?.contains(event.target as Node)
      )
        setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointer);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function clearAll() {
    onFiltersChange({
      search: "",
      status: "all",
      range: "any",
      customFrom: today,
      customTo: shiftDay(today, 13),
    });
    onClearProductFilter();
  }

  function selectRange(next: ScheduleRange) {
    if (next === "custom") {
      const bounds = scheduleRangeBounds(
        filters.range,
        today,
        filters.customFrom,
        filters.customTo,
      ) ?? [today, shiftDay(today, 13)];
      onFiltersChange({
        ...filters,
        range: next,
        customFrom: bounds[0],
        customTo: bounds[1],
      });
      return;
    }
    onFiltersChange({ ...filters, range: next });
  }

  return (
    <div className="filter-menu" ref={ref}>
      <button
        type="button"
        className={
          "button secondary catalog-add-btn" +
          (open || count ? " active-filter" : "")
        }
        aria-label="Filter schedules"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((value) => !value)}
      >
        <ListFilter size={17} />
        <span className="button-label">Filter</span>
        {count > 0 && <span className="filter-count">{count}</span>}
      </button>
      {open && (
        <div
          className="filter-popover"
          role="dialog"
          aria-label="Schedule filters"
        >
          <div className="filter-popover-head">
            <strong>Filters</strong>
            <span>{count ? `${count} active` : "None"}</span>
          </div>
          <label className="compact-control">
            <span>Search</span>
            <input
              type="search"
              placeholder="Name, tour, or time"
              value={filters.search}
              onChange={(e) =>
                onFiltersChange({ ...filters, search: e.target.value })
              }
            />
          </label>
          <label className="compact-control">
            <span>Tour</span>
            <select
              value={productId}
              onChange={(e) => {
                const value = e.target.value;
                if (value) onProductFilter(value);
                else onClearProductFilter();
              }}
            >
              <option value="">All tours</option>
              {scheduledProducts.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.customer_title ?? item.name}
                </option>
              ))}
            </select>
          </label>
          <label className="compact-control">
            <span>Status</span>
            <select
              value={filters.status}
              onChange={(e) =>
                onFiltersChange({
                  ...filters,
                  status: e.target.value as ScheduleListFilters["status"],
                })
              }
            >
              <option value="all">All statuses</option>
              <option value="active">Active</option>
              <option value="paused">Paused</option>
            </select>
          </label>
          <div className="compact-control">
            <span>Operating period</span>
            <div
              className="filter-range-options"
              role="radiogroup"
              aria-label="Operating period"
            >
              {(
                [
                  ["any", "Any dates"],
                  ["week", "This week"],
                  ["month", "This month"],
                  ["custom", "Custom range"],
                ] as const
              ).map(([value, caption]) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={filters.range === value}
                  className={
                    "filter-range-option" +
                    (filters.range === value ? " selected" : "")
                  }
                  onClick={() => selectRange(value)}
                >
                  {caption}
                </button>
              ))}
            </div>
          </div>
          {filters.range === "custom" && (
            <div className="filter-custom-range">
              <TenantDateInput
                label="From"
                compact
                value={filters.customFrom}
                max={filters.customTo || undefined}
                onChange={(customFrom) =>
                  onFiltersChange({
                    ...filters,
                    customFrom,
                  })
                }
                locale={locale}
                dateFormat={dateFormat}
              />
              <TenantDateInput
                label="To"
                compact
                value={filters.customTo}
                min={filters.customFrom || undefined}
                onChange={(customTo) =>
                  onFiltersChange({
                    ...filters,
                    customTo,
                  })
                }
                locale={locale}
                dateFormat={dateFormat}
              />
            </div>
          )}
          {filters.range !== "any" &&
          filters.range !== "custom" &&
          activeBounds ? (
            <p className="filter-range-hint muted">
              Shows schedules whose operating period overlaps{" "}
              {formatMediumDateRange(activeBounds[0], activeBounds[1])}.
            </p>
          ) : null}
          <div className="filter-popover-actions">
            <button
              type="button"
              className="text-button"
              onClick={clearAll}
              disabled={!count}
            >
              Reset
            </button>
            <button
              type="button"
              className="button"
              onClick={() => setOpen(false)}
            >
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function CatalogSchedulesPanel({
  session,
  products,
  rules,
  error,
  productId,
  filters,
  canWrite,
  onClearProductFilter,
  onAdd,
  onReload,
}: {
  session: Session;
  products: Product[];
  rules: AvailabilityRule[] | null | undefined;
  error?: string;
  productId: string;
  filters: ScheduleListFilters;
  canWrite: boolean;
  onClearProductFilter: () => void;
  onAdd: () => void;
  onReload: () => void;
}) {
  const mutation = useMutation();
  const [busyId, setBusyId] = useState("");
  const [editing, setEditing] = useState<AvailabilityRule | null>(null);
  const locale = session.tenant.config.locale;
  const today = tenantDay(session.tenant.timezone);
  const rangeBounds = scheduleRangeBounds(
    filters.range,
    today,
    filters.customFrom,
    filters.customTo,
  );

  const filtered = useMemo(() => {
    const q = filters.search.trim().toLowerCase();
    return (rules ?? [])
      .filter((rule) => !productId || rule.product_id === productId)
      .filter(
        (rule) => filters.status === "all" || rule.status === filters.status,
      )
      .filter((rule) => {
        if (!rangeBounds) return true;
        return periodsOverlap(
          rule.start_date,
          rule.end_date,
          rangeBounds[0],
          rangeBounds[1],
        );
      })
      .filter((rule) => {
        if (!q) return true;
        const hay = [
          rule.name,
          rule.product_name,
          rule.option_name,
          ...(rule.times ?? []),
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return hay.includes(q);
      })
      .slice()
      .sort((a, b) => {
        const byProduct = (a.product_name || "").localeCompare(
          b.product_name || "",
        );
        if (byProduct) return byProduct;
        return (a.name || "").localeCompare(b.name || "");
      });
  }, [rules, productId, filters, rangeBounds]);

  const filterProduct = products.find((item) => item.id === productId);
  const hasActiveFilters =
    Boolean(productId) ||
    Boolean(filters.search.trim()) ||
    filters.status !== "all" ||
    filters.range !== "any";

  async function setRuleStatus(
    rule: AvailabilityRule,
    next: "active" | "paused",
  ) {
    if (!rule.version) return;
    setBusyId(rule.id);
    const result = await mutation.run(
      `admin/v1/availability-rules/${rule.id}`,
      { version: rule.version, status: next },
      "PATCH",
    );
    setBusyId("");
    if (result) onReload();
  }

  if (error) return <Notice error>{error}</Notice>;
  if (!rules) return <Loading />;

  return (
    <div className="catalog-schedules">
      {productId ? (
        <div className="schedule-filter-bar">
          <p>
            Showing schedules for{" "}
            <strong>
              {filterProduct?.customer_title ??
                filterProduct?.name ??
                "selected product"}
            </strong>
            {` · ${filtered.length} match${filtered.length === 1 ? "" : "es"}`}
          </p>
          <button
            type="button"
            className="text-button"
            onClick={onClearProductFilter}
          >
            Clear tour filter
          </button>
        </div>
      ) : null}

      <Toast message={mutation.error} onDismiss={mutation.clear} />

      {filtered.length ? (
        <>
          <div className="table-scroll schedules-table-wrap">
            <table className="data-table editor-data-table schedules-table">
              <thead>
                <tr>
                  <th>Schedule</th>
                  <th>Tour</th>
                  <th>Period</th>
                  <th>Times</th>
                  <th>Days</th>
                  <th>Occupancy</th>
                  <th>Status</th>
                  <th>Upcoming</th>
                  <th>
                    <span className="visually-hidden">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((rule) => (
                  <tr key={rule.id}>
                    <td>
                      <Link
                        href={`/catalog/availability/${rule.id}`}
                        className="schedules-name-link"
                      >
                        {rule.name || "Untitled schedule"}
                      </Link>
                    </td>
                    <td>
                      <div className="schedules-tour-cell">
                        <strong>{rule.product_name}</strong>
                        <small className="muted">{rule.option_name}</small>
                      </div>
                    </td>
                    <td>
                      {formatMediumDateRange(
                        rule.start_date,
                        rule.end_date,
                        locale,
                      )}
                    </td>
                    <td>{rule.times.join(", ") || "—"}</td>
                    <td>
                      {rule.weekdays
                        .map((day) => weekdayLabels[day - 1])
                        .join(" · ")}
                    </td>
                    <td>{occupancyLabel(rule)}</td>
                    <td>
                      <Status state={rule.status} />
                    </td>
                    <td>{rule.upcoming_departures}</td>
                    <td className="row-actions">
                      {canWrite ? (
                        <button
                          type="button"
                          className="icon-link"
                          aria-label={`Edit ${rule.name || "schedule"}`}
                          onClick={() => setEditing(rule)}
                        >
                          <Pencil size={16} />
                        </button>
                      ) : null}
                      {canWrite && rule.status === "active" ? (
                        <button
                          type="button"
                          className="icon-link"
                          aria-label={`Pause ${rule.name || "schedule"}`}
                          disabled={busyId === rule.id || mutation.busy}
                          onClick={() => void setRuleStatus(rule, "paused")}
                        >
                          <Pause size={16} />
                        </button>
                      ) : null}
                      {canWrite && rule.status === "paused" ? (
                        <button
                          type="button"
                          className="icon-link"
                          aria-label={`Resume ${rule.name || "schedule"}`}
                          disabled={busyId === rule.id || mutation.busy}
                          onClick={() => void setRuleStatus(rule, "active")}
                        >
                          <Play size={16} />
                        </button>
                      ) : null}
                      <Link
                        className="icon-link"
                        href={`/catalog/availability/${rule.id}`}
                        aria-label={`Open ${rule.name || "schedule"}`}
                      >
                        <ArrowRight size={16} />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <ul className="schedules-cards" aria-label="Schedules">
            {filtered.map((rule) => (
              <li key={rule.id} className="schedules-card">
                <div className="schedules-card-head">
                  <div>
                    <Link
                      href={`/catalog/availability/${rule.id}`}
                      className="schedules-name-link"
                    >
                      {rule.name || "Untitled schedule"}
                    </Link>
                    <p className="muted">
                      {rule.product_name} · {rule.option_name}
                    </p>
                  </div>
                  <Status state={rule.status} />
                </div>
                <dl className="schedules-card-facts">
                  <div>
                    <dt>Period</dt>
                    <dd>
                      {formatMediumDateRange(
                        rule.start_date,
                        rule.end_date,
                        locale,
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt>Times</dt>
                    <dd>{rule.times.join(", ") || "—"}</dd>
                  </div>
                  <div>
                    <dt>Days</dt>
                    <dd>
                      {rule.weekdays
                        .map((day) => weekdayLabels[day - 1])
                        .join(" · ")}
                    </dd>
                  </div>
                  <div>
                    <dt>Occupancy</dt>
                    <dd>{occupancyLabel(rule)}</dd>
                  </div>
                  <div>
                    <dt>Upcoming</dt>
                    <dd>{rule.upcoming_departures}</dd>
                  </div>
                </dl>
                <div className="schedules-card-actions">
                  {canWrite ? (
                    <button
                      type="button"
                      className="button secondary"
                      onClick={() => setEditing(rule)}
                    >
                      <Pencil size={16} />
                      Edit
                    </button>
                  ) : null}
                  {canWrite && rule.status === "active" ? (
                    <button
                      type="button"
                      className="button secondary"
                      disabled={busyId === rule.id || mutation.busy}
                      onClick={() => void setRuleStatus(rule, "paused")}
                    >
                      <Pause size={16} />
                      Pause
                    </button>
                  ) : null}
                  {canWrite && rule.status === "paused" ? (
                    <button
                      type="button"
                      className="button secondary"
                      disabled={busyId === rule.id || mutation.busy}
                      onClick={() => void setRuleStatus(rule, "active")}
                    >
                      <Play size={16} />
                      Resume
                    </button>
                  ) : null}
                  <Link
                    className="button"
                    href={`/catalog/availability/${rule.id}`}
                  >
                    Open
                    <ArrowRight size={16} />
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <Empty
          title={
            hasActiveFilters
              ? "No schedules match these filters"
              : "No schedules yet"
          }
        >
          {canWrite && (
            <button type="button" className="text-button" onClick={onAdd}>
              {hasActiveFilters ? "Add schedule" : "Create schedule"}
            </button>
          )}
        </Empty>
      )}
      {canWrite ? (
        <ScheduleFormDialog
          session={session}
          open={Boolean(editing)}
          rule={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            onReload();
          }}
        />
      ) : null}
    </div>
  );
}
