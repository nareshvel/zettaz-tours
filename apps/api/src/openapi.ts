import { z } from "zod";
import {
  bookingSchema,
  amendmentSchema,
  acceptAmendmentSchema,
  cancellationSchema,
  confirmSchema,
  holdSchema,
  memberSchema,
  memberUpdateSchema,
  paymentSchema,
  paymentAdjustmentSchema,
  productSchema,
  scheduleSchema,
  tenantSchema,
  updateConfigSchema,
} from "../../../packages/shared/src/contracts";
import { pickupLocationSchema, pickupPlanSchema } from "./dispatch";

const routes: [string, string, z.ZodType | null, string][] = [
  ["/auth/v1/password-recovery/request","post",null,"Request a non-enumerating password recovery token"],
  ["/auth/v1/password-recovery/complete","post",null,"Consume a single-use recovery token and revoke prior sessions"],
  ["/integrations/v1/inbox/{id}/review","post",null,"Queue a quarantined event for retry or retain it as dead letter"],
  [
    "/reports/v1/overview",
    "get",
    null,
    "Read tenant operational and commercial report totals",
  ],
  [
    "/staff/v1/bookings/{id}/notifications",
    "get",
    null,
    "List a booking's customer communication requests",
  ],
  [
    "/staff/v1/bookings/{id}/notifications",
    "post",
    null,
    "Prepare an auditable customer communication request",
  ],
  ["/finance/v1/partners", "get", null, "List tenant partner organizations"],
  [
    "/finance/v1/partners/available",
    "get",
    null,
    "List active partners available to a reservation",
  ],
  [
    "/finance/v1/partners",
    "post",
    null,
    "Create a tenant partner organization",
  ],
  [
    "/finance/v1/partner-claims",
    "post",
    null,
    "Record an unverified partner collection claim",
  ],
  [
    "/finance/v1/partner-claims",
    "get",
    null,
    "List partner collection claims for finance review",
  ],
  [
    "/finance/v1/partner-claims/{id}/decision",
    "post",
    null,
    "Accept or reject a partner collection claim",
  ],
  [
    "/finance/v1/bookings/{id}/finance-summary",
    "get",
    null,
    "Read guest and partner finance facts for a booking",
  ],
  [
    "/finance/v1/partner-statements",
    "get",
    null,
    "List partner obligation statement lines",
  ],
  [
    "/crew/v1/today",
    "get",
    null,
    "Read only the current crew member's assigned trips",
  ],
  [
    "/crew/v1/departures/{id}/events",
    "post",
    null,
    "Append an assigned crew member's trip-run event",
  ],
  ["/ops/v1/board", "get", null, "Read the day operations board"],
  ["/ops/v1/print-templates", "get", null, "List published print templates"],
  [
    "/ops/v1/print-templates",
    "post",
    null,
    "Publish a versioned print template",
  ],
  ["/ops/v1/print-jobs", "get", null, "List tenant print jobs"],
  [
    "/ops/v1/print-jobs",
    "post",
    null,
    "Request an auditable browser print job",
  ],
  [
    "/ops/v1/print-jobs/{id}/pdf",
    "get",
    null,
    "Download a tenant-authorized operational PDF",
  ],
  ["/ops/v1/resources", "get", null, "List tenant operational resources"],
  ["/ops/v1/resources", "post", null, "Create an operational resource"],
  ["/ops/v1/crew", "get", null, "List active crew profiles"],
  ["/ops/v1/crew", "post", null, "Create a crew profile"],
  [
    "/ops/v1/compliance-documents",
    "get",
    null,
    "List resource and crew compliance documents",
  ],
  [
    "/ops/v1/compliance-documents",
    "post",
    null,
    "Record a compliance document and expiry date",
  ],
  [
    "/ops/v1/assignments",
    "post",
    null,
    "Assign a resource or crew member to a departure",
  ],
  [
    "/ops/v1/departures/{id}/assignments",
    "get",
    null,
    "Read assignment readiness for a departure",
  ],
  ["/ops/v1/waiver-templates", "get", null, "Read active waiver templates"],
  [
    "/ops/v1/waiver-templates",
    "post",
    null,
    "Create an immutable waiver template version",
  ],
  [
    "/ops/v1/bookings/{id}/waivers",
    "post",
    null,
    "Record append-only waiver evidence",
  ],
  [
    "/ops/v1/bookings/{id}/waivers",
    "get",
    null,
    "Read booking waiver evidence",
  ],
  [
    "/ops/v1/bookings/{id}/checkin",
    "post",
    null,
    "Record booking arrival, clearance, boarding or no-show state",
  ],
  [
    "/ops/v1/pickup-locations",
    "get",
    null,
    "Read active tenant pickup locations",
  ],
  [
    "/ops/v1/pickup-locations",
    "post",
    pickupLocationSchema,
    "Create a controlled pickup location",
  ],
  [
    "/ops/v1/departures/{id}/pickups",
    "get",
    null,
    "Read an ordered pickup plan",
  ],
  [
    "/ops/v1/departures/{id}/pickups",
    "post",
    pickupPlanSchema,
    "Save an ordered pickup plan",
  ],
  [
    "/ops/v1/departures/{id}/pickup-list",
    "get",
    null,
    "Read a printable pickup list with unresolved exceptions",
  ],
  [
    "/staff/v1/bookings/{id}/change-quotes",
    "post",
    amendmentSchema,
    "Quote a booking amendment without reserving seats",
  ],
  [
    "/staff/v1/bookings/{id}/changes",
    "post",
    acceptAmendmentSchema,
    "Accept a quoted amendment atomically",
  ],
  [
    "/staff/v1/bookings/{id}/changes",
    "get",
    null,
    "Read booking change history",
  ],
  [
    "/staff/v1/bookings/{id}/cancel",
    "post",
    cancellationSchema,
    "Cancel and release inventory without issuing a refund",
  ],
  [
    "/staff/v1/workspace/session",
    "get",
    null,
    "Current tenant, role and permissions",
  ],
  ["/staff/v1/workspace/summary", "get", null, "Tenant operational counts"],
  ...["departures", "reservations", "members"].map(
    (name): [string, string, null, string] => [
      `/staff/v1/workspace/${name}`,
      "get",
      null,
      `Paginated tenant ${name}`,
    ],
  ),
  [
    "/platform/v1/tenants",
    "post",
    tenantSchema,
    "Provision a mock tenant and initial owner identity",
  ],
  ["/admin/v1/tenant", "get", null, "Read tenant configuration"],
  [
    "/admin/v1/tenant/config",
    "patch",
    updateConfigSchema,
    "Update tenant configuration with optimistic version",
  ],
  ["/admin/v1/members", "post", memberSchema, "Create tenant staff membership"],
  [
    "/admin/v1/members/{id}",
    "patch",
    memberUpdateSchema,
    "Change role or revoke membership",
  ],
  [
    "/admin/v1/products",
    "post",
    productSchema,
    "Configure a shared-tour product and option",
  ],
  ["/admin/v1/products", "get", null, "List up to 100 products"],
  [
    "/admin/v1/schedules",
    "post",
    scheduleSchema,
    "Materialize recurring departures",
  ],
  [
    "/staff/v1/departures/{id}/availability",
    "get",
    null,
    "Read authoritative seat availability",
  ],
  [
    "/staff/v1/holds",
    "post",
    holdSchema,
    "Hold seats and freeze a quote until expiry",
  ],
  [
    "/staff/v1/bookings",
    "post",
    bookingSchema,
    "Create a held manual reservation",
  ],
  ["/staff/v1/bookings/{id}", "get", null, "Read booking, quote and balance"],
  [
    "/staff/v1/bookings/{id}/passengers",
    "get",
    null,
    "Read the booking passenger roster",
  ],
  [
    "/staff/v1/bookings/{id}/passengers",
    "post",
    null,
    "Record the held booking passenger roster",
  ],
  [
    "/staff/v1/bookings/{id}/passengers/corrections",
    "post",
    null,
    "Create an auditable correction to a held passenger roster",
  ],
  [
    "/staff/v1/passengers/{id}/checkin",
    "post",
    null,
    "Append a passenger arrival, clearance, boarding or no-show fact",
  ],
  [
    "/staff/v1/passengers/{id}/checkin-token",
    "post",
    null,
    "Issue an expiring opaque passenger check-in token",
  ],
  [
    "/staff/v1/crew/checkin-token/resolve",
    "post",
    null,
    "Resolve an opaque token for an assigned crew member",
  ],
  [
    "/staff/v1/bookings/{id}/payments",
    "post",
    paymentSchema,
    "Record an explicit manual payment fact",
  ],
  [
    "/staff/v1/bookings/{id}/payments/{paymentId}/adjustments",
    "post",
    paymentAdjustmentSchema,
    "Append a void or external reversal to an immutable manual payment",
  ],
  [
    "/staff/v1/bookings/{id}/confirm",
    "post",
    confirmSchema,
    "Commit capacity and price snapshot",
  ],
  [
    "/ops/v1/departures/{id}/manifest",
    "get",
    null,
    "Read confirmed parties on the manifest",
  ],
  ["/ops/v1/audit", "get", null, "Read the latest 100 audit event summaries"],
];
export function openapi() {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const [path, method, schema, summary] of routes) {
    const parameters: object[] = [];
    if (/workspace\/(departures|reservations|members)$/.test(path))
      parameters.push(
        {
          in: "query",
          name: "limit",
          schema: { type: "integer", minimum: 1, maximum: 100, default: 30 },
        },
        {
          in: "query",
          name: "cursor",
          schema: { type: "string", format: "uuid" },
        },
        {
          in: "query",
          name: "search",
          schema: { type: "string", maxLength: 100 },
        },
      );
    if (path.includes("{id}"))
      parameters.push({
        in: "path",
        name: "id",
        required: true,
        schema: { type: "string", format: "uuid" },
      });
    if (schema && !path.startsWith("/platform"))
      parameters.push({
        in: "header",
        name: "Idempotency-Key",
        required: true,
        schema: { type: "string", minLength: 8, maxLength: 128 },
      });
    (paths[path] ??= {})[method] = {
      summary,
      security: [{ bearerAuth: [] }],
      parameters,
      ...(schema
        ? {
            requestBody: {
              required: true,
              content: {
                "application/json": {
                  schema: z.toJSONSchema(schema, { target: "draft-7" }),
                },
              },
            },
          }
        : {}),
      responses: {
        [method === "post" ? "201" : "200"]: {
          description: "Successful operation",
        },
        "400": { description: "Invalid input" },
        "401": { description: "Expired or invalid session" },
        "403": { description: "Permission denied" },
        "404": { description: "Record not visible" },
        "409": {
          description: "State, capacity, version or idempotency conflict",
        },
      },
    };
  }
  return {
    openapi: "3.1.0",
    info: {
      title: "Zettaz Tours — first slice",
      version: "0.1.0",
      description:
        "Development-only API with opt-in mock data. Live payments and production identity are disabled.",
    },
    components: {
      securitySchemes: { bearerAuth: { type: "http", scheme: "bearer" } },
    },
    paths,
  };
}
