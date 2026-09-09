import { createApp } from "../src/app";
import { Database, digest } from "../src/database";
import { OutboxService } from "../src/operations";

async function main() {
  const token = process.env.STAFF_SESSION_TOKEN;
  if (!token) throw new Error("STAFF_SESSION_TOKEN required");
  const app = await createApp();
  try {
    const {
      rows: [s],
    } = await app
      .get(Database)
      .pool.query("SELECT * FROM resolve_session($1)", [digest(token)]);
    if (!s || s.platform || s.role !== "owner")
      throw new Error("Active tenant owner session required");
    console.log(
      await app.get(OutboxService).drain({
        actorId: s.actor_id,
        tenantId: s.tenant_id,
        platform: false,
        permissions: s.permissions,
        role: s.role,
      }),
    );
  } finally {
    await app.close();
  }
}
main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
