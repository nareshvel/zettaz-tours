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

export function crewLoadMessage(reason: unknown) {
  if (reason instanceof ApiError && reason.status === 403)
    return "This screen is limited to assigned crew trips. Desk tools appear on a tablet when your role can run the Day Board.";
  const text = reason instanceof Error ? reason.message : String(reason);
  if (/^forbidden$/i.test(text))
    return "This screen is limited to assigned crew trips. Desk tools appear on a tablet when your role can run the Day Board.";
  return text;
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
  const contentType = response.headers.get("content-type") ?? "";
  let data: unknown = null;
  if (
    contentType.includes("application/json") ||
    contentType.includes("problem+json")
  ) {
    try {
      data = await response.json();
    } catch {
      data = null;
    }
  } else {
    throw new ApiError(
      "Can't reach the crew service. The mobile API is not live on this server yet.",
      response.status,
    );
  }
  if (!response.ok)
    throw new ApiError(
      readMessage(data, networkMessage(new Error("Request failed"))),
      response.status,
    );
  if (!data || typeof data !== "object")
    throw new ApiError("Crew service returned an empty response.", response.status);
  return data as T;
}

export async function downloadPdf(path: string, token: string) {
  let response: Response;
  try {
    response = await fetch(`${API}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch (reason) {
    throw new ApiError(networkMessage(reason), 0);
  }
  if (!response.ok) {
    let message = "Could not download the document.";
    try {
      const data = await response.json();
      message = readMessage(data, message);
    } catch {
      /* binary error bodies stay generic */
    }
    throw new ApiError(message, response.status);
  }
  const bytes = await response.arrayBuffer();
  const disposition = response.headers.get("content-disposition") ?? "";
  const match = disposition.match(/filename="?([^"]+)"?/i);
  return {
    bytes,
    filename: match?.[1] ?? "document.pdf",
  };
}
