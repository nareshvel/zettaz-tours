"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Page } from "./types";
let tenantContext: { id: string; name: string } | null = null;
export function setTenantContext(
  tenant: { id: string; name: string } | string | null,
) {
  if (!tenant) {
    tenantContext = null;
    return;
  }
  if (typeof tenant === "string") {
    tenantContext = { id: tenant, name: tenantContext?.name ?? "" };
    return;
  }
  tenantContext = { id: tenant.id, name: tenant.name.trim() };
}
function sessionExpiredMessage() {
  const name = tenantContext?.name;
  if (name) return `Your session expired. Switch or reopen ${name}.`;
  return "Your session expired. Sign in again to reopen your workspace.";
}
export function errorText(data: unknown): string {
  if (typeof data === "string") return data;
  if (Array.isArray(data)) return data.map(errorText).join("; ");
  if (data && typeof data === "object") {
    const d = data as Record<string, unknown>;
    if (d.message) return errorText(d.message);
    if (d.detail) return errorText(d.detail);
  }
  return "Something went wrong. Please try again.";
}
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch("/api/gateway/" + path, {
    ...init,
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      ...(tenantContext ? { "X-Tenant-Id": tenantContext.id } : {}),
      ...init.headers,
    },
  });
  const data = await res.json();
  if (!res.ok)
    throw new Error(
      res.status === 401 ? sessionExpiredMessage() : errorText(data),
    );
  return data;
}
export async function downloadApiFile(path: string, fallbackName: string) {
  const res = await fetch("/api/gateway/" + path, {
    cache: "no-store",
    headers: tenantContext ? { "X-Tenant-Id": tenantContext.id } : {},
  });
  if (!res.ok) {
    const contentType = res.headers.get("content-type") ?? "";
    const detail = contentType.includes("json")
      ? await res.json()
      : await res.text();
    throw new Error(errorText(detail));
  }
  const disposition = res.headers.get("content-disposition") ?? "";
  const filename =
    disposition.match(/filename="?([^";]+)"?/i)?.[1] ?? fallbackName;
  const url = URL.createObjectURL(await res.blob());
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
export function useResource<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null),
    [error, setError] = useState(""),
    [revision, reload] = useState(0);
  useEffect(() => {
    if (!path) {
      setData(null);
      setError("");
      return;
    }
    const abort = new AbortController();
    setData(null);
    setError("");
    api<T>(path, { signal: abort.signal })
      .then(setData)
      .catch((e) => {
        if (!abort.signal.aborted) setError(e.message);
      });
    return () => abort.abort();
  }, [path, revision]);
  return { data, error, reload: () => reload((v) => v + 1) };
}
export function usePaged<T>(
  path: string,
  search = "",
  filters: Record<string, string> = {},
  limit = 30,
) {
  const [items, setItems] = useState<T[]>([]),
    [cursor, setCursor] = useState<string | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [revision, setRevision] = useState(0);
  const generation = useRef(0);
  const load = useCallback(
    async (after: string | null) => {
      const gen = generation.current;
      setBusy(true);
      setError("");
      try {
        const query = new URLSearchParams({ search, limit: String(limit) });
        Object.entries(filters).forEach(([name, value]) => {
          if (value) query.set(name, value);
        });
        if (after) query.set("cursor", after);
        const page = await api<Page<T>>(path + "?" + query);
        if (gen !== generation.current) return;
        setItems((old) => (after ? [...old, ...page.items] : page.items));
        setCursor(page.nextCursor);
      } catch (e) {
        if (gen === generation.current) setError((e as Error).message);
      } finally {
        if (gen === generation.current) setBusy(false);
      }
    },
    [path, search, JSON.stringify(filters), limit],
  );
  useEffect(() => {
    generation.current++;
    setItems([]);
    setCursor(null);
    void load(null);
    return () => {
      generation.current++;
    };
  }, [load, revision]);
  return {
    items,
    cursor,
    error,
    busy,
    more: () => load(cursor),
    reload: () => setRevision((v) => v + 1),
  };
}
export function useMutation() {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const flight = useRef(false),
    pending = useRef<{ signature: string; key: string } | null>(null);
  const run = async <T>(
    path: string,
    body: unknown,
    method = "POST",
  ): Promise<T | undefined> => {
    if (flight.current) return;
    flight.current = true;
    setBusy(true);
    setError("");
    const signature = JSON.stringify({ path, body, method });
    if (pending.current?.signature !== signature)
      pending.current = { signature, key: crypto.randomUUID() };
    try {
      const result = await api<T>(path, {
        method,
        body: JSON.stringify(body),
        headers: { "Idempotency-Key": pending.current.key },
      });
      pending.current = null;
      return result;
    } catch (e) {
      setError((e as Error).message);
    } finally {
      flight.current = false;
      setBusy(false);
    }
  };
  return { busy, error, run, clear: () => setError("") };
}
export function priceFromMinor(product: {
  price_from_minor?: number | null;
  definition?: { rates?: { amountMinor: number }[] };
}) {
  const listed =
    product.price_from_minor != null ? Number(product.price_from_minor) : NaN;
  if (Number.isFinite(listed) && listed > 0) return listed;
  const amounts = (product.definition?.rates ?? [])
    .map((rate) => rate.amountMinor)
    .filter((amount) => amount > 0);
  return amounts.length ? Math.min(...amounts) : null;
}
export function money(amount: number, currency: string, locale = "en") {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    currencyDisplay: "symbol",
  }).format(amount / 10 ** digits(currency));
}
export function dateOnly(
  value: string,
  format: "DD/MM/YYYY" | "MM/DD/YYYY" | "YYYY-MM-DD",
  locale = "en",
) {
  const date = new Date(value.length === 10 ? `${value}T12:00:00Z` : value);
  const parts = new Intl.DateTimeFormat(locale, {
    timeZone: "UTC",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).formatToParts(date);
  const part = (type: string) =>
    parts.find((item) => item.type === type)?.value ?? "";
  return format
    .replace("DD", part("day"))
    .replace("MM", part("month"))
    .replace("YYYY", part("year"));
}
/** e.g. Sep 01, 2026 — for schedule periods and readable ranges */
export function formatMediumDate(value: string, locale = "en") {
  const date = new Date(value.length === 10 ? `${value}T12:00:00Z` : value);
  return new Intl.DateTimeFormat(locale, {
    timeZone: "UTC",
    month: "short",
    day: "2-digit",
    year: "numeric",
  }).format(date);
}
export function formatMediumDateRange(
  start: string,
  end: string,
  locale = "en",
) {
  return `${formatMediumDate(start, locale)} - ${formatMediumDate(end, locale)}`;
}
export function digits(currency: string) {
  return (
    new Intl.NumberFormat("en", {
      style: "currency",
      currency,
    }).resolvedOptions().maximumFractionDigits ?? 2
  );
}
export function minor(value: string, currency: string) {
  const precision = digits(currency);
  if (!new RegExp(`^\\d+(?:\\.\\d{1,${precision || 1}})?$`).test(value))
    throw new Error("Enter a valid amount.");
  if (precision === 0 && value.includes("."))
    throw new Error("This currency uses whole units.");
  const [whole, fraction = ""] = value.split(".");
  const result =
    Number(whole) * 10 ** precision + Number(fraction.padEnd(precision, "0"));
  if (!Number.isSafeInteger(result)) throw new Error("Amount is too large.");
  return result;
}
export function dateTime(
  value: string,
  timezone: string,
  locale = "en",
  dateFormat?: "DD/MM/YYYY" | "MM/DD/YYYY" | "YYYY-MM-DD",
  timeFormat?: "12h" | "24h",
) {
  const options: Intl.DateTimeFormatOptions = {
    timeZone: timezone,
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    ...(timeFormat ? { hour12: timeFormat === "12h" } : {}),
  };
  const date = new Date(value);
  if (!dateFormat) return new Intl.DateTimeFormat(locale, options).format(date);
  const parts = new Intl.DateTimeFormat(locale, {
    ...options,
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const part = (type: string) =>
    parts.find((item) => item.type === type)?.value ?? "";
  const formattedDate = dateFormat
    .replace("DD", part("day"))
    .replace("MM", part("month"))
    .replace("YYYY", part("year"));
  const formattedTime = [part("hour"), part("minute")]
    .filter(Boolean)
    .join(":");
  return `${formattedDate}, ${formattedTime}${part("dayPeriod") ? ` ${part("dayPeriod")}` : ""}`;
}
export function friendlyDateTime(
  value: string,
  timezone: string,
  locale = "en",
  timeFormat: "12h" | "24h" = "12h",
) {
  const date = new Date(value);
  const day = new Intl.DateTimeFormat(locale, {
    timeZone: timezone,
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
  const time = new Intl.DateTimeFormat(locale, {
    timeZone: timezone,
    hour: "numeric",
    minute: "2-digit",
    hour12: timeFormat === "12h",
  }).format(date);
  return `${day} ${time}`;
}
export function label(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
