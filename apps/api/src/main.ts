import { createApp } from "./app";

async function main() {
  const port = Number(process.env.PORT ?? 3190);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new Error("Invalid PORT");
  }

  const host = process.env.API_HOST?.trim() || "127.0.0.1";
  const app = await createApp();

  app.enableShutdownHooks();
  await app.listen(port, host);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Startup failed");
  process.exitCode = 1;
});