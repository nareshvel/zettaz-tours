/**
 * Export Rock local sample data as SQL for another database.
 *
 * Create a NEW demo tenant:
 *   npm run db:export-demo
 *   npm run db:export-demo -- --mode=catalog
 *
 * Seed INTO an existing production tenant (keeps owner/login):
 *   npm run db:export-demo -- --into-tenant-id=f6e566ce-bb5c-4cc7-b801-8992268981d1 --mode=full
 *
 * Apply the generated file as postgres on the VPS:
 *   sudo -u postgres psql -d zettaz_tours -f apps/api/scripts/sql/generated/...
 */
import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { Pool } from "pg";
import { hashPassword } from "./sessions";

type Mode = "full" | "catalog";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const ACTOR_COLS = new Set([
  "actor_id",
  "recorded_by",
  "updated_by",
  "created_by",
  "assigned_by",
  "decided_by",
  "invited_by",
  "requested_by",
  "published_by",
  "overbook_authorized_by",
  "membership_actor_id",
  "crew_actor_id",
]);

/** Identity already exists on into-tenant targets. */
const INTO_SKIP = new Set([
  "tenant_roles",
  "role_permissions",
  "memberships",
  "tenant_subscriptions",
  "crew_profiles",
  "compliance_documents",
  "departure_assignments",
]);

const CATALOG_TABLES = [
  "tenant_roles",
  "role_permissions",
  "memberships",
  "tenant_subscriptions",
  "products",
  "product_options",
  "passenger_units",
  "rate_plans",
  "schedules",
  "availability_rules",
  "availability_rule_times",
  "availability_exceptions",
  "pickup_locations",
  "accommodation_properties",
  "cruise_calls",
  "partner_organizations",
  "operational_resources",
  "crew_profiles",
  "compliance_documents",
  "waiver_templates",
  "print_templates",
  "printer_routes",
] as const;

const FULL_EXTRA_TABLES = [
  "departures",
  "holds",
  "customers",
  "bookings",
  "booking_passengers",
  "booking_checkins",
  "payments",
  "payment_adjustments",
  "price_snapshots",
  "booking_changes",
  "booking_change_quotes",
  "booking_partner_attributions",
  "booking_partner_snapshots",
  "partner_collection_claims",
  "partner_claim_decisions",
  "partner_obligations",
  "pickup_stops",
  "departure_pickup_plans",
  "departure_itinerary_points",
  "departure_assignments",
  "trip_runs",
  "trip_run_events",
  "passenger_checkins",
  "passenger_checkin_tokens",
  "waiver_signatures",
] as const;

function arg(name: string, fallback?: string) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

function remember(map: Map<string, string>, id: unknown) {
  if (typeof id !== "string" || !UUID_RE.test(id)) return;
  const key = id.toLowerCase();
  if (!map.has(key)) map.set(key, randomUUID());
}

async function main() {
  if (!process.env.ADMIN_DATABASE_URL)
    throw new Error("ADMIN_DATABASE_URL is required (local owner connection)");

  const sourceSlug = arg("source-slug", "sample-river-excursions")!;
  const intoTenantId = arg("into-tenant-id");
  const targetSlug = arg("target-slug", "demo-rock-adventures")!;
  const targetName = arg("target-name", "Rock Adventures Demo")!;
  const mode = (arg("mode", intoTenantId ? "full" : "full") as Mode) ?? "full";
  if (mode !== "full" && mode !== "catalog")
    throw new Error("--mode must be full or catalog");
  if (intoTenantId && !UUID_RE.test(intoTenantId))
    throw new Error("--into-tenant-id must be a UUID");

  const outPath =
    arg(
      "out",
      path.join(
        "apps/api/scripts/sql/generated",
        intoTenantId
          ? `seed-into-${intoTenantId.slice(0, 8)}-${mode}.sql`
          : `demo-tenant-${targetSlug}-${mode}.sql`,
      ),
    )!;

  const pool = new Pool({ connectionString: process.env.ADMIN_DATABASE_URL });
  const map = new Map<string, string>();
  const staffIds = new Set<string>();

  try {
    const keepPlans = new Set(
      (
        await pool.query<{ id: string }>(
          "SELECT id::text AS id FROM subscription_plans",
        )
      ).rows.map((r) => r.id.toLowerCase()),
    );

    const {
      rows: [source],
    } = await pool.query("SELECT * FROM tenants WHERE slug=$1", [sourceSlug]);
    if (!source)
      throw new Error(
        `Source tenant not found: ${sourceSlug}. Run npm run db:seed first.`,
      );

    const sourceTenantId = String(source.id);
    if (intoTenantId) {
      map.set(sourceTenantId.toLowerCase(), intoTenantId.toLowerCase());
    } else {
      remember(map, sourceTenantId);
    }

    const staff = (
      await pool.query(
        `SELECT s.*
         FROM staff_users s
         JOIN memberships m ON m.actor_id = s.id
         WHERE m.tenant_id = $1
         ORDER BY s.email`,
        [sourceTenantId],
      )
    ).rows;
    for (const row of staff) {
      staffIds.add(String(row.id).toLowerCase());
      if (!intoTenantId) remember(map, row.id);
    }

    const baseTables =
      mode === "catalog"
        ? [...CATALOG_TABLES]
        : [...CATALOG_TABLES, ...FULL_EXTRA_TABLES];
    const tables = intoTenantId
      ? baseTables.filter((t) => !INTO_SKIP.has(t))
      : baseTables;

    const tableRows = new Map<string, Record<string, unknown>[]>();
    for (const table of tables) {
      const { rows } = await pool.query(
        `SELECT * FROM ${table} WHERE tenant_id = $1`,
        [sourceTenantId],
      );
      tableRows.set(table, rows);
      for (const row of rows) {
        for (const [col, value] of Object.entries(row)) {
          if (
            col === "plan_id" &&
            typeof value === "string" &&
            keepPlans.has(value.toLowerCase())
          )
            continue;
          if (intoTenantId && ACTOR_COLS.has(col)) continue;
          if (intoTenantId && col === "tenant_id") continue;
          remember(map, value);
        }
      }
    }

    for (const id of keepPlans) map.delete(id);

    const ownerSql = intoTenantId
      ? `(SELECT actor_id FROM memberships WHERE tenant_id='${intoTenantId}'::uuid AND role='owner' AND active ORDER BY actor_id LIMIT 1)`
      : null;

    function sqlLiteral(
      value: unknown,
      col?: string,
    ): string {
      if (value === null || value === undefined) return "NULL";
      if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
      if (typeof value === "number") {
        if (!Number.isFinite(value)) throw new Error(`Non-finite number: ${value}`);
        return String(value);
      }
      if (value instanceof Date) return `'${value.toISOString()}'::timestamptz`;
      if (Buffer.isBuffer(value))
        return `'\\x${value.toString("hex")}'::bytea`;
      if (typeof value === "object") {
        const json = JSON.stringify(value).replace(/'/g, "''");
        return `'${json}'::jsonb`;
      }
      const text = String(value);
      if (UUID_RE.test(text)) {
        const key = text.toLowerCase();
        if (
          intoTenantId &&
          ownerSql &&
          (staffIds.has(key) || (col && ACTOR_COLS.has(col)))
        )
          return ownerSql;
        const mapped = map.get(key) ?? text;
        return `'${mapped}'::uuid`;
      }
      return `'${text.replace(/'/g, "''")}'`;
    }

    const password =
      process.env.DEMO_EXPORT_PASSWORD ??
      process.env.LOCAL_DEFAULT_PASSWORD ??
      "ZettazDemo!ChangeMe";
    const passwordHash = intoTenantId ? null : await hashPassword(password);
    const newTenantId =
      intoTenantId ?? map.get(sourceTenantId.toLowerCase())!;

    const lines: string[] = [];
    lines.push(`-- Generated by apps/api/scripts/export-demo-tenant.ts`);
    lines.push(`-- Source: ${sourceSlug} (${sourceTenantId})`);
    lines.push(
      intoTenantId
        ? `-- Into existing tenant: ${intoTenantId}`
        : `-- Target: ${targetSlug} / ${targetName}`,
    );
    lines.push(`-- Mode: ${mode}`);
    lines.push(`-- Generated at: ${new Date().toISOString()}`);
    lines.push(
      `-- Apply as postgres: sudo -u postgres psql -d zettaz_tours -f <this-file>`,
    );
    lines.push("");
    lines.push("BEGIN;");
    lines.push("SET LOCAL session_replication_role = replica;");
    lines.push("");

    if (intoTenantId) {
      lines.push(
        `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM tenants WHERE id = '${intoTenantId}'::uuid) THEN RAISE EXCEPTION 'Target tenant % not found', '${intoTenantId}'; END IF; END $$;`,
      );
      lines.push("");
      // Rock catalog expects Antigua/USD settings; keep display name unless overridden.
      const profileName = arg("target-name");
      lines.push(`UPDATE tenants SET`);
      if (profileName) lines.push(`  name = ${sqlLiteral(profileName)},`);
      lines.push(`  timezone = ${sqlLiteral(source.timezone)},`);
      lines.push(`  config = ${sqlLiteral(source.config)},`);
      lines.push(`  version = version + 1`);
      lines.push(`WHERE id = '${intoTenantId}'::uuid;`);
      lines.push("");
    } else {
      lines.push(
        `DO $$ BEGIN IF EXISTS (SELECT 1 FROM tenants WHERE slug = '${targetSlug.replace(/'/g, "''")}') THEN RAISE EXCEPTION 'Tenant slug % already exists', '${targetSlug.replace(/'/g, "''")}'; END IF; END $$;`,
      );
      lines.push("");
      const tenantInsert = {
        ...source,
        id: sourceTenantId,
        slug: targetSlug,
        name: targetName,
        is_mock: false,
        version: 1,
        logo_path: null,
        authorized_contact: {
          name: "Demo Owner",
          email: "demo.owner@zettaz.com",
          phone: "",
        },
        business_profile: {
          ...(typeof source.business_profile === "object" &&
          source.business_profile
            ? source.business_profile
            : {}),
          displayName: targetName,
          email: "demo.owner@zettaz.com",
        },
      };
      const tenantCols = Object.keys(tenantInsert);
      lines.push(
        `INSERT INTO tenants(${tenantCols.join(",")}) VALUES (${tenantCols
          .map((c) =>
            sqlLiteral((tenantInsert as Record<string, unknown>)[c], c),
          )
          .join(",")});`,
      );
      lines.push("");

      for (const row of staff) {
        const originalEmail = String(row.email);
        const local = originalEmail.includes("@")
          ? originalEmail.split("@")[0]
          : originalEmail;
        const demoEmail =
          originalEmail.endsWith("@example.invalid") ||
          originalEmail.startsWith("sample-")
            ? `demo.owner@${targetSlug}.demo`
            : `demo.${local}@zettaz.com`;
        const staffRow = {
          ...row,
          email: demoEmail,
          email_verified_at: new Date(),
          signup_completed_at: row.signup_completed_at ?? new Date(),
          last_login_at: null,
        };
        const cols = Object.keys(staffRow);
        lines.push(
          `INSERT INTO staff_users(${cols.join(",")}) VALUES (${cols
            .map((c) =>
              sqlLiteral((staffRow as Record<string, unknown>)[c], c),
            )
            .join(",")});`,
        );
        lines.push(
          `INSERT INTO user_credentials(user_id, password_hash, verification_token_hash, verification_expires_at, password_reset_token_hash, password_reset_expires_at, totp_enabled)
 VALUES (${sqlLiteral(row.id, "id")}, ${sqlLiteral(passwordHash)}, NULL, NULL, NULL, NULL, FALSE);`,
        );
      }
      lines.push("");
    }

    for (const table of tables) {
      let rows = tableRows.get(table) ?? [];
      if (!rows.length) continue;
      if (table === "booking_passengers") {
        rows = [...rows].sort((a, b) => {
          const ag = a.guardian_passenger_id ? 1 : 0;
          const bg = b.guardian_passenger_id ? 1 : 0;
          if (ag !== bg) return ag - bg;
          const as = a.superseded_by ? 1 : 0;
          const bs = b.superseded_by ? 1 : 0;
          return as - bs;
        });
      }
      if (table === "tenant_subscriptions") {
        const growth = "3e595412-81e5-4c76-8216-25321d7ba56a";
        rows = rows.map((row) => {
          const planId = String(row.plan_id ?? "").toLowerCase();
          if (
            !keepPlans.has(planId) ||
            planId === "6baf0d04-4c50-11f0-8dfa-525400d69130"
          )
            return {
              ...row,
              plan_id: growth,
              status: "trial",
              stripe_customer_id: null,
              stripe_subscription_id: null,
            };
          return {
            ...row,
            stripe_customer_id: null,
            stripe_subscription_id: null,
          };
        });
      }
      lines.push(`-- ${table} (${rows.length})`);
      for (const row of rows) {
        const cols = Object.keys(row).filter((c) => {
          // Nullable crew refs skipped when into-tenant and value was a staff id
          if (
            intoTenantId &&
            (c === "crew_actor_id" || c === "membership_actor_id")
          )
            return false;
          return true;
        });
        lines.push(
          `INSERT INTO ${table}(${cols.join(",")}) VALUES (${cols
            .map((c) => {
              if (
                c === "plan_id" &&
                typeof row[c] === "string" &&
                keepPlans.has(String(row[c]).toLowerCase())
              )
                return `'${row[c]}'::uuid`;
              return sqlLiteral(row[c], c);
            })
            .join(",")});`,
        );
      }
      lines.push("");
    }

    lines.push("SET LOCAL session_replication_role = DEFAULT;");
    lines.push("COMMIT;");
    lines.push("");
    lines.push(`-- Verify:`);
    lines.push(
      `-- SELECT id, slug, name FROM tenants WHERE id = '${newTenantId}';`,
    );
    lines.push(
      `-- SELECT count(*) AS products FROM products WHERE tenant_id = '${newTenantId}';`,
    );

    await mkdir(path.dirname(outPath), { recursive: true });
    await writeFile(outPath, lines.join("\n"), "utf8");

    const checksum = createHash("sha256")
      .update(lines.join("\n"))
      .digest("hex")
      .slice(0, 12);

    console.log(`Wrote ${outPath}`);
    console.log(`Target tenant id: ${newTenantId}`);
    console.log(
      intoTenantId
        ? `Into-tenant mode (owner login kept); tables=${tables.length}`
        : `Staff users: ${staff.length}; tables=${tables.length}`,
    );
    console.log(`mode=${mode}; checksum=${checksum}`);
    console.log(
      `Apply on VPS: sudo -u postgres psql -d zettaz_tours -f ${outPath}`,
    );
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
