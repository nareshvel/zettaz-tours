import { Pool } from "pg";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

type MigrationStatus = "COMPLETE" | "INCOMPLETE";

function describeTarget(connectionString: string) {
  try {
    const url = new URL(connectionString);
    return `${url.hostname}:${url.port || "5432"}/${url.pathname.slice(1)} as ${decodeURIComponent(url.username)}`;
  } catch {
    return "configured PostgreSQL database";
  }
}

function printSummary(input: {
  status: MigrationStatus;
  known: number;
  previouslyApplied: number;
  appliedThisRun: string[];
  pending: string[];
  failed?: string;
  elapsedMs: number;
}) {
  console.log(`\nMigration result: ${input.status}`);
  console.log(`Previously applied: ${input.previouslyApplied}`);
  console.log(`Applied this run: ${input.appliedThisRun.length}`);
  console.log(`Pending: ${input.pending.length}`);
  console.log(`Total known scripts: ${input.known}`);
  console.log(`Elapsed: ${input.elapsedMs} ms`);
  if (input.failed) console.log(`Failed script: ${input.failed}`);
  if (input.pending.length)
    console.log(`Pending scripts: ${input.pending.join(", ")}`);
}

export async function migrate(adminUrl: string, runtimeRole: string) {
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(runtimeRole))
    throw new Error("Invalid runtime role name");
  const startedAt = Date.now();
  const dir = path.resolve("apps/api/migrations");
  const names = (await readdir(dir))
    .filter((name) => name.endsWith(".sql"))
    .sort();
  const appliedThisRun: string[] = [];
  let previouslyApplied = 0;
  let activeMigration: string | undefined;
  console.log("Migration run");
  console.log(`Target: ${describeTarget(adminUrl)}`);
  console.log(`Scripts discovered: ${names.length}`);
  const pool = new Pool({ connectionString: adminUrl });
  const tx = await pool.connect();
  try {
    await tx.query("BEGIN");
    await tx.query("SELECT pg_advisory_xact_lock(982134701)");
    await tx.query(
      `CREATE TABLE IF NOT EXISTS schema_migrations(name text PRIMARY KEY,checksum text NOT NULL,applied_at timestamptz DEFAULT now())`,
    );
    for (const name of names) {
      const sql = await readFile(path.join(dir, name), "utf8");
      const hash = createHash("sha256").update(sql).digest("hex");
      const {
        rows: [prior],
      } = await tx.query(
        "SELECT checksum FROM schema_migrations WHERE name=$1",
        [name],
      );
      if (prior) {
        if (prior.checksum !== hash)
          throw new Error(`Applied migration was modified: ${name}`);
        previouslyApplied += 1;
        console.log(`[SKIP] ${name} (already applied)`);
        continue;
      }
      activeMigration = name;
      const migrationStartedAt = Date.now();
      console.log(`[RUN ] ${name}`);
      await tx.query(sql);
      await tx.query(
        "INSERT INTO schema_migrations(name,checksum) VALUES($1,$2)",
        [name, hash],
      );
      appliedThisRun.push(name);
      console.log(
        `[DONE] ${name} (${Date.now() - migrationStartedAt} ms; awaiting commit)`,
      );
      activeMigration = undefined;
    }
    const role = `"${runtimeRole}"`;
    await tx.query("REVOKE CREATE ON SCHEMA public FROM PUBLIC");
    await tx.query(`GRANT USAGE ON SCHEMA public TO ${role}`);
    await tx.query(
      `GRANT EXECUTE ON FUNCTION resolve_session(text) TO ${role}`,
    );
    await tx.query(
      `GRANT EXECUTE ON FUNCTION staff_login_identity(text),staff_login_tenants(uuid),issue_staff_session(uuid,uuid,text),revoke_staff_session(text),revoke_staff_membership_sessions(uuid,uuid),revoke_all_staff_sessions(uuid),accept_staff_invitation(text,text),login_attempt_allowed(text),record_login_attempt(text,boolean),begin_password_reset(text,text),complete_password_reset(text,text),request_support_access(uuid,uuid,uuid,text,text[]),issue_support_session(uuid,uuid,text),revoke_support_session(text),list_current_tenant_support_access(),current_support_actor_profile(uuid) TO ${role}`,
    );
    await tx.query(
      `GRANT EXECUTE ON FUNCTION resolve_connector_account(uuid) TO ${role}`,
    );
    await tx.query(
      `GRANT SELECT,INSERT,UPDATE,DELETE ON tenants,staff_users,memberships,tenant_roles,role_permissions,tenant_invitations,products,product_options,passenger_units,rate_plans,schedules,availability_rules,availability_rule_times,availability_exceptions,departures,holds,bookings,customers,support_access_grants,support_sessions,outbox_events,pickup_locations,departure_pickup_plans,pickup_stops,departure_itinerary_points,waiver_templates,tenant_subscriptions,operational_resources,crew_profiles,compliance_documents,departure_assignments,booking_checkins,booking_passengers,passenger_checkins,passenger_checkin_tokens,trip_runs,trip_run_events,print_templates,printer_routes,print_jobs,partner_organizations,booking_partner_attributions,booking_partner_snapshots,partner_collection_claims,partner_obligations,connector_accounts,webhook_inbox,external_mappings,assisted_imports,assisted_import_rows,notification_messages,cruise_calls,accommodation_properties TO ${role}`,
    );
    await tx.query(`GRANT SELECT,INSERT ON partner_claim_decisions TO ${role}`);
    await tx.query(
      `REVOKE INSERT,UPDATE,DELETE ON subscription_plans FROM ${role}`,
    );
    await tx.query(`GRANT SELECT ON subscription_plans TO ${role}`);
    await tx.query(
      `GRANT SELECT ON app_modules,permissions,connector_definitions TO ${role}`,
    );
    await tx.query(
      `GRANT SELECT,INSERT ON booking_changes,booking_change_quotes,payments,payment_adjustments,price_snapshots,audit_events,event_receipts,idempotency_keys,waiver_signatures TO ${role}`,
    );
    await tx.query("COMMIT");
    printSummary({
      status: "COMPLETE",
      known: names.length,
      previouslyApplied,
      appliedThisRun,
      pending: [],
      elapsedMs: Date.now() - startedAt,
    });
  } catch (e) {
    await tx.query("ROLLBACK");
    const failed = activeMigration;
    const firstUncommitted = failed ? names.indexOf(failed) : previouslyApplied;
    const pending = names.slice(Math.max(0, firstUncommitted));
    console.error(
      "The transaction was rolled back; no scripts from this run were applied.",
    );
    printSummary({
      status: "INCOMPLETE",
      known: names.length,
      previouslyApplied,
      appliedThisRun: [],
      pending,
      failed,
      elapsedMs: Date.now() - startedAt,
    });
    throw e;
  } finally {
    tx.release();
    await pool.end();
  }
}
if (require.main === module) {
  if (!process.env.ADMIN_DATABASE_URL || !process.env.DATABASE_ROLE)
    throw new Error("ADMIN_DATABASE_URL and DATABASE_ROLE required");
  migrate(process.env.ADMIN_DATABASE_URL, process.env.DATABASE_ROLE).catch(
    (e) => {
      console.error(e.message);
      process.exitCode = 1;
    },
  );
}
