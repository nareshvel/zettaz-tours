import { cookies } from "next/headers";
import {
  demoAccess,
  sessionCookie,
  unavailable,
  upstream,
  validOrigin,
} from "@/lib/server";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    const data = await demoAccess();
    const cookie = (await cookies()).get(sessionCookie);
    let session = null;
    if (cookie) {
      const res = await upstream("/staff/v1/workspace/session");
      if (res.ok) session = await res.json();
      else if (res.status !== 401) throw new Error("Session check failed");
    }
    return Response.json(
      {
        tenants: data.tenants.map((t) => ({
          tenantId: t.tenantId,
          name: t.name,
        })),
        session,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return unavailable();
  }
}
export async function POST(request: Request) {
  if (!validOrigin(request))
    return Response.json(
      { message: "Request origin rejected." },
      { status: 403 },
    );
  try {
    const input = await request.json();
    const data = await demoAccess();
    const selected = data.tenants.find((t) => t.tenantId === input.tenantId);
    if (!selected)
      return Response.json(
        { message: "Unknown demo tenant." },
        { status: 400 },
      );
    const res = await upstream(
      "/staff/v1/workspace/session",
      {},
      selected.token,
    );
    if (!res.ok)
      return Response.json(
        { message: "Demo session expired. Restart the demo." },
        { status: 401 },
      );
    (await cookies()).set(sessionCookie, selected.token, {
      httpOnly: true,
      sameSite: "strict",
      secure: false,
      path: "/",
      maxAge: 8 * 60 * 60,
    });
    return Response.json(
      { session: await res.json() },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return unavailable();
  }
}
export async function DELETE(request: Request) {
  if (!validOrigin(request))
    return Response.json(
      { message: "Request origin rejected." },
      { status: 403 },
    );
  (await cookies()).delete(sessionCookie);
  return Response.json({ ok: true });
}
