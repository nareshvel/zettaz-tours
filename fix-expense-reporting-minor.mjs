/**
 * One-off fix: correct amount_reporting_minor for two classes of bad rows.
 *
 * 1. Same-currency expenses where amount_reporting_minor is NULL
 *    → set amount_reporting_minor = amount_minor (1:1, no conversion)
 *
 * 2. Foreign-currency expenses where the old UI stored the raw bank-board rate
 *    (e.g. 2.7169) as fx_rate instead of the inverted rate (0.368050).
 *    These have amount_reporting_minor >> amount_minor by the wrong factor.
 *    → recompute: amount_reporting_minor = round(amount_minor * fx_rate)
 *      BUT only after you manually verify and re-enter the correct rate via
 *      the Edit Expense modal. This script only fixes the same-currency case.
 *
 * Run: node --env-file=.env.development fix-expense-reporting-minor.mjs
 */
import pg from "pg";

const url = process.env.ADMIN_DATABASE_URL ?? process.env.DATABASE_URL;
if (!url) { console.error("No DATABASE_URL or ADMIN_DATABASE_URL in env"); process.exit(1); }

const client = new pg.Client({ connectionString: url });
await client.connect();

try {
  await client.query("BEGIN");

  // 1. Same-currency: set amount_reporting_minor = amount_minor where null
  const sameCcy = await client.query(`
    UPDATE expenses e
    SET amount_reporting_minor = e.amount_minor
    FROM tenants t
    WHERE e.tenant_id = t.id
      AND e.voided_at IS NULL
      AND e.amount_reporting_minor IS NULL
      AND (
        e.currency = t.reporting_currency
        OR (t.reporting_currency IS NULL AND e.currency = t.base_currency)
      )
    RETURNING e.id, e.currency, e.amount_minor, e.amount_reporting_minor
  `);
  console.log(`Fixed ${sameCcy.rowCount} same-currency rows (amount_reporting_minor was null)`);
  sameCcy.rows.forEach(r =>
    console.log(`  id=${r.id} currency=${r.currency} minor=${r.amount_minor} → reporting=${r.amount_reporting_minor}`)
  );

  // 2. Show foreign-currency rows so you can see which need manual re-entry
  const foreign = await client.query(`
    SELECT e.id, e.currency, e.amount_minor, e.fx_rate, e.amount_reporting_minor,
           e.description, e.vendor,
           COALESCE(t.reporting_currency, t.base_currency) AS reporting_currency
    FROM expenses e
    JOIN tenants t ON t.id = e.tenant_id
    WHERE e.voided_at IS NULL
      AND e.currency != COALESCE(t.reporting_currency, t.base_currency)
    ORDER BY e.created_at DESC
  `);
  if (foreign.rowCount > 0) {
    console.log(`\nForeign-currency expenses (check these manually):`);
    foreign.rows.forEach(r => {
      const expected = r.fx_rate ? Math.round(r.amount_minor * r.fx_rate) : null;
      const ratio = r.amount_reporting_minor && r.amount_minor
        ? (r.amount_reporting_minor / r.amount_minor).toFixed(4)
        : "?";
      const suspicious = r.fx_rate > 1 && r.amount_reporting_minor > r.amount_minor;
      console.log(
        `  ${suspicious ? "⚠ LIKELY BAD" : "  ok        "} id=${r.id}` +
        ` ${r.currency}→${r.reporting_currency}` +
        ` minor=${r.amount_minor} fx_rate=${r.fx_rate}` +
        ` amount_reporting_minor=${r.amount_reporting_minor}` +
        ` (ratio=${ratio})` +
        ` vendor=${r.vendor} desc=${r.description}`
      );
    });
    console.log(`\n  ⚠ rows marked LIKELY BAD have fx_rate > 1 (old bank-board rate stored raw).`);
    console.log(`    Edit each one in the UI with the correct rate to recompute.`);
    console.log(`    Or run the UPDATE below after confirming the correct fx_rate:\n`);
    foreign.rows.filter(r => r.fx_rate > 1).forEach(r => {
      const correctFxRate = `1/${r.fx_rate} = ${(1/r.fx_rate).toFixed(6)}`;
      const correctMinor = Math.round(r.amount_minor / r.fx_rate);
      console.log(
        `    UPDATE expenses SET fx_rate=${(1/r.fx_rate).toFixed(6)},` +
        ` amount_reporting_minor=${correctMinor}` +
        ` WHERE id='${r.id}';  -- was ${r.amount_reporting_minor}, corrected to ${correctMinor}`
      );
    });
  }

  await client.query("COMMIT");
  console.log("\nDone.");
} catch (err) {
  await client.query("ROLLBACK");
  console.error("Error:", err.message);
  process.exit(1);
} finally {
  await client.end();
}
