"use client";
import { ArrowLeft, Search } from "lucide-react";
import Link from "next/link";
import { label } from "@/lib/client";
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
      <div>
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h1>{title}</h1>
        {description && <p className="subtitle">{description}</p>}
      </div>
      {action}
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
  return (
    <span className={"status " + state}>
      {state === "held" ? "On hold" : label(state)}
    </span>
  );
}
export function Field({
  label: caption,
  children,
  hint,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <label className="field">
      <span>{caption}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}
export function Toggle({
  label: caption,
  description,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className="toggle">
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
