import "server-only";
import { cookies } from "next/headers";

export const sessionCookie = "zettaz_session";
function apiBase() {
  const value = process.env.API_BASE_URL;
  if (!value) throw new Error("API_BASE_URL is not configured");
  const url = new URL(value);
  if (url.username || url.password)
    throw new Error("API base must not contain credentials");
  return url.toString().replace(/\/$/, "");
}
/** HttpOnly session cookie; Secure when WEB_ORIGIN is https (required behind TLS). */
export function sessionCookieOptions(maxAge = 8 * 60 * 60) {
  return {
    httpOnly: true,
    sameSite: "strict" as const,
    secure: Boolean(process.env.WEB_ORIGIN?.startsWith("https://")),
    path: "/",
    maxAge,
  };
}
/** Nest problem+json puts UnauthorizedException text in detail.message (or detail as string). */
export function problemMessage(body: unknown, fallback: string): string {
  if (!body || typeof body !== "object") return fallback;
  const record = body as Record<string, unknown>;
  const detail = record.detail;
  if (typeof detail === "string" && detail.trim()) return detail;
  if (detail && typeof detail === "object") {
    const nested = detail as Record<string, unknown>;
    if (typeof nested.message === "string" && nested.message.trim())
      return nested.message;
    if (Array.isArray(nested.message))
      return nested.message.map(String).join("; ");
    if (typeof nested.detail === "string" && nested.detail.trim())
      return nested.detail;
  }
  if (typeof record.message === "string" && record.message.trim())
    return record.message;
  return fallback;
}
export function validOrigin(request: Request) {
  const configured = process.env.WEB_ORIGIN?.replace(/\/$/, "");
  if (!configured) return false;
  const origin = request.headers.get("origin");
  if (origin === configured) return true;
  // Same-origin GET/fetch often omits Origin; accept matching Referer for non-cors cases.
  if (!origin) {
    const referer = request.headers.get("referer");
    if (referer?.startsWith(`${configured}/`) || referer === configured)
      return true;
  }
  return false;
}
export async function upstream(
  path: string,
  init: RequestInit = {},
  token?: string,
) {
  const credential = token ?? (await cookies()).get(sessionCookie)?.value;
  const pathOnly = path.split("?")[0] ?? path;
  const publicAuth =
    pathOnly === "/auth/v1/sign-in" ||
    pathOnly === "/auth/v1/register" ||
    pathOnly === "/auth/v1/verify-email" ||
    pathOnly === "/auth/v1/invitations/accept" ||
    pathOnly.startsWith("/auth/v1/password-recovery/");
  if (!credential && !publicAuth)
    return Response.json({ message: "Sign in to continue." }, { status: 401 });
  return fetch(apiBase() + path, {
    ...init,
    redirect: "error",
    cache: "no-store",
    signal: AbortSignal.timeout(15000),
    headers: {
      "Content-Type": "application/json",
      ...(credential ? { Authorization: `Bearer ${credential}` } : {}),
      ...init.headers,
    },
  });
}
export function unavailable() {
  return Response.json(
    {
      message:
        "The workspace service is unavailable. Start npm run workspace:dev and try again.",
    },
    { status: 503, headers: { "Cache-Control": "no-store" } },
  );
}
