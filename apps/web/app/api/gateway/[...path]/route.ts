import { unavailable, upstream, validOrigin } from "@/lib/server";
export const dynamic = "force-dynamic";
const paths: Record<string, RegExp> = {
  GET: /^(crew\/v1\/today|staff\/v1\/(workspace\/(session|departures|reservations|members|roles|summary|briefing|notifications|subscription)|customers(?:\/[a-f0-9-]{36})?|departures\/[a-f0-9-]{36}\/availability|bookings\/[a-f0-9-]{36}(\/(changes|passengers|notifications))?)|admin\/v1\/(tenant(?:\/readiness)?|products(?:\/[a-f0-9-]{36})?|availability-rules(?:\/[a-f0-9-]{36})?|invitations|support-access)|integrations\/v1\/(accounts|mappings|inbox|assisted-imports)|finance\/v1\/(partners(?:\/available|\/[a-f0-9-]{36}\/(?:bookings\/unsettled|settlements(?:\/[a-f0-9-]{36})?))?|partner-claims|partner-statements|partner-finance-summary|bookings\/[a-f0-9-]{36}\/finance-summary)|ops\/v1\/(audit|board|resources|crew|compliance-documents(?:\/[a-f0-9-]{36}\/file)?|document-library\/usage|assignments|print-templates|print-jobs(?:\/[a-f0-9-]{36}\/pdf)?|pickup-locations|waiver-templates|stays\/(options|vessels)|bookings\/[a-f0-9-]{36}\/waivers|passengers\/[a-f0-9-]{36}\/waiver|departures\/[a-f0-9-]{36}\/(manifest|pickups|pickup-list|assignments|rebooking-options)))$/,
  POST: /^(auth\/v1\/(register|change-password|password-recovery\/(request|complete))|admin\/v1\/(tenant\/logo|products|schedules|members|staff(?:\/[a-f0-9-]{36}\/grant-access)?|roles|invitations|support-access\/[a-f0-9-]{36}\/(decision|revoke))|integrations\/v1\/(accounts|mappings|assisted-imports|inbox\/[a-f0-9-]{36}\/review)|staff\/v1\/(workspace\/(checkout|billing-portal|switch-plan)|holds|overbook-holds|bookings|bookings\/[a-f0-9-]{36}\/(payments(?:\/[a-f0-9-]{36}\/adjustments)?|confirm|revive-hold|concession|change-quotes|changes|cancel|passengers(?:\/corrections)?|boarding-roster|notifications(?:\/[a-f0-9-]{36}\/retry)?)|passengers\/[a-f0-9-]{36}\/(checkin|checkin-token)|crew\/checkin-token\/resolve)|crew\/v1\/departures\/[a-f0-9-]{36}\/events|finance\/v1\/(partners(?:\/[a-f0-9-]{36}\/(?:status|bookings|settlements))?|partner-claims(?:\/[a-f0-9-]{36}\/decision)?)|ops\/v1\/(resources|crew|compliance-documents|assignments|print-templates|print-jobs(?:\/[a-f0-9-]{36}\/outcome)?|pickup-locations|waiver-templates|stays\/(vessels|accommodations)|bookings\/[a-f0-9-]{36}\/(waivers|checkin)|passengers\/[a-f0-9-]{36}\/waiver|departures\/[a-f0-9-]{36}\/(pickups|operational-status|start|unstart|itinerary|rebooking-preview|rebook)))$/,
  PATCH:
    /^(admin\/v1\/(tenant\/(config|profile)|members\/[a-f0-9-]{36}|staff\/[a-f0-9-]{36}|products\/[a-f0-9-]{36}|availability-rules\/[a-f0-9-]{36})|integrations\/v1\/accounts\/[a-f0-9-]{36}|staff\/v1\/workspace\/profile|ops\/v1\/(resources\/[a-f0-9-]{36}|crew\/[a-f0-9-]{36}|compliance-documents\/[a-f0-9-]{36}|assignments\/[a-f0-9-]{36}|pickup-locations\/[a-f0-9-]{36})|finance\/v1\/partners\/[a-f0-9-]{36}(?:\/(commission|settlements\/[a-f0-9-]{36}))?|ops\/v1\/stays\/vessels\/[a-f0-9-]{36})$/,
  DELETE:
    /^(ops\/v1\/(resources\/[a-f0-9-]{36}|crew\/[a-f0-9-]{36}|compliance-documents\/[a-f0-9-]{36}|assignments\/[a-f0-9-]{36}|pickup-locations\/[a-f0-9-]{36}|waiver-templates\/[a-f0-9-]{36})|finance\/v1\/partners\/[a-f0-9-]{36}\/bookings\/[a-f0-9-]{36})$/,
};
async function handle(
  request: Request,
  context: { params: Promise<{ path: string[] }> },
) {
  const path = (await context.params).path.join("/");
  const reportRead = request.method === "GET" && path === "reports/v1/overview";
  const connectorCatalogRead =
    request.method === "GET" && path === "integrations/v1/catalog";
  const importReportRead =
    request.method === "GET" &&
    /^integrations\/v1\/assisted-imports\/[a-f0-9-]{36}\/report$/.test(path);
  if (
    !reportRead &&
    !connectorCatalogRead &&
    !importReportRead &&
    !paths[request.method]?.test(path)
  )
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
    const multipart = request.headers
      .get("content-type")
      ?.startsWith("multipart/form-data");
    const body =
      request.method === "GET"
        ? undefined
        : multipart
          ? await request.arrayBuffer()
          : await request.text();
    const tooLarge = multipart
      ? body instanceof ArrayBuffer && body.byteLength > 11 * 1024 * 1024
      : typeof body === "string" && Buffer.byteLength(body) > 65536;
    if (body && tooLarge)
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
          : {
              "Idempotency-Key": request.headers.get("idempotency-key") ?? "",
              ...(multipart
                ? { "Content-Type": request.headers.get("content-type") ?? "" }
                : {}),
            },
    });
    return new Response(await res.arrayBuffer(), {
      status: res.status,
      headers: {
        "Content-Type": res.headers.get("content-type") ?? "application/json",
        ...(res.headers.get("content-disposition")
          ? { "Content-Disposition": res.headers.get("content-disposition")! }
          : {}),
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
export const DELETE = handle;
