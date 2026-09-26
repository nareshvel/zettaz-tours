import { Pool } from "pg";
import {
  randomBytes,
  randomUUID,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";
import { digest } from "../src/database";
const scrypt = promisify(scryptCallback);
export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("base64url");
  const derived = (await scrypt(password, salt, 64)) as Buffer;
  return `scrypt$${salt}$${derived.toString("base64url")}`;
}
export async function verifyPassword(password: string, stored: string) {
  const [algorithm, salt, encoded] = stored.split("$");
  if (algorithm !== "scrypt" || !salt || !encoded) return false;
  const actual = (await scrypt(password, salt, 64)) as Buffer;
  const expected = Buffer.from(encoded, "base64url");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

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
export const PLATFORM_ADMIN_ID = "1b91ecbf-54a5-4afc-b0a5-95192f0527d3";
export const PLATFORM_ADMIN_EMAIL = "systemadmin@zettaz.com";

export async function upsertPlatformAdmin(
  admin: Pool,
  password: string,
  email = process.env.PLATFORM_ADMIN_EMAIL || PLATFORM_ADMIN_EMAIL,
) {
  const hash = await hashPassword(password);
  await admin.query(
    `INSERT INTO platform_users(id,name,email,password_hash)
     VALUES($1,$2,$3,$4)
     ON CONFLICT (id) DO UPDATE SET
       name=EXCLUDED.name,
       email=EXCLUDED.email,
       password_hash=EXCLUDED.password_hash`,
    [PLATFORM_ADMIN_ID, "Zettaz platform administrator", email, hash],
  );
}

export async function bootstrapPlatform(admin: Pool) {
  const actorId = randomUUID();
  const hash = await hashPassword("ZettazPlatform!test12");
  await admin.query(
    "INSERT INTO platform_users(id,name,email,password_hash) VALUES($1,$2,$3,$4)",
    [
      actorId,
      "Mock platform administrator",
      `platform-${actorId}@example.invalid`,
      hash,
    ],
  );
  return issueSession(admin, actorId, null);
}
