"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronDown, Download, Printer } from "lucide-react";
import { Heading } from "./common";
import {
  BASIS_LABELS,
  REPORT_PRESETS,
  mondayOf,
  rangeBounds,
  sundayOf,
  tenantDay,
  type ReportBasis,
  type ReportRange,
} from "@/lib/report-period";
import { formatMediumDateRange } from "@/lib/client";
import { TenantDateInput } from "./common";
import type { Session } from "@/lib/types";

export function ReportFilterBar({
  summary,
  children,
}: {
  summary: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointer(event: MouseEvent) {
      if (
        ref.current?.contains(event.target as Node) ||
        document.getElementById("tdp-popup")?.contains(event.target as Node)
      ) {
        return;
      }
      setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className={"report-filter-bar" + (open ? " is-open" : "")} ref={ref}>
      <button
        type="button"
        className={
          "button secondary catalog-add-btn report-filters-trigger" +
          (open ? " active-filter" : "")
        }
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label="Report filters"
        onClick={() => setOpen((value) => !value)}
      >
        <span className="button-label">{summary}</span>
        <ChevronDown size={16} aria-hidden="true" />
      </button>
      <div className="report-filters-panel">{children}</div>
    </div>
  );
}

export function ReportShell({
  title,
  basis,
  filters,
  onExport,
  exportDisabled,
  children,
}: {
  title: string;
  basis?: string;
  filters?: ReactNode;
  onExport?: () => void;
  exportDisabled?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="report-shell">
      <Heading eyebrow="REPORT" title={title} description={basis} />
      <div className="report-shell-toolbar no-print">
        <div className="report-shell-filters">{filters}</div>
        <div className="report-shell-actions">
          {onExport && (
            <button
              type="button"
              className="button secondary icon-only"
              disabled={exportDisabled}
              onClick={onExport}
              aria-label="Export CSV"
              title="Export CSV"
            >
              <Download size={16} />
            </button>
          )}
          <button
            type="button"
            className="button secondary icon-only"
            onClick={() => window.print()}
            aria-label="Print"
            title="Print"
          >
            <Printer size={16} />
          </button>
        </div>
      </div>
      <div className="report-shell-body">{children}</div>
    </div>
  );
}

// ─── Shared period + basis picker ────────────────────────────────────────────

function readUrl() {
  if (typeof window === "undefined") return new URLSearchParams();
  return new URLSearchParams(window.location.search);
}

/**
 * Period state for a report. Filters live in the URL (?range=&from=&to=&basis=)
 * so a report view can be bookmarked or shared, and survive reload.
 */
export function useReportPeriod(
  session: Session,
  options: { basis?: boolean; defaultRange?: ReportRange } = {},
) {
  const today = tenantDay(session.tenant.timezone);
  const initial = readUrl();
  const [preset, setPreset] = useState<ReportRange>(
    (REPORT_PRESETS.some((p) => p.value === initial.get("range"))
      ? initial.get("range")
      : (options.defaultRange ?? "week")) as ReportRange,
  );
  const [customFrom, setCustomFrom] = useState(
    initial.get("from") ?? mondayOf(today),
  );
  const [customTo, setCustomTo] = useState(
    initial.get("to") ?? sundayOf(today),
  );
  const [basis, setBasis] = useState<ReportBasis>(
    initial.get("basis") === "booked" ? "booked" : "departure",
  );
  const [from, to] = rangeBounds(preset, today, customFrom, customTo);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    params.set("range", preset);
    if (preset === "custom") {
      params.set("from", from);
      params.set("to", to);
    } else {
      params.delete("from");
      params.delete("to");
    }
    if (options.basis && basis !== "departure") params.set("basis", basis);
    else params.delete("basis");
    const next = `${window.location.pathname}?${params.toString()}`;
    window.history.replaceState(window.history.state, "", next);
  }, [preset, from, to, basis, options.basis]);

  const locale = session.tenant.config.locale;
  const dateFormat = session.tenant.config.dateFormat;
  const presetLabel =
    REPORT_PRESETS.find((item) => item.value === preset)?.caption ??
    "This week";
  const query = new URLSearchParams({
    from,
    to,
    ...(options.basis ? { basis } : {}),
  }).toString();

  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    function onPointer(event: MouseEvent) {
      if (
        menuRef.current?.contains(event.target as Node) ||
        document.getElementById("tdp-popup")?.contains(event.target as Node)
      )
        return;
      setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const summary =
    options.basis && basis !== "departure"
      ? `${presetLabel} · ${BASIS_LABELS[basis]}`
      : presetLabel;

  const filters = (
    <div className="filter-menu report-filter-menu" ref={menuRef}>
      <button
        type="button"
        className={
          "button secondary catalog-add-btn" + (open ? " active-filter" : "")
        }
        aria-label="Report period"
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={() => setOpen((value) => !value)}
      >
        <span className="button-label">{summary}</span>
        <ChevronDown size={16} aria-hidden="true" />
      </button>
      {open && (
        <div
          className="filter-popover"
          role="listbox"
          aria-label="Report period"
        >
          {REPORT_PRESETS.map((item) => (
            <button
              key={item.value}
              type="button"
              role="option"
              aria-selected={preset === item.value}
              className={
                "filter-range-option" +
                (preset === item.value ? " selected" : "")
              }
              onClick={() => {
                if (item.value === "custom") {
                  setCustomFrom(from);
                  setCustomTo(to);
                } else setOpen(false);
                setPreset(item.value);
              }}
            >
              {item.caption}
            </button>
          ))}
          {preset === "custom" && (
            <div className="report-custom-dates">
              <TenantDateInput
                label="From"
                value={customFrom}
                max={customTo || undefined}
                onChange={setCustomFrom}
                locale={locale}
                dateFormat={dateFormat}
                compact
              />
              <TenantDateInput
                label="To"
                value={customTo}
                min={customFrom || undefined}
                onChange={setCustomTo}
                locale={locale}
                dateFormat={dateFormat}
                compact
              />
            </div>
          )}
          {options.basis && (
            <div
              className="report-basis"
              role="radiogroup"
              aria-label="Date basis"
            >
              <span>Date basis</span>
              {(Object.keys(BASIS_LABELS) as ReportBasis[]).map((value) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={basis === value}
                  className={
                    "filter-range-option" + (basis === value ? " selected" : "")
                  }
                  onClick={() => setBasis(value)}
                >
                  {BASIS_LABELS[value]}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );

  return {
    from,
    to,
    basis,
    query,
    filters,
    rangeHint: formatMediumDateRange(from, to, locale),
    basisLabel: BASIS_LABELS[basis],
    locale,
    dateFormat,
  };
}

/** Header rows that every CSV export starts with. */
export function csvHeader(
  session: Session,
  title: string,
  period: { from: string; to: string; basisLabel: string },
  currency: string,
): (string | number)[][] {
  return [
    ["Report", title],
    ["Tenant", session.tenant.name ?? ""],
    ["From", period.from],
    ["To", period.to],
    ["Date basis", period.basisLabel],
    ["Timezone", session.tenant.timezone],
    ["Currency", currency],
    ["Generated", new Date().toISOString()],
    [],
  ];
}
