import { Body, Controller, Get, Headers, Patch, Query } from "@nestjs/common";
import { z } from "zod";
import {
  Actor,
  id,
  userProfileSchema,
} from "../../../packages/shared/src/contracts";
import { Database, record } from "./database";
import { Access, CurrentActor, keySchema, parse } from "./http";
import { tenant } from "./tenant";

const querySchema = z
  .object({
    cursor: id.optional(),
    limit: z.coerce.number().int().min(1).max(100).default(30),
    search: z.string().trim().max(100).default(""),
    view: z.enum(["records", "upcoming"]).default("records"),
  })
  .strict();
const departureQuerySchema = querySchema.extend({
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  productId: id.optional(),
  departureId: id.optional(),
  availabilityMode: z
    .enum([
      "fixed_departure",
      "opening_hours",
      "open_dated",
      "on_request",
      "resource_window",
    ])
    .optional(),
});
const reservationQuerySchema = querySchema.extend({
  state: z.enum(["held", "confirmed", "cancelled", "expired"]).optional(),
  source: z.string().trim().max(60).optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
});
function page<T extends { id: string }>(rows: T[], limit: number) {
  return {
    items: rows.slice(0, limit),
    nextCursor: rows.length > limit ? rows[limit - 1]!.id : null,
  };
}
@Controller("staff/v1/workspace")
export class WorkspaceController {
  constructor(private readonly db: Database) {}
  @Get("session")
  @Access("authenticated")
  session(@CurrentActor() actor: Actor) {
    return this.db.transaction(actor, async (tx) => {
      const {
        rows: [staff],
      } =
        actor.role === "support"
          ? await tx.query("SELECT * FROM current_support_actor_profile($1)", [
              actor.actorId,
            ])
          : await tx.query(
              "SELECT name,email,phone_number FROM staff_users WHERE id=$1",
              [actor.actorId],
            );
      const {
        rows: [supportAccess],
      } =
        actor.role === "support"
          ? await tx.query(
              `SELECT id,purpose,permissions,expires_at FROM support_access_grants
         WHERE tenant_id=$1 AND platform_actor_id=$2 AND status='approved' AND expires_at>clock_timestamp()
         ORDER BY expires_at LIMIT 1`,
              [actor.tenantId, actor.actorId],
            )
          : { rows: [] };
      return {
        actorId: actor.actorId,
        actorName: staff.name,
        actorEmail: staff.email,
        actorPhone: staff.phone_number,
        role: actor.role,
        permissions: actor.permissions,
        supportAccess: supportAccess ?? null,
        tenant: await tenant(tx, actor),
      };
    });
  }
  @Patch("profile")
  @Access("authenticated")
  profile(
    @CurrentActor() actor: Actor,
    @Headers("idempotency-key") key: string,
    @Body() body: unknown,
  ) {
    const input = parse(userProfileSchema, body);
    return this.db.command(
      actor,
      "user.profile.update",
      parse(keySchema, key),
      input,
      async (tx) => {
        const {
          rows: [before],
        } = await tx.query(
          "SELECT name,email,phone_number FROM staff_users WHERE id=$1 FOR UPDATE",
          [actor.actorId],
        );
        await tx.query(
          "UPDATE staff_users SET name=$2,email=$3,phone_number=$4 WHERE id=$1",
          [actor.actorId, input.name, input.email, input.phoneNumber || null],
        );
        await record(
          tx,
          actor,
          "user.profile_updated",
          actor.actorId,
          before,
          input,
        );
        return input;
      },
    );
  }
  @Get("departures")
  @Access("catalog.read")
  departures(@CurrentActor() actor: Actor, @Query() raw: unknown) {
    const q = parse(departureQuerySchema, raw);
    return this.db.transaction(actor, async (tx) => {
      const { rows } = await tx.query(
        `SELECT d.id,d.product_id,d.starts_at,d.capacity,d.status,(d.committed+d.overbooked)::int AS committed,d.overbooked,p.name AS product_name,
      p.availability_mode,p.product_kind,
      p.definition->>'optionName' AS option_name,p.definition->'categories' AS categories,
      NULLIF(p.definition->>'durationMinutes','')::int AS duration_minutes,
      COALESCE((SELECT SUM(h.seats) FROM holds h WHERE h.tenant_id=d.tenant_id AND h.departure_id=d.id AND NOT h.consumed AND h.expires_at>clock_timestamp()),0)::int AS held,
      CASE WHEN d.starts_at<=clock_timestamp() THEN 0 ELSE GREATEST(0,d.capacity-d.committed-d.overbooked-COALESCE((SELECT SUM(h.seats) FROM holds h WHERE h.tenant_id=d.tenant_id AND h.departure_id=d.id AND NOT h.consumed AND h.expires_at>clock_timestamp()),0))::int END AS available
      FROM departures d JOIN products p ON p.tenant_id=d.tenant_id AND p.id=d.product_id
      WHERE d.tenant_id=$1 AND ($2::uuid IS NULL OR d.id>$2) AND p.name ILIKE $3
      AND ($10::uuid IS NOT NULL OR $6::date IS NULL OR d.starts_at >= $6::date)
      AND ($10::uuid IS NOT NULL OR $7::date IS NULL OR d.starts_at < ($7::date + interval '1 day'))
      AND ($10::uuid IS NOT NULL OR $8::uuid IS NULL OR d.product_id=$8)
      AND ($10::uuid IS NOT NULL OR $9::text IS NULL OR p.availability_mode=$9)
      AND ($10::uuid IS NULL OR d.id=$10)
      ORDER BY CASE WHEN $5='upcoming' THEN d.starts_at END,d.id LIMIT $4`,
        [
          actor.tenantId,
          q.cursor ?? null,
          "%" + q.search + "%",
          q.limit + 1,
          q.view,
          q.from ?? null,
          q.to ?? null,
          q.productId ?? null,
          q.availabilityMode ?? null,
          q.departureId ?? null,
        ],
      );
      return page(rows, q.limit);
    });
  }
  @Get("reservations")
  @Access("bookings.read")
  reservations(@CurrentActor() actor: Actor, @Query() raw: unknown) {
    const q = parse(reservationQuerySchema, raw);
    return this.db.transaction(actor, async (tx) => {
      const { rows } = await tx.query(
        `SELECT b.id,b.departure_id,b.lead_name,b.source,b.pickup,b.version,
      CASE WHEN b.state='held' AND h.expires_at<=clock_timestamp() THEN 'expired' ELSE b.state END AS state,
      d.starts_at,p.name AS product_name,h.party,h.quote->>'currency' AS currency,
      (h.quote->>'totalMinor')::float8 AS total_minor,
      COALESCE((SELECT SUM(x.amount_minor) FROM payments x WHERE x.tenant_id=b.tenant_id AND x.booking_id=b.id AND x.status='settled'
        AND NOT EXISTS(SELECT 1 FROM payment_adjustments a WHERE a.tenant_id=x.tenant_id AND a.payment_id=x.id)),0)::float8 AS paid_minor
      FROM bookings b JOIN holds h ON h.tenant_id=b.tenant_id AND h.id=b.hold_id
      JOIN departures d ON d.tenant_id=b.tenant_id AND d.id=b.departure_id
      JOIN products p ON p.tenant_id=d.tenant_id AND p.id=d.product_id
      WHERE b.tenant_id=$1 AND ($2::uuid IS NULL OR b.id>$2)
      AND (b.lead_name ILIKE $3 OR b.id::text ILIKE $3 OR p.name ILIKE $3)
      AND ($5::text IS NULL OR (CASE WHEN b.state='held' AND h.expires_at<=clock_timestamp() THEN 'expired' ELSE b.state END)=$5)
      AND ($6::text IS NULL OR b.source=$6)
      AND ($7::date IS NULL OR d.starts_at >= $7::date)
      AND ($8::date IS NULL OR d.starts_at < ($8::date + interval '1 day'))
      ORDER BY b.id LIMIT $4`,
        [
          actor.tenantId,
          q.cursor ?? null,
          "%" + q.search + "%",
          q.limit + 1,
          q.state ?? null,
          q.source ?? null,
          q.from ?? null,
          q.to ?? null,
        ],
      );
      return page(rows, q.limit);
    });
  }
  @Get("members")
  @Access("members.write")
  members(@CurrentActor() actor: Actor, @Query() raw: unknown) {
    const q = parse(querySchema, raw);
    return this.db.transaction(actor, async (tx) => {
      const { rows } = await tx.query(
        `SELECT m.actor_id AS id,m.role,m.active,s.name,s.email,
                COALESCE(s.phone_number,'') AS phone,
                COALESCE(s.first_name, split_part(s.name,' ',1)) AS first_name,
                COALESCE(s.last_name,'') AS last_name,
                COALESCE(s.address,'{}'::jsonb) AS address,
                s.last_login_at,
                (s.signup_completed_at IS NOT NULL) AS has_password,
                EXISTS(
                  SELECT 1 FROM tenant_invitations i
                  WHERE i.tenant_id=m.tenant_id AND lower(i.email)=lower(s.email)
                    AND i.accepted_at IS NULL AND i.revoked_at IS NULL
                    AND i.expires_at > clock_timestamp()
                ) AS invite_pending,
                (
                  SELECT COUNT(*)::int FROM compliance_documents d
                  WHERE d.tenant_id=m.tenant_id AND d.crew_actor_id=m.actor_id
                ) AS document_count,
                EXISTS(
                  SELECT 1 FROM crew_profiles c
                  WHERE c.tenant_id=m.tenant_id AND c.membership_actor_id=m.actor_id AND c.active
                ) AS crew_active
         FROM memberships m JOIN staff_users s ON s.id=m.actor_id
         WHERE m.tenant_id=$1 AND ($2::uuid IS NULL OR m.actor_id>$2)
           AND (s.name ILIKE $3 OR s.email ILIKE $3)
         ORDER BY m.actor_id LIMIT $4`,
        [actor.tenantId, q.cursor ?? null, "%" + q.search + "%", q.limit + 1],
      );
      return page(
        rows.map((row) => ({
          ...row,
          access_status: row.active
            ? "active"
            : row.invite_pending
              ? "invited"
              : row.has_password
                ? "revoked"
                : "pending",
        })),
        q.limit,
      );
    });
  }
  @Get("roles")
  @Access("members.write")
  roles(@CurrentActor() actor: Actor) {
    return this.db.transaction(actor, async (tx) => {
      const { rows } = await tx.query(
        `SELECT r.id,r.code,r.name,r.is_system,COALESCE(array_agg(rp.permission_code ORDER BY rp.permission_code) FILTER (WHERE rp.permission_code IS NOT NULL),'{}') AS permissions
         FROM tenant_roles r LEFT JOIN role_permissions rp ON rp.tenant_id=r.tenant_id AND rp.role_id=r.id
         WHERE r.tenant_id=$1 GROUP BY r.id ORDER BY r.is_system DESC,r.name`,
        [actor.tenantId],
      );
      const { rows: permissions } = await tx.query(
        "SELECT p.code,p.name,p.description,p.module_code,m.name AS module_name FROM permissions p JOIN app_modules m ON m.code=p.module_code ORDER BY m.sort_order,p.code",
      );
      return { roles: rows, permissions };
    });
  }
  @Get("summary")
  @Access("bookings.read")
  summary(@CurrentActor() actor: Actor) {
    return this.db.transaction(actor, async (tx) => {
      const {
        rows: [r],
      } = await tx.query(
        `SELECT
      (SELECT COUNT(*)::int FROM departures WHERE tenant_id=$1 AND starts_at>clock_timestamp()) AS upcoming_departures,
      (SELECT COUNT(*)::int FROM bookings WHERE tenant_id=$1 AND state='confirmed') AS confirmed_bookings,
      (SELECT COALESCE(SUM((SELECT SUM(value::int) FROM jsonb_each_text(h.party))),0)::int FROM bookings b JOIN holds h ON h.tenant_id=b.tenant_id AND h.id=b.hold_id WHERE b.tenant_id=$1 AND b.state='confirmed') AS confirmed_guests,
      (SELECT COUNT(*)::int FROM bookings b JOIN holds h ON h.tenant_id=b.tenant_id AND h.id=b.hold_id WHERE b.tenant_id=$1 AND b.state='held' AND h.expires_at>clock_timestamp()) AS held_bookings`,
        [actor.tenantId],
      );
      return r;
    });
  }
  @Get("subscription")
  @Access("config.write")
  subscription(@CurrentActor() actor: Actor) {
    return this.db.transaction(actor, async (tx) => {
      const { rows: plans } = await tx.query(
        "SELECT id,name,description,monthly_minor,yearly_minor,currency,features,limits,stripe_price_id_monthly FROM subscription_plans WHERE active ORDER BY monthly_minor",
      );
      const {
        rows: [current],
      } = await tx.query(
        "SELECT s.plan_id,s.status,s.billing_cycle,s.period_ends_at,s.trial_ends_at,s.cancel_at_period_end,s.stripe_subscription_id,p.name,p.description,p.monthly_minor,p.yearly_minor,p.currency,p.features,p.limits FROM tenant_subscriptions s JOIN subscription_plans p ON p.id=s.plan_id WHERE s.tenant_id=$1",
        [actor.tenantId],
      );
      // billingReady: true once Stripe price IDs are real (no placeholder prefix) and webhook is configured.
      const samplePlan = plans[0] as { stripe_price_id_monthly?: string } | undefined;
      const billingReady =
        !!process.env.STRIPE_SECRET_KEY &&
        !!process.env.STRIPE_WEBHOOK_SECRET &&
        !!samplePlan?.stripe_price_id_monthly &&
        !samplePlan.stripe_price_id_monthly.startsWith("price_REPLACE");
      return { current: current ?? null, plans, billingReady };
    });
  }
}
