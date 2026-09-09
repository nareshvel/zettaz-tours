import { Pool } from "pg";
import { randomBytes, randomUUID } from "node:crypto";
import { digest } from "../src/database";

// Privileged local bootstrap only; no HTTP token-issuance endpoint or shared demo secret.
export async function issueSession(
  admin: Pool,
  actorId: string,
  tenantId: string | null,
) {
  const token = randomBytes(32).toString("base64url");
  if (tenantId)
    await admin.query(
      `INSERT INTO staff_sessions VALUES($1,$2,$3,now()+interval '8 hours',false)`,
      [digest(token), actorId, tenantId],
    );
  else
    await admin.query(
      `INSERT INTO platform_sessions VALUES($1,$2,now()+interval '8 hours',false)`,
      [digest(token), actorId],
    );
  return token;
}
export async function bootstrapPlatform(admin: Pool) {
  const actorId = randomUUID();
  await admin.query("INSERT INTO platform_users VALUES($1,$2)", [
    actorId,
    "Mock platform administrator",
  ]);
  return issueSession(admin, actorId, null);
}
