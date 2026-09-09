"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Page } from "./types";
let tenantContext: string | null = null;
export function setTenantContext(tenantId: string | null) {
  tenantContext = tenantId;
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
      ...(tenantContext ? { "X-Tenant-Id": tenantContext } : {}),
      ...init.headers,
    },
  });
  const data = await res.json();
  if (!res.ok)
    throw new Error(
      res.status === 401
        ? "Your session expired. Switch or reopen the demo tenant."
        : errorText(data),
    );
  return data;
}
export function useResource<T>(path: string) {
  const [data, setData] = useState<T | null>(null),
    [error, setError] = useState(""),
    [revision, reload] = useState(0);
  useEffect(() => {
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
export function usePaged<T>(path: string, search = "") {
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
        const query = new URLSearchParams({ search, limit: "30" });
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
    [path, search],
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
export function money(amount: number, currency: string) {
  return new Intl.NumberFormat("en", {
    style: "currency",
    currency,
    currencyDisplay: "code",
  }).format(amount / 10 ** digits(currency));
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
export function dateTime(value: string, timezone: string) {
  return new Intl.DateTimeFormat("en", {
    timeZone: timezone,
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}
export function label(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
