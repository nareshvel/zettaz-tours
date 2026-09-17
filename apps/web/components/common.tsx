"use client";
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, Search, X } from "lucide-react";
import Link from "next/link";
import { dateOnly, label } from "@/lib/client";
export function Heading({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="page-heading">
      <div className="page-heading-copy">
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <div className="page-heading-title-row">
          <h1>{title}</h1>
          {action ? <div className="page-heading-action">{action}</div> : null}
        </div>
        {description && <p className="subtitle">{description}</p>}
      </div>
    </div>
  );
}
export function Notice({
  error,
  children,
}: {
  error?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className={"notice " + (error ? "error" : "")}
      role={error ? "alert" : "status"}
    >
      {children}
    </div>
  );
}
export function Loading() {
  return (
    <div className="loading" role="status">
      <span className="spinner" />
      Loading workspace…
    </div>
  );
}
export function Empty({
  title,
  children,
}: {
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      {children}
    </div>
  );
}
export function Status({ state }: { state: string }) {
  const text =
    state === "held"
      ? "On hold"
      : state === "held_provider"
        ? "Held"
        : label(state);
  return <span className={"status " + state}>{text}</span>;
}
export function Field({
  label: caption,
  children,
  hint,
  error,
  required,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
  error?: string;
  required?: boolean;
}) {
  return (
    <label className={"field " + (error ? "field-error" : "")}>
      <span>
        {caption}
        {required && <i aria-hidden="true"> *</i>}
      </span>
      {children}
      {error ? (
        <small className="field-message" role="alert">
          {error}
        </small>
      ) : (
        hint && <small>{hint}</small>
      )}
    </label>
  );
}
/**
 * An explanation that stays out of the way until asked for.
 *
 * Long guidance paragraphs under a heading get skipped after the first read,
 * yet they are exactly what someone needs the one time they are configuring
 * something unfamiliar. Putting them behind a marker keeps the page scannable
 * without losing the words.
 *
 * Click rather than hover: this has to work on the tablets used at the counter,
 * where there is no pointer to hover with. Escape and a click anywhere else
 * close it, and the panel is a real element in the DOM rather than a title
 * attribute, so screen readers announce it and it can hold more than one line.
 */
export function InfoTip({
  label: caption,
  children,
}: {
  /** Names what is being explained, for anyone who cannot see the marker. */
  label: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  useEffect(() => {
    if (!open) return;
    const close = (event: Event) => {
      if (
        event instanceof KeyboardEvent &&
        event.key !== "Escape" &&
        event.type === "keydown"
      )
        return;
      setOpen(false);
    };
    // Deferred so the click that opened it does not immediately close it.
    const timer = setTimeout(() => {
      document.addEventListener("click", close);
      document.addEventListener("keydown", close);
    }, 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("click", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);
  return (
    <span className="info-tip" onClick={(event) => event.stopPropagation()}>
      <button
        type="button"
        className="info-tip-marker"
        aria-label={`About ${caption}`}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((current) => !current)}
      >
        ?
      </button>
      {open && (
        <span className="info-tip-panel" id={panelId} role="note">
          {children}
        </span>
      )}
    </span>
  );
}
/**
 * A transient message that does not hold a place on the page.
 *
 * Errors like "Departure has already started" answer a question the user has
 * already moved on from; rendered inline they sit there contradicting the
 * screen until something else re-renders. A toast says its piece, then leaves.
 *
 * Portaled to the body so a panel's overflow cannot clip it, and announced
 * politely — assertively for errors, which are worth interrupting for.
 */
export function Toast({
  message,
  tone = "error",
  duration = 6000,
  onDismiss,
}: {
  message: string | null | undefined;
  tone?: "error" | "info";
  /** Milliseconds before it leaves on its own. */
  duration?: number;
  onDismiss: () => void;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(onDismiss, duration);
    return () => window.clearTimeout(timer);
    // onDismiss is a stable clear() in practice; keying on the message means a
    // new message restarts the clock rather than inheriting the old one.
  }, [message, duration]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!mounted || !message) return null;
  return createPortal(
    <div
      className={`toast ${tone}`}
      role={tone === "error" ? "alert" : "status"}
      aria-live={tone === "error" ? "assertive" : "polite"}
    >
      <span>{message}</span>
      <button type="button" aria-label="Dismiss" onClick={onDismiss}>
        <X size={15} />
      </button>
    </div>,
    document.body,
  );
}
export function SectionHeading({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="section-heading">
      <div>
        <h2>{title}</h2>
        {description && <p>{description}</p>}
      </div>
      {action}
    </div>
  );
}
export function FormActions({
  children,
  stickyOnMobile = false,
}: {
  children: React.ReactNode;
  stickyOnMobile?: boolean;
}) {
  return (
    <div className={"form-actions " + (stickyOnMobile ? "mobile-sticky" : "")}>
      {children}
    </div>
  );
}

/** In-app confirm with optional required reason — replaces window.prompt/confirm. */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  danger,
  reasonRequired,
  reasonLabel = "Reason",
  reasonHint,
  reasonPlaceholder,
  busy,
  error,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  description?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  reasonRequired?: boolean;
  reasonLabel?: string;
  reasonHint?: string;
  reasonPlaceholder?: string;
  busy?: boolean;
  error?: string | null;
  onConfirm: (reason: string) => void | Promise<void>;
  onClose: () => void;
}) {
  const titleId = useId();
  const [reason, setReason] = useState("");
  const [localError, setLocalError] = useState("");

  useEffect(() => {
    if (!open) return;
    setReason("");
    setLocalError("");
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape" && !busy) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, busy, onClose]);

  if (!open) return null;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setLocalError("");
    const trimmed = reason.trim();
    if (reasonRequired && !trimmed) {
      setLocalError("Enter a reason to continue.");
      return;
    }
    await onConfirm(trimmed);
  }

  if (typeof document === "undefined") return null;

  return createPortal(
    <div className="confirm-dialog-root" role="presentation">
      <div className="confirm-dialog-scrim" aria-hidden="true" />
      <form
        className="panel confirm-dialog-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onSubmit={(event) => {
          // React bubbles events through the React tree, not the DOM tree, so a
          // portaled dialog's submit still reaches an ancestor <form> — e.g. the
          // tenant settings form. Stop it here: a modal's submit is its own.
          event.stopPropagation();
          void submit(event);
        }}
      >
        <header className="confirm-dialog-head">
          <div>
            <h2 id={titleId}>{title}</h2>
            {description ? (
              <div className="muted confirm-dialog-desc">{description}</div>
            ) : null}
          </div>
          <button
            type="button"
            className="icon-button"
            aria-label="Close"
            disabled={busy}
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </header>
        <div className="confirm-dialog-body">
          {reasonRequired && (
            <Field
              label={reasonLabel}
              hint={reasonHint}
              error={localError || undefined}
              required
            >
              <textarea
                autoFocus
                required
                maxLength={500}
                placeholder={reasonPlaceholder}
                value={reason}
                disabled={busy}
                onChange={(event) => setReason(event.target.value)}
              />
            </Field>
          )}
          {(error || localError) && !reasonRequired && (
            <Notice error>{error || localError}</Notice>
          )}
          {error && reasonRequired && <Notice error>{error}</Notice>}
          <div className="confirm-dialog-actions">
            <button
              type="button"
              className="button secondary"
              disabled={busy}
              onClick={onClose}
            >
              {cancelLabel}
            </button>
            <button
              type="submit"
              className={"button" + (danger ? " danger" : "")}
              disabled={busy}
            >
              {busy ? "Working…" : confirmLabel}
            </button>
          </div>
        </div>
      </form>
    </div>,
    document.body,
  );
}

/** Modal form sheet for create/edit flows — same shell as ConfirmDialog. */
export function FormDialog({
  open,
  title,
  description,
  children,
  afterActions,
  busy,
  error,
  submitLabel = "Save",
  cancelLabel = "Cancel",
  submitDisabled = false,
  className,
  onSubmit,
  onClose,
}: {
  open: boolean;
  title: string;
  description?: string;
  children: React.ReactNode;
  /** Content rendered below Cancel / Submit (e.g. existing records). */
  afterActions?: React.ReactNode;
  busy?: boolean;
  error?: string | null;
  submitLabel?: string;
  cancelLabel?: string;
  submitDisabled?: boolean;
  className?: string;
  onSubmit: () => void | Promise<void>;
  onClose: () => void;
}) {
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape" && !busy) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, busy, onClose]);

  if (!open) return null;
  if (typeof document === "undefined") return null;

  return createPortal(
    <div className="confirm-dialog-root" role="presentation">
      <div className="confirm-dialog-scrim" aria-hidden="true" />
      <form
        className={
          "panel confirm-dialog-sheet form-dialog-sheet" +
          (className ? ` ${className}` : "")
        }
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onSubmit={(event) => {
          event.preventDefault();
          // See the note in ConfirmDialog: portaled events bubble through the
          // React tree, so without this an ancestor form also submits.
          event.stopPropagation();
          void onSubmit();
        }}
      >
        <header className="confirm-dialog-head">
          <div>
            <h2 id={titleId}>{title}</h2>
            {description ? (
              <div className="muted confirm-dialog-desc">{description}</div>
            ) : null}
          </div>
          <button
            type="button"
            className="icon-button"
            aria-label="Close"
            disabled={busy}
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </header>
        <div className="confirm-dialog-body">
          <div className="confirm-dialog-fields">
            {children}
            {error && <Notice error>{error}</Notice>}
          </div>
          <div className="confirm-dialog-actions">
            <button
              type="button"
              className="button secondary"
              disabled={busy}
              onClick={onClose}
            >
              {cancelLabel}
            </button>
            <button
              type="submit"
              className="button"
              disabled={busy || submitDisabled}
            >
              {busy ? "Working…" : submitLabel}
            </button>
          </div>
          {afterActions ? (
            <div className="confirm-dialog-after">{afterActions}</div>
          ) : null}
        </div>
      </form>
    </div>,
    document.body,
  );
}

export function Toggle({
  label: caption,
  description,
  checked,
  onChange,
  disabled,
  className,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <label className={"toggle" + (className ? ` ${className}` : "")}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="toggle-track" aria-hidden="true">
        <i />
      </span>
      <span>
        <strong>{caption}</strong>
        {description && <small>{description}</small>}
      </span>
    </label>
  );
}
export function Back({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <Link className="back-link" href={href}>
      <ArrowLeft size={16} />
      {children}
    </Link>
  );
}
export function SearchBox({
  value,
  onChange,
  placeholder = "Search",
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="search">
      <Search size={17} />
      <input
        aria-label={placeholder}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}
// Custom cross-browser date picker — avoids Safari's ugly native calendar popup.
function CalendarPicker({
  value,
  onChange,
  min,
  max,
  onClose,
  anchorRef,
}: {
  value: string;
  onChange: (v: string) => void;
  min?: string;
  max?: string;
  onClose: () => void;
  anchorRef: React.RefObject<HTMLElement | null>;
}) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const parseLocal = (iso: string) => {
    const [y, m, d] = iso.split("-").map(Number);
    return new Date(y, m - 1, d);
  };

  const toISO = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

  const selected = value ? parseLocal(value) : null;
  const [view, setView] = useState<Date>(() => {
    if (selected)
      return new Date(selected.getFullYear(), selected.getMonth(), 1);
    return new Date(today.getFullYear(), today.getMonth(), 1);
  });

  const minDate = min ? parseLocal(min) : null;
  const maxDate = max ? parseLocal(max) : null;

  const year = view.getFullYear();
  const month = view.getMonth();
  const monthLabel = view.toLocaleString("default", {
    month: "long",
    year: "numeric",
  });

  // Build calendar grid
  const firstDay = new Date(year, month, 1).getDay(); // 0=Sun
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (number | null)[] = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  const isDisabled = (d: number) => {
    const dt = new Date(year, month, d);
    if (minDate && dt < minDate) return true;
    if (maxDate && dt > maxDate) return true;
    return false;
  };

  const isSelected = (d: number) =>
    selected &&
    selected.getFullYear() === year &&
    selected.getMonth() === month &&
    selected.getDate() === d;

  const isToday = (d: number) =>
    today.getFullYear() === year &&
    today.getMonth() === month &&
    today.getDate() === d;

  const pick = (d: number) => {
    if (isDisabled(d)) return;
    onChange(toISO(new Date(year, month, d)));
    onClose();
  };

  // Position the popup below the anchor — use layout effect so it runs before paint (no flash)
  const popupRef = useRef<HTMLDivElement | null>(null);
  const [ready, setReady] = useState(false);
  const [pos, setPos] = useState({ top: -9999, left: -9999 });
  useLayoutEffect(() => {
    const anchor = anchorRef.current;
    const popup = popupRef.current;
    if (!anchor || !popup) return;
    const r = anchor.getBoundingClientRect();
    const popupW = popup.offsetWidth || 280;
    let left = r.left + window.scrollX;
    // Clamp so popup doesn't overflow the right edge
    const rightEdge = left + popupW;
    if (rightEdge > window.innerWidth - 8) {
      left = window.scrollX + window.innerWidth - popupW - 8;
    }
    if (left < 8) left = 8;
    setPos({ top: r.bottom + window.scrollY + 4, left });
    setReady(true);
  }, [anchorRef]);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const popup = document.getElementById("tdp-popup");
      const anchor = anchorRef.current;
      if (
        popup &&
        !popup.contains(e.target as Node) &&
        anchor &&
        !anchor.contains(e.target as Node)
      ) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose, anchorRef]);

  const DAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"];

  const popup = (
    <div
      id="tdp-popup"
      ref={popupRef}
      style={{
        position: "absolute",
        top: pos.top,
        left: pos.left,
        zIndex: 9999,
        visibility: ready ? "visible" : "hidden",
      }}
      className="tdp-popup"
    >
      <div className="tdp-header">
        <span className="tdp-month-label">{monthLabel}</span>
        <div className="tdp-nav">
          <button
            type="button"
            className="tdp-nav-btn"
            aria-label="Previous month"
            onClick={() => setView(new Date(year, month - 1, 1))}
          >
            ↑
          </button>
          <button
            type="button"
            className="tdp-nav-btn"
            aria-label="Next month"
            onClick={() => setView(new Date(year, month + 1, 1))}
          >
            ↓
          </button>
        </div>
      </div>
      <div className="tdp-grid">
        {DAY_LABELS.map((l, i) => (
          <span key={i} className="tdp-day-label">
            {l}
          </span>
        ))}
        {cells.map((d, i) =>
          d === null ? (
            <span key={i} />
          ) : (
            <button
              key={i}
              type="button"
              className={
                "tdp-day" +
                (isSelected(d) ? " tdp-selected" : "") +
                (isToday(d) && !isSelected(d) ? " tdp-today" : "") +
                (isDisabled(d) ? " tdp-disabled" : "")
              }
              onClick={() => pick(d)}
              disabled={isDisabled(d)}
            >
              {d}
            </button>
          ),
        )}
      </div>
      <div className="tdp-footer">
        <button
          type="button"
          className="tdp-action"
          onClick={() => {
            onChange("");
            onClose();
          }}
        >
          Clear
        </button>
        <button
          type="button"
          className="tdp-action"
          onClick={() => {
            onChange(toISO(today));
            onClose();
          }}
        >
          Today
        </button>
      </div>
    </div>
  );

  return createPortal(popup, document.body);
}

export function TenantDateInput({
  label: caption,
  value,
  onChange,
  locale,
  dateFormat,
  min,
  max,
  compact,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  locale: string;
  dateFormat: "DD/MM/YYYY" | "MM/DD/YYYY" | "YYYY-MM-DD";
  min?: string;
  max?: string;
  compact?: boolean;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLSpanElement | null>(null);
  const handleClose = useCallback(() => setOpen(false), []);

  return (
    <div
      className={
        (compact ? "compact-control" : "field") +
        " tenant-date-control" +
        (disabled ? " is-disabled" : "")
      }
      onClick={(e) => {
        // Handle clicks on the caption text (outside the input span).
        // Clicks inside .tenant-date-input are handled by the span below.
        if (disabled) return;
        if ((e.target as HTMLElement).closest(".tenant-date-input")) return;
        if ((e.target as HTMLElement).closest(".tdp-popup")) return;
        setOpen((o) => !o);
      }}
    >
      <span>{caption}</span>
      <span
        ref={anchorRef}
        className={"tenant-date-input" + (disabled ? "" : " tdp-trigger")}
        onClick={(e) => {
          if (!disabled) {
            e.stopPropagation(); // don't let this bubble to the label onClick above
            setOpen((o) => !o);
          }
        }}
        role="button"
        tabIndex={disabled ? -1 : 0}
        onKeyDown={(e) => {
          if (!disabled && (e.key === "Enter" || e.key === " ")) {
            e.preventDefault();
            setOpen((o) => !o);
          }
        }}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        {/*
          Dummy input — type="text" readOnly so no native date picker fires in any browser.
          Kept here solely so every existing CSS rule targeting `input` inside
          .tenant-date-input (border, height, background, padding, context overrides) continues
          to apply without any CSS changes. pointer-events:none makes it fully inert to clicks.
        */}
        <input
          type="text"
          readOnly
          tabIndex={-1}
          aria-hidden="true"
          disabled={disabled}
          style={{ pointerEvents: "none", userSelect: "none" }}
        />
        <span aria-hidden="true">
          {value ? dateOnly(value, dateFormat, locale) : dateFormat}
        </span>
      </span>
      {open && (
        <CalendarPicker
          value={value}
          onChange={onChange}
          min={min}
          max={max}
          onClose={handleClose}
          anchorRef={anchorRef}
        />
      )}
    </div>
  );
}
export function More({
  more,
  busy,
  cursor,
  count,
}: {
  more: () => void;
  busy: boolean;
  cursor: string | null;
  count: number;
}) {
  return (
    <div className="list-footer">
      <span>{count} records loaded</span>
      {cursor && (
        <button
          type="button"
          className="button secondary"
          disabled={busy}
          onClick={more}
        >
          {busy ? "Loading…" : "Load more"}
        </button>
      )}
    </div>
  );
}
export function readablePickup(p: {
  kind: string;
  location?: string;
  note?: string;
}) {
  return p.kind === "none"
    ? "No pickup needed"
    : p.kind === "selected"
      ? p.location
      : "Pickup to arrange";
}
