import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Patch,
  Query,
} from "@nestjs/common";
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
const reservationQuerySchema = querySchema
  .omit({ cursor: true, view: true })
  .extend({
    cursor: z.string().trim().min(1).max(40).optional(),
    state: z.enum(["held", "confirmed", "cancelled", "expired"]).optional(),
    source: z.string().trim().max(60).optional(),
    from: z.iso.date().optional(),
    to: z.iso.date().optional(),
    sort: z
      .enum([
        "created_at",
        "starts_at",
        "lead_name",
        "state",
        "guests",
        "balance",
      ])
      .default("created_at"),
    dir: z.enum(["asc", "desc"]).default("desc"),
  })
  .strict();

const reservationSortSql = {
  created_at: "b.created_at",
  starts_at: "d.starts_at",
  lead_name: "lower(b.lead_name)",
  state: `CASE WHEN b.state='held' AND h.expires_at<=clock_timestamp() THEN 'expired' ELSE b.state END`,
  guests: `(SELECT COALESCE(SUM(value::int),0) FROM jsonb_each_text(h.party))`,
  balance: `((h.quote->>'totalMinor')::float8 - COALESCE((SELECT SUM(x.amount_minor) FROM payments x WHERE x.tenant_id=b.tenant_id AND x.booking_id=b.id AND x.status='settled' AND NOT EXISTS(SELECT 1 FROM payment_adjustments a WHERE a.tenant_id=x.tenant_id AND a.payment_id=x.id)),0))`,
} as const;
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
        `SELECT d.id,d.product_id,d.starts_at,d.capacity,d.capacity_adult,d.capacity_child,d.status,d.operational_status,d.operational_version,(d.committed+d.overbooked)::int AS committed,d.overbooked,p.name AS product_name,
      p.availability_mode,p.product_kind,
      p.definition->>'optionName' AS option_name,p.definition->'categories' AS categories,
      NULLIF(p.definition->>'durationMinutes','')::int AS duration_minutes,
      COALESCE((SELECT SUM(h.seats) FROM holds h WHERE h.tenant_id=d.tenant_id AND h.departure_id=d.id AND NOT h.consumed AND h.expires_at>clock_timestamp()),0)::int AS held,
      (d.committed_adults+d.overbooked_adults)::int AS committed_adults,
      (d.committed_children+d.overbooked_children)::int AS committed_children,
      CASE WHEN d.starts_at<=clock_timestamp() THEN 0 ELSE GREATEST(0,d.capacity-d.committed-d.overbooked-COALESCE((SELECT SUM(h.seats) FROM holds h WHERE h.tenant_id=d.tenant_id AND h.departure_id=d.id AND NOT h.consumed AND h.expires_at>clock_timestamp()),0))::int END AS available,
      CASE WHEN d.starts_at<=clock_timestamp() THEN 0 ELSE GREATEST(0,d.capacity_adult-d.committed_adults-d.overbooked_adults-COALESCE((SELECT SUM(h.adult_seats) FROM holds h WHERE h.tenant_id=d.tenant_id AND h.departure_id=d.id AND NOT h.consumed AND h.expires_at>clock_timestamp()),0))::int END AS available_adults,
      CASE WHEN d.capacity_child IS NULL THEN NULL WHEN d.starts_at<=clock_timestamp() THEN 0 ELSE GREATEST(0,d.capacity_child-d.committed_children-d.overbooked_children-COALESCE((SELECT SUM(h.child_seats) FROM holds h WHERE h.tenant_id=d.tenant_id AND h.departure_id=d.id AND NOT h.consumed AND h.expires_at>clock_timestamp()),0))::int END AS available_children
      FROM departures d JOIN products p ON p.tenant_id=d.tenant_id AND p.id=d.product_id
      WHERE d.tenant_id=$1 AND ($2::uuid IS NULL OR d.id>$2) AND p.name ILIKE $3
      AND ($10::uuid IS NOT NULL OR $6::date IS NULL OR d.local_date >= $6::date)
      AND ($10::uuid IS NOT NULL OR $7::date IS NULL OR d.local_date <= $7::date)
      AND ($10::uuid IS NOT NULL OR $8::uuid IS NULL OR d.product_id=$8)
      AND ($10::uuid IS NOT NULL OR $9::text IS NULL OR p.availability_mode=$9)
      AND ($10::uuid IS NULL OR d.id=$10)
      ORDER BY CASE WHEN $5='upcoming' THEN d.starts_at END ASC,
      CASE WHEN $5<>'upcoming' THEN d.starts_at END DESC,d.id LIMIT $4`,
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
    const offset = q.cursor ? Number(q.cursor) : 0;
    if (!Number.isInteger(offset) || offset < 0)
      throw new BadRequestException("Invalid reservation list cursor");
    const sortSql = reservationSortSql[q.sort];
    const dirSql = q.dir === "asc" ? "ASC" : "DESC";
    return this.db.transaction(actor, async (tx) => {
      const { rows } = await tx.query(
        `SELECT b.id,b.departure_id,b.lead_name,b.source,b.pickup,b.version,b.created_at,
      CASE WHEN b.state='held' AND h.expires_at<=clock_timestamp() THEN 'expired' ELSE b.state END AS state,
      d.starts_at,p.name AS product_name,h.party,h.quote->>'currency' AS currency,
      (h.quote->>'totalMinor')::float8 AS total_minor,
      COALESCE((SELECT SUM(x.amount_minor) FROM payments x WHERE x.tenant_id=b.tenant_id AND x.booking_id=b.id AND x.status='settled'
        AND NOT EXISTS(SELECT 1 FROM payment_adjustments a WHERE a.tenant_id=x.tenant_id AND a.payment_id=x.id)),0)::float8 AS paid_minor
      FROM bookings b JOIN holds h ON h.tenant_id=b.tenant_id AND h.id=b.hold_id
      JOIN departures d ON d.tenant_id=b.tenant_id AND d.id=b.departure_id
      JOIN products p ON p.tenant_id=d.tenant_id AND p.id=d.product_id
      WHERE b.tenant_id=$1
      AND (b.lead_name ILIKE $2 OR b.id::text ILIKE $2 OR p.name ILIKE $2)
      AND ($3::text IS NULL OR (CASE WHEN b.state='held' AND h.expires_at<=clock_timestamp() THEN 'expired' ELSE b.state END)=$3)
      AND ($4::text IS NULL OR b.source=$4)
      AND ($5::date IS NULL OR d.starts_at >= $5::date)
      AND ($6::date IS NULL OR d.starts_at < ($6::date + interval '1 day'))
      ORDER BY ${sortSql} ${dirSql}, b.id ${dirSql}
      LIMIT $7 OFFSET $8`,
        [
          actor.tenantId,
          "%" + q.search + "%",
          q.state ?? null,
          q.source ?? null,
          q.from ?? null,
          q.to ?? null,
          q.limit + 1,
          offset,
        ],
      );
      const items = rows.slice(0, q.limit);
      return {
        items,
        nextCursor: rows.length > q.limit ? String(offset + q.limit) : null,
      };
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
  /**
   * Cross-cutting alerts that belong to no single page: a compliance document
   * about to expire, a hold about to lapse, money owed on a departure today.
   *
   * These live in the top-bar bell rather than on the Overview — they are
   * low-frequency, they are not what the Overview is for, and they follow the
   * user onto every page. Each is filtered by what the reader is allowed to
   * act on, so a partner manager is not shown the day's takings.
   */
  private async standaloneAlerts(
    tx: {
      query: (text: string, values?: unknown[]) => Promise<{ rows: any[] }>;
    },
    actor: Actor,
    day: string,
  ) {
    const may = (...codes: string[]) =>
      codes.some((code) => actor.permissions.includes(code));
    const items: {
      kind: string;
      severity: "critical" | "warning" | "info";
      subject: string;
      detail: string;
      href: string;
      action: string;
      at: string | null;
    }[] = [];

    if (may("resources.write", "documents.expiry.manage", "config.write")) {
      const { rows } = await tx.query(
        `SELECT c.id,c.document_type,c.expires_on::text AS expires_on,
           COALESCE(s.name,r.name,'Unassigned record') AS subject
         FROM compliance_documents c
         LEFT JOIN staff_users s ON s.id=c.crew_actor_id
         LEFT JOIN operational_resources r ON r.tenant_id=c.tenant_id AND r.id=c.resource_id
         WHERE c.tenant_id=$1 AND c.expires_on <= $2::date + 7
         ORDER BY c.expires_on LIMIT 8`,
        [actor.tenantId, day],
      );
      for (const c of rows)
        items.push({
          kind: "document",
          severity: c.expires_on <= day ? "critical" : "warning",
          subject: c.subject,
          detail: `${c.document_type.replaceAll("_", " ")} ${c.expires_on <= day ? "expired" : "expires"}`,
          href: "/resources",
          action: "Renew",
          at: c.expires_on,
        });
    }

    if (may("bookings.read")) {
      const { rows } = await tx.query(
        `SELECT h.id,h.expires_at,h.seats,p.name AS product_name
         FROM holds h
         JOIN departures d ON d.tenant_id=h.tenant_id AND d.id=h.departure_id
         JOIN products p ON p.tenant_id=d.tenant_id AND p.id=d.product_id
         JOIN bookings b ON b.tenant_id=h.tenant_id AND b.hold_id=h.id AND b.state='held'
         WHERE h.tenant_id=$1 AND NOT h.consumed
           AND h.expires_at BETWEEN clock_timestamp() AND clock_timestamp()+interval '60 minutes'
         ORDER BY h.expires_at LIMIT 5`,
        [actor.tenantId],
      );
      for (const h of rows)
        items.push({
          kind: "expiring_hold",
          severity: "warning",
          subject: h.product_name,
          detail: `Hold on ${h.seats} seat${h.seats === 1 ? "" : "s"} expires shortly`,
          href: "/reservations",
          action: "Open booking",
          at: h.expires_at,
        });
    }

    if (may("payment.write", "payment.correct", "config.write")) {
      const {
        rows: [owed],
      } = await tx.query(
        `SELECT COUNT(*)::int AS bookings FROM (
           SELECT b.id,
             COALESCE((SELECT (quote->>'totalMinor')::bigint FROM price_snapshots s
               WHERE s.tenant_id=b.tenant_id AND s.booking_id=b.id ORDER BY version DESC LIMIT 1),0)
             - COALESCE((SELECT SUM(p.amount_minor) FROM payments p
                 WHERE p.tenant_id=b.tenant_id AND p.booking_id=b.id AND p.status='settled'
                 AND NOT EXISTS(SELECT 1 FROM payment_adjustments a
                   WHERE a.tenant_id=p.tenant_id AND a.payment_id=p.id)),0)
             - COALESCE((SELECT SUM(c.amount_minor) FROM partner_collection_claims c
                 JOIN partner_claim_decisions x ON x.tenant_id=c.tenant_id AND x.claim_id=c.id AND x.decision='accepted'
                 WHERE c.tenant_id=b.tenant_id AND c.booking_id=b.id),0) AS owed_minor
           FROM bookings b
           JOIN departures d ON d.tenant_id=b.tenant_id AND d.id=b.departure_id
           WHERE b.tenant_id=$1 AND d.local_date=$2 AND b.state='confirmed'
         ) scoped WHERE owed_minor > 0`,
        [actor.tenantId, day],
      );
      if (owed.bookings > 0)
        items.push({
          kind: "balance",
          severity: "info",
          subject: "Balance due today",
          detail: `${owed.bookings} booking${owed.bookings === 1 ? "" : "s"} departing today still owes money`,
          href: "/reservations",
          action: "Collect",
          at: null,
        });
    }

    const rank = { critical: 0, warning: 1, info: 2 };
    return items.sort(
      (a, b) =>
        rank[a.severity] - rank[b.severity] ||
        (a.at ? Date.parse(a.at) : Number.MAX_SAFE_INTEGER) -
          (b.at ? Date.parse(b.at) : Number.MAX_SAFE_INTEGER),
    );
  }

  @Get("notifications")
  @Access("catalog.read")
  notifications(@CurrentActor() actor: Actor) {
    return this.db.transaction(actor, async (tx) => {
      const {
        rows: [t],
      } = await tx.query("SELECT timezone FROM tenants WHERE id=$1", [
        actor.tenantId,
      ]);
      const {
        rows: [{ day }],
      } = await tx.query(
        "SELECT (clock_timestamp() AT TIME ZONE $1)::date::text AS day",
        [t?.timezone ?? "UTC"],
      );
      const items = await this.standaloneAlerts(tx, actor, day);
      return { day, items, count: items.length };
    });
  }

  /**
   * The shift briefing behind the Overview page.
   *
   * One round trip instead of the six the page used to make, and scoped to the
   * operating day rather than to all of history: what is running now, what will
   * break if nobody acts, and what the week looks like. Everything here is
   * bounded by the tenant's own local date — a departure belongs to the day the
   * crew calls it, not to a UTC window.
   */
  @Get("briefing")
  @Access("bookings.read")
  briefing(@CurrentActor() actor: Actor) {
    return this.db.transaction(actor, async (tx) => {
      const {
        rows: [t],
      } = await tx.query(
        "SELECT timezone,base_currency FROM tenants WHERE id=$1",
        [actor.tenantId],
      );
      const timezone = t?.timezone ?? "UTC";
      const currency = t?.base_currency ?? "USD";
      const {
        rows: [{ day }],
      } = await tx.query(
        "SELECT (clock_timestamp() AT TIME ZONE $1)::date::text AS day",
        [timezone],
      );

      // ── Today ────────────────────────────────────────────────────────────
      const {
        rows: [today],
      } = await tx.query(
        `SELECT
           COUNT(DISTINCT d.id)::int AS departures,
           COALESCE(SUM(h.seats) FILTER(WHERE b.state='confirmed'),0)::int AS guests
         FROM departures d
         LEFT JOIN bookings b ON b.tenant_id=d.tenant_id AND b.departure_id=d.id
         LEFT JOIN holds h ON h.tenant_id=b.tenant_id AND h.id=b.hold_id
         WHERE d.tenant_id=$1 AND d.local_date=$2`,
        [actor.tenantId, day],
      );
      const {
        rows: [boarding],
      } = await tx.query(
        `SELECT
           COUNT(*) FILTER(WHERE COALESCE(latest.state,'not_arrived')='boarded')::int AS boarded,
           COUNT(*)::int AS expected
         FROM booking_passengers bp
         JOIN bookings b ON b.tenant_id=bp.tenant_id AND b.id=bp.booking_id
         JOIN departures d ON d.tenant_id=b.tenant_id AND d.id=b.departure_id
         LEFT JOIN LATERAL (
           SELECT state FROM passenger_checkins x
           WHERE x.tenant_id=bp.tenant_id AND x.passenger_id=bp.id
           ORDER BY occurred_at DESC,id DESC LIMIT 1
         ) latest ON true
         WHERE bp.tenant_id=$1 AND d.local_date=$2
           AND b.state='confirmed' AND bp.superseded_at IS NULL`,
        [actor.tenantId, day],
      );
      const {
        rows: [nextDeparture],
      } = await tx.query(
        `SELECT d.id,d.starts_at,p.name AS product_name
         FROM departures d JOIN products p ON p.tenant_id=d.tenant_id AND p.id=d.product_id
         WHERE d.tenant_id=$1 AND d.starts_at>clock_timestamp() AND d.operational_status='open'
         ORDER BY d.starts_at,d.id LIMIT 1`,
        [actor.tenantId],
      );

      // Outstanding guest money on today's departures. Partner-settled amounts
      // are credited, so this is what a guest can still be asked for at the
      // gate — not the accounting balance.
      const {
        rows: [money],
      } = await tx.query(
        `SELECT COALESCE(SUM(GREATEST(total_minor-paid_minor-partner_credit_minor,0)),0)::text AS outstanding_minor,
                COUNT(*) FILTER(WHERE total_minor-paid_minor-partner_credit_minor>0)::int AS bookings
         FROM (
           SELECT b.id,
             COALESCE((SELECT (quote->>'totalMinor')::bigint FROM price_snapshots s
               WHERE s.tenant_id=b.tenant_id AND s.booking_id=b.id ORDER BY version DESC LIMIT 1),0) AS total_minor,
             COALESCE((SELECT SUM(p.amount_minor) FROM payments p
               WHERE p.tenant_id=b.tenant_id AND p.booking_id=b.id AND p.status='settled'
               AND NOT EXISTS(SELECT 1 FROM payment_adjustments a
                 WHERE a.tenant_id=p.tenant_id AND a.payment_id=p.id)),0) AS paid_minor,
             COALESCE((SELECT SUM(c.amount_minor) FROM partner_collection_claims c
               JOIN partner_claim_decisions x ON x.tenant_id=c.tenant_id AND x.claim_id=c.id AND x.decision='accepted'
               WHERE c.tenant_id=b.tenant_id AND c.booking_id=b.id),0) AS partner_credit_minor
           FROM bookings b
           JOIN departures d ON d.tenant_id=b.tenant_id AND d.id=b.departure_id
           WHERE b.tenant_id=$1 AND d.local_date=$2 AND b.state='confirmed'
         ) scoped`,
        [actor.tenantId, day],
      );

      // ── Timeline: the next three operating days ──────────────────────────
      const { rows: timeline } = await tx.query(
        `SELECT d.id,d.starts_at,d.local_date::text AS local_date,d.capacity,d.capacity_adult,d.capacity_child,
           (d.committed+d.overbooked)::int AS committed,d.operational_status,
           p.name AS product_name,
           EXISTS(SELECT 1 FROM departure_assignments a
             WHERE a.tenant_id=d.tenant_id AND a.departure_id=d.id AND a.status='active') AS crew_assigned,
           COALESCE((SELECT COUNT(*)::int FROM bookings b
             WHERE b.tenant_id=d.tenant_id AND b.departure_id=d.id
               AND b.state='confirmed' AND b.pickup->>'kind'='unresolved'),0) AS pickup_unresolved,
           COALESCE((SELECT COUNT(*)::int FROM bookings b
             WHERE b.tenant_id=d.tenant_id AND b.departure_id=d.id
               AND b.state='confirmed' AND b.pickup->>'kind'='selected'),0) AS pickup_required,
           COALESCE((SELECT COUNT(*)::int FROM pickup_stops s
             WHERE s.tenant_id=d.tenant_id AND s.departure_id=d.id),0) AS pickup_planned
         FROM departures d JOIN products p ON p.tenant_id=d.tenant_id AND p.id=d.product_id
         WHERE d.tenant_id=$1 AND d.local_date BETWEEN $2::date AND $2::date + 2
         ORDER BY d.starts_at,d.id LIMIT 40`,
        [actor.tenantId, day],
      );

      // ── The month's money, for roles that can act on it ──────────────────
      // Part-to-whole with two parts: received against still owed on this
      // calendar month's departures. Same expression as the today figure, so
      // the two can never disagree. A month is the window an owner actually
      // thinks in; a rolling week cut across it arbitrarily.
      const {
        rows: [month],
      } = await tx.query(
        `SELECT COALESCE(SUM(total_minor),0)::text AS booked_minor,
                COALESCE(SUM(paid_minor),0)::text AS received_minor,
                COALESCE(SUM(GREATEST(total_minor-paid_minor-partner_credit_minor,0)),0)::text AS outstanding_minor,
                COUNT(*)::int AS bookings
         FROM (
           SELECT b.id,
             COALESCE((SELECT (quote->>'totalMinor')::bigint FROM price_snapshots s
               WHERE s.tenant_id=b.tenant_id AND s.booking_id=b.id ORDER BY version DESC LIMIT 1),0) AS total_minor,
             COALESCE((SELECT SUM(p.amount_minor) FROM payments p
               WHERE p.tenant_id=b.tenant_id AND p.booking_id=b.id AND p.status='settled'
               AND NOT EXISTS(SELECT 1 FROM payment_adjustments a
                 WHERE a.tenant_id=p.tenant_id AND a.payment_id=p.id)),0) AS paid_minor,
             COALESCE((SELECT SUM(c.amount_minor) FROM partner_collection_claims c
               JOIN partner_claim_decisions x ON x.tenant_id=c.tenant_id AND x.claim_id=c.id AND x.decision='accepted'
               WHERE c.tenant_id=b.tenant_id AND c.booking_id=b.id),0) AS partner_credit_minor
           FROM bookings b
           JOIN departures d ON d.tenant_id=b.tenant_id AND d.id=b.departure_id
           WHERE b.tenant_id=$1 AND b.state='confirmed'
             AND d.local_date BETWEEN date_trunc('month',$2::date)::date
                                  AND (date_trunc('month',$2::date) + interval '1 month - 1 day')::date
         ) scoped`,
        [actor.tenantId, day],
      );

      // ── Demand: seven local days, for the week's shape ───────────────────
      const { rows: demand } = await tx.query(
        `SELECT series.day::date::text AS date,
           COALESCE((SELECT COUNT(*)::int FROM departures d
             WHERE d.tenant_id=$1 AND d.local_date=series.day::date),0) AS departures,
           COALESCE((SELECT SUM(d.capacity)::int FROM departures d
             WHERE d.tenant_id=$1 AND d.local_date=series.day::date),0) AS capacity,
           COALESCE((SELECT SUM(h.seats)::int FROM bookings b
             JOIN departures d ON d.tenant_id=b.tenant_id AND d.id=b.departure_id
             JOIN holds h ON h.tenant_id=b.tenant_id AND h.id=b.hold_id
             WHERE b.tenant_id=$1 AND d.local_date=series.day::date AND b.state='confirmed'),0) AS guests
         -- generate_series over dates with an interval step yields TIMESTAMPS, so
         -- every use casts back to date; ::text on the raw value would emit
         -- "2026-09-15 00:00:00" and no date parser downstream would accept it.
         FROM generate_series($2::date,$2::date + 6,'1 day') AS series(day)
         ORDER BY series.day`,
        [actor.tenantId, day],
      );

      // ── Selling slowly ───────────────────────────────────────────────────
      // Readiness answers "can this run"; this answers "should it". A trip
      // departing soon with seats unsold is the promote-or-cancel decision,
      // and nothing else on the page surfaces it. Today is excluded: by the
      // morning of departure the decision has already been made.
      const { rows: quiet } = await tx.query(
        `SELECT d.id,d.starts_at,d.local_date::text AS local_date,d.capacity,d.capacity_adult,d.capacity_child,
           (d.committed+d.overbooked)::int AS committed,
           (d.local_date - $2::date)::int AS days_out,
           p.name AS product_name
         FROM departures d JOIN products p ON p.tenant_id=d.tenant_id AND p.id=d.product_id
         WHERE d.tenant_id=$1
           AND d.local_date BETWEEN $2::date + 1 AND $2::date + 14
           AND d.operational_status='open'
           AND d.capacity > 0
           AND (d.committed+d.overbooked)::numeric / d.capacity < 0.4
         ORDER BY d.starts_at,d.id LIMIT 8`,
        [actor.tenantId, day],
      );

      // ── The queue ────────────────────────────────────────────────────────
      // Each row names its subject and carries the link that resolves it. A
      // count on its own ("4 exceptions") tells nobody what to do.
      const { rows: operational } = await tx.query(
        `SELECT d.id,d.starts_at,d.operational_status,d.operational_reason,p.name AS product_name,
           EXISTS(SELECT 1 FROM departure_assignments a
             WHERE a.tenant_id=d.tenant_id AND a.departure_id=d.id AND a.status='active') AS crew_assigned,
           COALESCE((SELECT COUNT(*)::int FROM bookings b
             WHERE b.tenant_id=d.tenant_id AND b.departure_id=d.id
               AND b.state='confirmed' AND b.pickup->>'kind'='unresolved'),0) AS pickup_unresolved,
           COALESCE((SELECT SUM(h.seats)::int FROM bookings b
             JOIN holds h ON h.tenant_id=b.tenant_id AND h.id=b.hold_id
             WHERE b.tenant_id=d.tenant_id AND b.departure_id=d.id AND b.state='confirmed'),0) AS guests
         FROM departures d JOIN products p ON p.tenant_id=d.tenant_id AND p.id=d.product_id
         WHERE d.tenant_id=$1 AND d.local_date BETWEEN $2::date AND $2::date + 2
         ORDER BY d.starts_at,d.id`,
        [actor.tenantId, day],
      );
      type QueueItem = {
        kind: string;
        severity: "critical" | "warning" | "info";
        subject: string;
        detail: string;
        startsAt: string | null;
        href: string;
        /** Compliance rows carry the date separately so the client can format
         *  it in the tenant's own style rather than shipping an ISO string. */
        expiresOn?: string;
        /** What the button does. "Resolve" on every row tells nobody what
         *  they are about to open. */
        action: string;
      };
      const queue: QueueItem[] = [];
      const soon = (startsAt: string, hours: number) =>
        new Date(startsAt).getTime() - Date.now() < hours * 3600_000;

      for (const d of operational) {
        if (d.operational_status !== "open")
          queue.push({
            kind: d.operational_status,
            severity: "critical",
            subject: d.product_name,
            detail:
              d.operational_reason ||
              (d.operational_status === "closed"
                ? "Closed — not sellable"
                : "On weather hold"),
            startsAt: d.starts_at,
            href: `/operations`,
            action:
              d.operational_status === "closed" ? "Reopen" : "Review hold",
          });
        // Crew only matters once the departure is close and someone is on it.
        if (!d.crew_assigned && d.guests > 0 && soon(d.starts_at, 24))
          queue.push({
            kind: "unassigned",
            severity: "critical",
            subject: d.product_name,
            detail: `${d.guests} guest${d.guests === 1 ? "" : "s"}, no crew or vehicle assigned`,
            startsAt: d.starts_at,
            href: `/departures/${d.id}/assignments`,
            action: "Assign",
          });
        if (d.pickup_unresolved > 0 && soon(d.starts_at, 48))
          queue.push({
            kind: "unresolved_pickup",
            severity: soon(d.starts_at, 12) ? "critical" : "warning",
            subject: d.product_name,
            detail: `${d.pickup_unresolved} guest${d.pickup_unresolved === 1 ? "" : "s"} with no pickup agreed`,
            startsAt: d.starts_at,
            href: `/operations/${d.id}/pickups`,
            action: "Plan pickups",
          });
      }
      const rank = { critical: 0, warning: 1, info: 2 };
      queue.sort(
        (a, b) =>
          rank[a.severity] - rank[b.severity] ||
          (a.startsAt ? Date.parse(a.startsAt) : Number.MAX_SAFE_INTEGER) -
            (b.startsAt ? Date.parse(b.startsAt) : Number.MAX_SAFE_INTEGER),
      );

      return {
        day,
        timezone,
        currency,
        today: {
          departures: today.departures,
          guests: today.guests,
          boarded: boarding.boarded,
          expected: boarding.expected,
          outstandingMinor: money.outstanding_minor,
          outstandingBookings: money.bookings,
          nextDeparture: nextDeparture
            ? {
                id: nextDeparture.id,
                startsAt: nextDeparture.starts_at,
                productName: nextDeparture.product_name,
              }
            : null,
        },
        month: {
          bookedMinor: month.booked_minor,
          receivedMinor: month.received_minor,
          outstandingMinor: month.outstanding_minor,
          bookings: month.bookings,
        },
        quiet,
        // Departure-derived only: the cross-cutting alerts are served to the
        // top-bar bell by `notifications`, so nothing is counted twice.
        queue: queue.slice(0, 12),
        queueTotal: queue.length,
        timeline,
        demand,
      };
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
      const samplePlan = plans[0] as
        { stripe_price_id_monthly?: string } | undefined;
      const billingReady =
        !!process.env.STRIPE_SECRET_KEY &&
        !!process.env.STRIPE_WEBHOOK_SECRET &&
        !!samplePlan?.stripe_price_id_monthly &&
        !samplePlan.stripe_price_id_monthly.startsWith("price_REPLACE");
      return { current: current ?? null, plans, billingReady };
    });
  }
}
