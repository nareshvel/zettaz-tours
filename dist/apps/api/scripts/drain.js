"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const app_1 = require("../src/app");
const database_1 = require("../src/database");
const operations_1 = require("../src/operations");
async function main() {
    const token = process.env.STAFF_SESSION_TOKEN;
    if (!token)
        throw new Error("STAFF_SESSION_TOKEN required");
    const app = await (0, app_1.createApp)();
    try {
        const { rows: [s], } = await app
            .get(database_1.Database)
            .pool.query("SELECT * FROM resolve_session($1)", [(0, database_1.digest)(token)]);
        if (!s || s.platform || s.role !== "owner")
            throw new Error("Active tenant owner session required");
        console.log(await app.get(operations_1.OutboxService).drain({
            actorId: s.actor_id,
            tenantId: s.tenant_id,
            platform: false,
            permissions: s.permissions,
            role: s.role,
        }));
    }
    finally {
        await app.close();
    }
}
main().catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
});
