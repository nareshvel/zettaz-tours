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
export function validOrigin(request: Request) {
  return (
    Boolean(process.env.WEB_ORIGIN) &&
    request.headers.get("origin") === process.env.WEB_ORIGIN
  );
}
export async function upstream(
  path: string,
  init: RequestInit = {},
  token?: string,
) {
  const credential = token ?? (await cookies()).get(sessionCookie)?.value;
  const publicAuth = path === "/auth/v1/sign-in" || path === "/auth/v1/register" || path === "/auth/v1/invitations/accept" || path.startsWith("/auth/v1/password-recovery/");
  if (!credential && !publicAuth)
    return Response.json(
      { message: "Choose a demo tenant to continue." },
      { status: 401 },
    );
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
