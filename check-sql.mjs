/**
 * Throwaway: EXPLAIN every SQL statement in the endpoints added this session.
 *
 * It PLANS each query without running it, so the database is untouched, but the
 * planner still resolves every table, column and cast — which is exactly the
 * class of error that has slipped through three times (products.active,
 * generate_series returning timestamps, a missing payload field).
 *
 *   node check-sql.mjs                 # .env.development
 *   DATABASE_URL=... node check-sql.mjs
 *
 * Delete this file when you are done with it.
 */
import { readFileSync } from "node:fs";
import pg from "pg";

const SOURCES = [
  "apps/api/src/workspace.ts",
  "apps/api/src/tenant.ts",
];

function envUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const file = readFileSync(".env.development", "utf8");
  const line = file.split("\n").find((l) => l.startsWith("DATABASE_URL="));
  if (!line) throw new Error("No DATABASE_URL in .env.development");
  return line.slice("DATABASE_URL=".length).trim();
}

/** Backtick template literals that look like a statement and carry no ${} holes. */
function statements(path) {
  const source = readFileSync(path, "utf8");
  const found = [];
  const re = /`([^`\\]*(?:\\.[^`\\]*)*)`/g;
  let match;
  while ((match = re.exec(source))) {
    const sql = match[1];
    if (!/^\s*(SELECT|WITH)\b/i.test(sql)) continue;
    if (sql.includes("${")) continue;
    found.push({
      path,
      line: source.slice(0, match.index).split("\n").length,
      sql,
    });
  }
  return found;
}

const url = envUrl();
const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 5000 });
await client.connect();

// A tenant to plan against; RLS policies read app.tenant, and an absent
// setting is handled by nullif() in every policy, so this is belt and braces.
const { rows: tenants } = await client.query("SELECT id FROM tenants LIMIT 1");
const tenantId = tenants[0]?.id ?? "00000000-0000-0000-0000-000000000000";
await client.query("SELECT set_config('app.tenant',$1,false)", [tenantId]);
// Everything below runs inside one transaction that is rolled back, so even a
// mistaken statement cannot touch data.
await client.query("BEGIN");

const today = new Date().toISOString().slice(0, 10);

/**
 * A parameter is a tenant id or a date in these queries, and nothing in the SQL
 * says which. Rather than guess, try each combination and accept the first that
 * plans — a genuine schema error fails every combination, a type mismatch does
 * not.
 */
function vectors(count, tenantId) {
  if (!count) return [[]];
  const out = [];
  for (let mask = 0; mask < 2 ** count; mask += 1)
    out.push(
      Array.from({ length: count }, (_, index) =>
        mask & (1 << index) ? today : tenantId,
      ),
    );
  // Tenant-first is overwhelmingly the real shape, so try it first.
  return out.sort((a, b) => (a[0] === tenantId ? -1 : 1) - (b[0] === tenantId ? -1 : 1));
}

let failed = 0;
let checked = 0;
for (const item of SOURCES.flatMap(statements)) {
  const highest = Math.max(
    0,
    ...[...item.sql.matchAll(/\$(\d+)/g)].map((m) => Number(m[1])),
  );
  let planned = false;
  let lastError = null;
  for (const values of vectors(highest, tenantId)) {
    try {
      // A savepoint keeps one failed plan from poisoning the session.
      await client.query("SAVEPOINT probe");
      await client.query({ text: `EXPLAIN ${item.sql}`, values });
      await client.query("RELEASE SAVEPOINT probe");
      planned = true;
      break;
    } catch (error) {
      lastError = error;
      await client.query("ROLLBACK TO SAVEPOINT probe").catch(() => {});
      await client.query("RELEASE SAVEPOINT probe").catch(() => {});
    }
  }
  checked += 1;
  if (planned) {
    console.log(`  ok   ${item.path}:${item.line}`);
  } else {
    failed += 1;
    console.log(`\n  FAIL ${item.path}:${item.line}`);
    console.log(`       ${lastError?.message}`);
    console.log(`       ${item.sql.trim().split("\n")[0].slice(0, 100)}…\n`);
  }
}
await client.query("ROLLBACK");
await client.end();
console.log(
  failed
    ? `\n${failed} of ${checked} statements failed to plan.`
    : `\nAll ${checked} statements plan cleanly.`,
);
process.exit(failed ? 1 : 0);
