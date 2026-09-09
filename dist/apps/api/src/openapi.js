"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.openapi = openapi;
const zod_1 = require("zod");
const contracts_1 = require("../../../packages/shared/src/contracts");
const dispatch_1 = require("./dispatch");
const routes = [
    ["/ops/v1/board", "get", null, "Read the day operations board"],
    [
        "/ops/v1/pickup-locations",
        "get",
        null,
        "Read active tenant pickup locations",
    ],
    [
        "/ops/v1/pickup-locations",
        "post",
        dispatch_1.pickupLocationSchema,
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
        dispatch_1.pickupPlanSchema,
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
        contracts_1.amendmentSchema,
        "Quote a booking amendment without reserving seats",
    ],
    [
        "/staff/v1/bookings/{id}/changes",
        "post",
        contracts_1.acceptAmendmentSchema,
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
        contracts_1.cancellationSchema,
        "Cancel and release inventory without issuing a refund",
    ],
    [
        "/staff/v1/workspace/session",
        "get",
        null,
        "Current tenant, role and permissions",
    ],
    ["/staff/v1/workspace/summary", "get", null, "Tenant operational counts"],
    ...["departures", "reservations", "members"].map((name) => [
        `/staff/v1/workspace/${name}`,
        "get",
        null,
        `Paginated tenant ${name}`,
    ]),
    [
        "/platform/v1/tenants",
        "post",
        contracts_1.tenantSchema,
        "Provision a mock tenant and initial owner identity",
    ],
    ["/admin/v1/tenant", "get", null, "Read tenant configuration"],
    [
        "/admin/v1/tenant/config",
        "patch",
        contracts_1.updateConfigSchema,
        "Update tenant configuration with optimistic version",
    ],
    ["/admin/v1/members", "post", contracts_1.memberSchema, "Create tenant staff membership"],
    [
        "/admin/v1/members/{id}",
        "patch",
        contracts_1.memberUpdateSchema,
        "Change role or revoke membership",
    ],
    [
        "/admin/v1/products",
        "post",
        contracts_1.productSchema,
        "Configure a shared-tour product and option",
    ],
    ["/admin/v1/products", "get", null, "List up to 100 products"],
    [
        "/admin/v1/schedules",
        "post",
        contracts_1.scheduleSchema,
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
        contracts_1.holdSchema,
        "Hold seats and freeze a quote until expiry",
    ],
    [
        "/staff/v1/bookings",
        "post",
        contracts_1.bookingSchema,
        "Create a held manual reservation",
    ],
    ["/staff/v1/bookings/{id}", "get", null, "Read booking, quote and balance"],
    [
        "/staff/v1/bookings/{id}/payments",
        "post",
        contracts_1.paymentSchema,
        "Record an explicit manual payment fact",
    ],
    [
        "/staff/v1/bookings/{id}/confirm",
        "post",
        contracts_1.confirmSchema,
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
function openapi() {
    const paths = {};
    for (const [path, method, schema, summary] of routes) {
        const parameters = [];
        if (/workspace\/(departures|reservations|members)$/.test(path))
            parameters.push({
                in: "query",
                name: "limit",
                schema: { type: "integer", minimum: 1, maximum: 100, default: 30 },
            }, {
                in: "query",
                name: "cursor",
                schema: { type: "string", format: "uuid" },
            }, {
                in: "query",
                name: "search",
                schema: { type: "string", maxLength: 100 },
            });
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
                                schema: zod_1.z.toJSONSchema(schema, { target: "draft-7" }),
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
            description: "Development-only API with opt-in mock data. Live payments and production identity are disabled.",
        },
        components: {
            securitySchemes: { bearerAuth: { type: "http", scheme: "bearer" } },
        },
        paths,
    };
}
