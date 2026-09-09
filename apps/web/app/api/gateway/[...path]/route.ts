import { unavailable, upstream, validOrigin } from "@/lib/server";
export const dynamic = "force-dynamic";
const paths: Record<string, RegExp> = {
  GET: /^(staff\/v1\/workspace\/(session|departures|reservations|members|summary)|admin\/v1\/(tenant|products)|staff\/v1\/bookings\/[a-f0-9-]{36}(\/changes)?|ops\/v1\/(audit|board|pickup-locations|departures\/[a-f0-9-]{36}\/(manifest|pickups|pickup-list)))$/,
  POST: /^(admin\/v1\/(products|schedules|members)|staff\/v1\/(holds|bookings|bookings\/[a-f0-9-]{36}\/(payments|confirm|change-quotes|changes|cancel))|ops\/v1\/(pickup-locations|departures\/[a-f0-9-]{36}\/(pickups|operational-status)))$/,
  PATCH: /^admin\/v1\/(tenant\/config|members\/[a-f0-9-]{36})$/,
};
async function handle(
  request: Request,
  context: { params: Promise<{ path: string[] }> },
) {
  const path = (await context.params).path.join("/");
  if (!paths[request.method]?.test(path))
    return Response.json({ message: "Route unavailable." }, { status: 404 });
  if (request.method !== "GET" && !validOrigin(request))
    return Response.json(
      { message: "Request origin rejected." },
      { status: 403 },
    );
  try {
    const identityResponse = await upstream("/staff/v1/workspace/session");
    if (!identityResponse.ok)
      return new Response(await identityResponse.text(), {
        status: identityResponse.status,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
        },
      });
    const identity = await identityResponse.json();
    if (request.headers.get("x-tenant-id") !== identity.tenant.id)
      return Response.json(
        {
          message:
            "The active tenant changed. Reload this tab before continuing.",
        },
        { status: 409, headers: { "Cache-Control": "no-store" } },
      );
    const body = request.method === "GET" ? undefined : await request.text();
    if (body && Buffer.byteLength(body) > 65536)
      return Response.json(
        { message: "Request is too large." },
        { status: 413 },
      );
    const res = await upstream("/" + path + new URL(request.url).search, {
      method: request.method,
      body,
      headers:
        request.method === "GET"
          ? {}
          : { "Idempotency-Key": request.headers.get("idempotency-key") ?? "" },
    });
    return new Response(await res.text(), {
      status: res.status,
      headers: {
        "Content-Type": res.headers.get("content-type") ?? "application/json",
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return unavailable();
  }
}
export const GET = handle;
export const POST = handle;
export const PATCH = handle;
