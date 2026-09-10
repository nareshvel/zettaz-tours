import { createApp } from "../src/app";
import { Database, digest } from "../src/database";
import { IntegrationService } from "../src/integrations";

async function main() {
  const token = process.env.STAFF_SESSION_TOKEN;
  if (!token) throw new Error("STAFF_SESSION_TOKEN required");
  const app = await createApp();
  try {
    const {
      rows: [session],
    } = await app
      .get(Database)
      .pool.query("SELECT * FROM resolve_session($1)", [digest(token)]);
    if (
      !session ||
      session.platform ||
      !session.permissions.includes("integration.manage")
    )
      throw new Error(
        "Active tenant integration administrator session required",
      );
    console.log(
      await app.get(IntegrationService).drainRetries({
        actorId: session.actor_id,
        tenantId: session.tenant_id,
        platform: false,
        permissions: session.permissions,
        role: session.role,
      }),
    );
  } finally {
    await app.close();
  }
}
main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
