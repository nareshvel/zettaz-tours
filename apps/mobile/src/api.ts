import { API } from "./config";

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export const requestKey = () =>
  `mobile_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`;

function readMessage(data: unknown, fallback: string) {
  if (!data || typeof data !== "object") return fallback;
  const record = data as Record<string, unknown>;
  const detail = record.detail;
  if (typeof detail === "string" && detail.trim()) return detail;
  if (detail && typeof detail === "object") {
    const nested = detail as Record<string, unknown>;
    if (typeof nested.message === "string" && nested.message.trim())
      return nested.message;
  }
  if (typeof record.message === "string" && record.message.trim())
    return record.message;
  return fallback;
}

export function networkMessage(reason: unknown) {
  const text = reason instanceof Error ? reason.message : String(reason);
  if (
    reason instanceof TypeError ||
    /network request failed|failed to fetch|aborted|timed out/i.test(text)
  )
    return "Can't reach Zettaz. Check your connection and try again.";
  return text || "Request failed";
}

export function isUnauthorized(reason: unknown) {
  if (reason instanceof ApiError && reason.status === 401) return true;
  const text = reason instanceof Error ? reason.message : String(reason);
  return /unauthor|sign in to continue/i.test(text);
}

export async function call<T>(
  path: string,
  token?: string,
  init: RequestInit = {},
) {
  let response: Response;
  try {
    response = await fetch(`${API}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...init.headers,
      },
    });
  } catch (reason) {
    throw new ApiError(networkMessage(reason), 0);
  }
  let data: unknown = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }
  if (!response.ok)
    throw new ApiError(
      readMessage(data, networkMessage(new Error("Request failed"))),
      response.status,
    );
  return data as T;
}
