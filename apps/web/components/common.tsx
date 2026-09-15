"use client";
import { useEffect, useId, useState } from "react";
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
        onSubmit={(event) => void submit(event)}
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
  return (
    <label
      className={
        (compact ? "compact-control" : "field") +
        " tenant-date-control" +
        (disabled ? " is-disabled" : "")
      }
    >
      <span>{caption}</span>
      <span className="tenant-date-input">
        <input
          type="date"
          lang={locale}
          value={value}
          min={min}
          max={max}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
        />
        <span aria-hidden="true">
          {value ? dateOnly(value, dateFormat, locale) : dateFormat}
        </span>
      </span>
    </label>
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
