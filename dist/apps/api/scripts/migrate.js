"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.migrate = migrate;
const pg_1 = require("pg");
const node_crypto_1 = require("node:crypto");
const promises_1 = require("node:fs/promises");
const node_path_1 = __importDefault(require("node:path"));
async function migrate(adminUrl, runtimeRole) {
    if (!/^[a-z][a-z0-9_]{0,62}$/.test(runtimeRole))
        throw new Error("Invalid runtime role name");
    const pool = new pg_1.Pool({ connectionString: adminUrl });
    const tx = await pool.connect();
    try {
        await tx.query("BEGIN");
        await tx.query("SELECT pg_advisory_xact_lock(982134701)");
        await tx.query(`CREATE TABLE IF NOT EXISTS schema_migrations(name text PRIMARY KEY,checksum text NOT NULL,applied_at timestamptz DEFAULT now())`);
        const dir = node_path_1.default.resolve("apps/api/migrations");
        for (const name of (await (0, promises_1.readdir)(dir))
            .filter((n) => n.endsWith(".sql"))
            .sort()) {
            const sql = await (0, promises_1.readFile)(node_path_1.default.join(dir, name), "utf8");
            const hash = (0, node_crypto_1.createHash)("sha256").update(sql).digest("hex");
            const { rows: [prior], } = await tx.query("SELECT checksum FROM schema_migrations WHERE name=$1", [name]);
            if (prior) {
                if (prior.checksum !== hash)
                    throw new Error(`Applied migration was modified: ${name}`);
                continue;
            }
            await tx.query(sql);
            await tx.query("INSERT INTO schema_migrations(name,checksum) VALUES($1,$2)", [name, hash]);
        }
        const role = `"${runtimeRole}"`;
        await tx.query("REVOKE CREATE ON SCHEMA public FROM PUBLIC");
        await tx.query(`GRANT USAGE ON SCHEMA public TO ${role}`);
        await tx.query(`GRANT EXECUTE ON FUNCTION resolve_session(text) TO ${role}`);
        await tx.query(`GRANT SELECT,INSERT,UPDATE,DELETE ON tenants,staff_users,memberships,products,schedules,departures,holds,bookings,outbox_events,pickup_locations,departure_pickup_plans,pickup_stops TO ${role}`);
        await tx.query(`GRANT SELECT,INSERT ON booking_changes,booking_change_quotes,payments,price_snapshots,audit_events,event_receipts,idempotency_keys TO ${role}`);
        await tx.query("COMMIT");
    }
    catch (e) {
        await tx.query("ROLLBACK");
        throw e;
    }
    finally {
        tx.release();
        await pool.end();
    }
}
if (require.main === module) {
    if (!process.env.ADMIN_DATABASE_URL || !process.env.DATABASE_ROLE)
        throw new Error("ADMIN_DATABASE_URL and DATABASE_ROLE required");
    migrate(process.env.ADMIN_DATABASE_URL, process.env.DATABASE_ROLE).catch((e) => {
        console.error(e.message);
        process.exitCode = 1;
    });
}
