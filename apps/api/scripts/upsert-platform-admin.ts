import { Pool } from "pg";
import { upsertPlatformAdmin, PLATFORM_ADMIN_EMAIL } from "./sessions";

async function main() {
  const url = process.env.ADMIN_DATABASE_URL;
  if (!url) throw new Error("ADMIN_DATABASE_URL is required");
  const password =
    process.env.PLATFORM_ADMIN_PASSWORD || process.env.LOCAL_DEFAULT_PASSWORD;
  if (!password) {
    throw new Error(
      "Set PLATFORM_ADMIN_PASSWORD (or LOCAL_DEFAULT_PASSWORD for local seed).",
    );
  }
  const admin = new Pool({ connectionString: url });
  try {
    const email = process.env.PLATFORM_ADMIN_EMAIL || PLATFORM_ADMIN_EMAIL;
    await upsertPlatformAdmin(admin, password, email);
    console.log(`Platform administrator ready: ${email}`);
  } finally {
    await admin.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
