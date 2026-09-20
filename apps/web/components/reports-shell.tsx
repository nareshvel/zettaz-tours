"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronDown, Download, Printer } from "lucide-react";
import { Heading } from "./common";

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
    <div
      className={"report-filter-bar" + (open ? " is-open" : "")}
      ref={ref}
    >
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
