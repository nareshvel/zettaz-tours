"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Page } from "./types";
let tenantContext: { id: string; name: string } | null = null;

/**
 * How this tenant's numbers and dates are written.
 *
 * Kept as module state beside the tenant context because formatting is needed
 * in ~90 places, most of them deep in render code with no reason to know about
 * settings. Before this, money() simply defaulted to "en", so a tenant that had
 * chosen French or a decimal comma still saw English grouping nearly
 * everywhere — the setting existed and changed nothing.
 */
let formatContext = { locale: "en", numberLocale: "en-US" };

/**
 * numberFormat is a convention, not a language: a tenant may run the workspace
 * in English and still write 1.234,56. Intl offers no way to set separators
 * directly, so each convention maps to a locale known to produce it, used ONLY
 * for numbers. Month and day names keep the display language.
 */
export function numberLocaleFor(numberFormat?: string) {
  return numberFormat === "decimal_comma" ? "de-DE" : "en-US";
}

export function setFormatContext(
  config: { locale?: string; numberFormat?: string } | null,
) {
  formatContext = {
    locale: config?.locale || "en",
    numberLocale: numberLocaleFor(config?.numberFormat),
  };
}

/** The tenant's display language, for callers that format dates themselves. */
export function activeLocale() {
  return formatContext.locale;
}
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
/**
 * Whether the last request to the server actually reached it.
 *
 * Only a transport failure counts as offline: a 4xx or 5xx means the server
 * answered and the connection is fine. Staff work on dock and harbour wifi
 * where the link drops without the browser saying so, and a manifest that
 * quietly stops updating is worse than one that says it is stale.
 */
type Reachability = "online" | "offline";
let reachability: Reachability = "online";
const reachabilityListeners = new Set<(state: Reachability) => void>();

function setReachability(next: Reachability) {
  if (reachability === next) return;
  reachability = next;
  for (const listener of reachabilityListeners) listener(next);
}

export function subscribeReachability(listener: (state: Reachability) => void) {
  reachabilityListeners.add(listener);
  return () => reachabilityListeners.delete(listener);
}

export function currentReachability() {
  return reachability;
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch("/api/gateway/" + path, {
      ...init,
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        ...(tenantContext ? { "X-Tenant-Id": tenantContext.id } : {}),
        ...init.headers,
      },
    });
  } catch (networkError) {
    setReachability("offline");
    throw networkError;
  }
  setReachability("online");
  const data = await res.json();
  if (!res.ok)
    throw new Error(
      res.status === 401 ? sessionExpiredMessage() : errorText(data),
    );
  return data;
}
/** Fetches a generated file as a Blob. Used both to save a document and to
 *  hand the identical bytes to the local print agent, so what a guest is given
 *  and what comes off the printer can never differ. */
export async function fetchApiFile(path: string, fallbackName: string) {
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
  return { blob: await res.blob(), filename };
}

export async function downloadApiFile(path: string, fallbackName: string) {
  const { blob, filename } = await fetchApiFile(path, fallbackName);
  const url = URL.createObjectURL(blob);
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
export function money(amount: number, currency: string, locale?: string) {
  const resolved = locale || formatContext.numberLocale;
  return new Intl.NumberFormat(resolved, {
    style: "currency",
    currency,
    currencyDisplay: "symbol",
  }).format(amount / 10 ** digits(currency));
}
export function dateOnly(
  value: string,
  format: "DD/MM/YYYY" | "MM/DD/YYYY" | "YYYY-MM-DD",
  locale?: string,
) {
  const date = new Date(value.length === 10 ? `${value}T12:00:00Z` : value);
  const parts = new Intl.DateTimeFormat(locale || formatContext.locale, {
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
export function formatMediumDate(value: string, locale?: string) {
  const date = new Date(value.length === 10 ? `${value}T12:00:00Z` : value);
  return new Intl.DateTimeFormat(locale || formatContext.locale, {
    timeZone: "UTC",
    month: "short",
    day: "2-digit",
    year: "numeric",
  }).format(date);
}
export function formatMediumDateRange(
  start: string,
  end: string,
  locale?: string,
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
  locale?: string,
  dateFormat?: "DD/MM/YYYY" | "MM/DD/YYYY" | "YYYY-MM-DD",
  timeFormat?: "12h" | "24h",
) {
  const resolved = locale || formatContext.locale;
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
  if (!dateFormat)
    return new Intl.DateTimeFormat(resolved, options).format(date);
  const parts = new Intl.DateTimeFormat(resolved, {
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
  locale?: string,
  timeFormat: "12h" | "24h" = "12h",
) {
  const resolved = locale || formatContext.locale;
  const date = new Date(value);
  const day = new Intl.DateTimeFormat(resolved, {
    timeZone: timezone,
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
  const time = new Intl.DateTimeFormat(resolved, {
    timeZone: timezone,
    hour: "numeric",
    minute: "2-digit",
    hour12: timeFormat === "12h",
  }).format(date);
  return `${day} ${time}`;
}
/**
 * Display names for the configurable code lists. A few codes carry meaning that
 * a plain humanisation would lose, so they are spelled out. Shared rather than
 * redefined per screen, so Settings, the booking form and the boarding gate all
 * call the same thing by the same name.
 */
export function paymentMethodLabel(method: string) {
  if (method === "reseller_payment") return "Guest payment via reseller";
  if (method === "zettaz_pay") return "Zettaz Pay";
  return label(method);
}

export function bookingSourceLabel(source: string) {
  if (source === "partner_reseller") return "Partner / reseller";
  return label(source);
}

/** Turns a typed display name into a code matching the `slug` contract. */
export function codeFromName(name: string) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 50);
}

export function label(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
