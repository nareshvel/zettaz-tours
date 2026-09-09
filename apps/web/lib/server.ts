import "server-only";
import { readFile } from "node:fs/promises";
import { cookies } from "next/headers";

type DemoFile = {
  base: string;
  tenants: { tenantId: string; name: string; token: string }[];
};
export const sessionCookie = "zettaz_session";
export async function demoAccess(): Promise<DemoFile> {
  if (process.env.ZETTAZ_DEMO_WEB !== "1" || !process.env.DEMO_ACCESS_FILE)
    throw new Error("Demo web access is not configured");
  const data = JSON.parse(
    await readFile(process.env.DEMO_ACCESS_FILE, "utf8"),
  ) as DemoFile;
  const url = new URL(data.base);
  if (
    url.protocol !== "http:" ||
    url.hostname !== "127.0.0.1" ||
    url.username ||
    url.password
  )
    throw new Error("Only a loopback demo API is allowed");
  return data;
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
  const data = await demoAccess();
  const credential = token ?? (await cookies()).get(sessionCookie)?.value;
  if (!credential)
    return Response.json(
      { message: "Choose a demo tenant to continue." },
      { status: 401 },
    );
  return fetch(data.base + path, {
    ...init,
    redirect: "error",
    cache: "no-store",
    signal: AbortSignal.timeout(15000),
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${credential}`,
      ...init.headers,
    },
  });
}
export function unavailable() {
  return Response.json(
    {
      message:
        "The local demo is unavailable. Start npm run demo:web and try again.",
    },
    { status: 503, headers: { "Cache-Control": "no-store" } },
  );
}
