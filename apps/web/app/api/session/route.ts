import { cookies } from "next/headers";
import {
  problemMessage,
  platformParkCookie,
  sessionCookie,
  sessionCookieOptions,
  unavailable,
  upstream,
  validOrigin,
} from "@/lib/server";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    const cookie = (await cookies()).get(sessionCookie);
    let session = null;
    let tenants: unknown[] = [];
    if (cookie) {
      const res = await upstream("/staff/v1/workspace/session");
      if (res.ok) {
        session = await res.json();
        const memberships = await upstream("/auth/v1/tenants");
        if (memberships.ok) tenants = (await memberships.json()).tenants;
      } else if (res.status !== 401) throw new Error("Session check failed");
    }
    return Response.json(
      {
        tenants: tenants.map((tenant: any) => ({
          tenantId: tenant.tenant_id,
          name: tenant.name,
          email: tenant.email,
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
    const existing = (await cookies()).get(sessionCookie)?.value;
    if (input.resumePlatform === true) {
      const parked = (await cookies()).get(platformParkCookie)?.value;
      if (!parked)
        return Response.json(
          { message: "No platform session to resume." },
          { status: 400 },
        );
      const res = await upstream("/staff/v1/workspace/session", {}, parked);
      if (!res.ok)
        return Response.json(
          { message: "Platform session could not be resumed." },
          { status: 401 },
        );
      const session = await res.json();
      if (session.role !== "platform")
        return Response.json(
          { message: "Parked session is not a platform administrator." },
          { status: 401 },
        );
      if (existing)
        await upstream("/auth/v1/sign-out", { method: "POST" }, existing);
      const jar = await cookies();
      jar.set(sessionCookie, parked, sessionCookieOptions());
      jar.delete({
        name: platformParkCookie,
        path: "/",
        secure: Boolean(process.env.WEB_ORIGIN?.startsWith("https://")),
      });
      return Response.json(
        { session, tenants: [] },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
    if (typeof input.grantId === "string") {
      if (!existing)
        return Response.json({ message: "Sign in required." }, { status: 401 });
      const used = await upstream(
        `/platform/v1/support-access/${input.grantId}/use`,
        { method: "POST", body: "{}" },
        existing,
      );
      if (!used.ok) {
        const body = await used.json().catch(() => ({}));
        return Response.json(
          {
            message: problemMessage(
              body,
              "Support grant is unavailable or expired.",
            ),
          },
          { status: used.status === 403 ? 403 : 400 },
        );
      }
      const issued = await used.json();
      const res = await upstream(
        "/staff/v1/workspace/session",
        {},
        issued.token,
      );
      if (!res.ok)
        return Response.json(
          { message: "Support session could not be established." },
          { status: 401 },
        );
      const jar = await cookies();
      jar.set(platformParkCookie, existing, sessionCookieOptions());
      jar.set(sessionCookie, issued.token, sessionCookieOptions());
      return Response.json(
        { session: await res.json(), tenants: [] },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
    // _rawToken: set directly after self-registration (no additional auth call needed)
    if (input._rawToken) {
      const res = await upstream(
        "/staff/v1/workspace/session",
        {},
        input._rawToken,
      );
      if (!res.ok)
        return Response.json(
          { message: "Registration session could not be established." },
          { status: 401 },
        );
      (await cookies()).set(
        sessionCookie,
        input._rawToken,
        sessionCookieOptions(),
      );
      const tenants = input.tenantId
        ? [{ tenantId: input.tenantId, name: "", email: "" }]
        : [];
      return Response.json(
        { session: await res.json(), tenants },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
    const auth = input.activationToken
      ? await upstream("/auth/v1/invitations/accept", {
          method: "POST",
          body: JSON.stringify({
            token: input.activationToken,
            password: input.password,
          }),
        })
      : existing && !input.password
        ? await upstream(
            "/auth/v1/switch-tenant",
            {
              method: "POST",
              body: JSON.stringify({ tenantId: input.tenantId }),
            },
            existing,
          )
        : await upstream("/auth/v1/sign-in", {
            method: "POST",
            body: JSON.stringify({
              email: input.email,
              password: input.password,
              tenantId: input.tenantId || undefined,
            }),
          });
    if (!auth.ok) {
      const body = await auth.json();
      return Response.json(
        {
          message: problemMessage(body, "Email or password is incorrect."),
        },
        { status: auth.status === 401 ? 401 : 400 },
      );
    }
    const signedIn = await auth.json();
    const res = await upstream(
      "/staff/v1/workspace/session",
      {},
      signedIn.token,
    );
    if (!res.ok)
      return Response.json(
        { message: "Sign-in session could not be established." },
        { status: 401 },
      );
    (await cookies()).set(
      sessionCookie,
      signedIn.token,
      sessionCookieOptions(),
    );
    return Response.json(
      {
        session: await res.json(),
        tenants: (signedIn.tenants ?? []).map((tenant: any) => ({
          tenantId: tenant.tenant_id,
          name: tenant.name,
          email: tenant.email,
        })),
      },
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
  try {
    const current = (await cookies()).get(sessionCookie)?.value;
    const parked = (await cookies()).get(platformParkCookie)?.value;
    if (current)
      await upstream(
        new URL(request.url).searchParams.get("all") === "true"
          ? "/auth/v1/sign-out-all"
          : "/auth/v1/sign-out",
        { method: "POST" },
        current,
      );
    if (parked && parked !== current)
      await upstream("/auth/v1/sign-out", { method: "POST" }, parked);
  } finally {
    const secure = Boolean(process.env.WEB_ORIGIN?.startsWith("https://"));
    (await cookies()).delete({
      name: sessionCookie,
      path: "/",
      secure,
    });
    (await cookies()).delete({
      name: platformParkCookie,
      path: "/",
      secure,
    });
  }
  return Response.json({ ok: true });
}
