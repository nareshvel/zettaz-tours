"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.issueSession = issueSession;
exports.bootstrapPlatform = bootstrapPlatform;
const node_crypto_1 = require("node:crypto");
const database_1 = require("../src/database");
// Privileged local bootstrap only; no HTTP token-issuance endpoint or shared demo secret.
async function issueSession(admin, actorId, tenantId) {
    const token = (0, node_crypto_1.randomBytes)(32).toString("base64url");
    if (tenantId)
        await admin.query(`INSERT INTO staff_sessions VALUES($1,$2,$3,now()+interval '8 hours',false)`, [(0, database_1.digest)(token), actorId, tenantId]);
    else
        await admin.query(`INSERT INTO platform_sessions VALUES($1,$2,now()+interval '8 hours',false)`, [(0, database_1.digest)(token), actorId]);
    return token;
}
async function bootstrapPlatform(admin) {
    const actorId = (0, node_crypto_1.randomUUID)();
    await admin.query("INSERT INTO platform_users VALUES($1,$2)", [
        actorId,
        "Mock platform administrator",
    ]);
    return issueSession(admin, actorId, null);
}
