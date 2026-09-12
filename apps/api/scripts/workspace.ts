import { spawn, type ChildProcess } from "node:child_process";
import { resolve } from "node:path";

async function main() {
  if (process.env.NODE_ENV === "production")
    throw new Error("Persistent local workspace cannot run in production");
  if (!process.env.DATABASE_URL)
    throw new Error("DATABASE_URL is required; run npm run db:migrate first");
  const apiPort = String(process.env.PORT ?? 3190);
  const webPort = String(process.env.WEB_PORT ?? 3191);
  const shared = { ...process.env, APP_MODE: "demo" };
  const api = spawn(
    process.execPath,
    ["--watch", resolve("dist/apps/api/src/main.js")],
    {
      cwd: resolve("."),
      env: shared,
      stdio: "inherit",
    },
  );
  const web = spawn(
    process.execPath,
    [
      require.resolve("next/dist/bin/next"),
      "dev",
      "--webpack",
      "--hostname",
      "127.0.0.1",
      "--port",
      webPort,
    ],
    {
      cwd: resolve("apps/web"),
      env: {
        ...shared,
        PORT: apiPort,
        API_BASE_URL: `http://127.0.0.1:${apiPort}`,
        WEB_ORIGIN: `http://127.0.0.1:${webPort}`,
      },
      stdio: "inherit",
    },
  );
  console.log(`Persistent workspace: http://127.0.0.1:${webPort}`);
  await new Promise<void>((resolvePromise, reject) => {
    const stop = () => resolvePromise();
    api.once("error", reject);
    web.once("error", reject);
    api.once("exit", stop);
    web.once("exit", stop);
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });
  for (const child of [api, web]) {
    if (child.exitCode === null && child.signalCode === null)
      child.kill("SIGTERM");
  }
}
main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
