import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { createServer } from "node:net";
import { Pool } from "pg";
import { migrate } from "./migrate";

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No port");
  await new Promise<void>((r, j) => server.close((e) => (e ? j(e) : r())));
  return address.port;
}
export async function localDatabase() {
  // TEST_ADMIN_DATABASE_URL must target a disposable test database (e.g. CI service).
  const external = process.env.TEST_ADMIN_DATABASE_URL;
  let adminUrl = external,
    stop = async () => {};
  if (!external) {
    const root = await mkdtemp(path.join(tmpdir(), "zettaz-pg-")),
      data = path.join(root, "data");
    const port = await freePort();
    const password = randomBytes(24).toString("hex");
    const pwfile = path.join(root, "password");
    await writeFile(pwfile, password, { mode: 0o600 });
    execFileSync(
      "initdb",
      [
        "-D",
        data,
        "-U",
        "zettaz_admin",
        "--auth-host=scram-sha-256",
        "--auth-local=trust",
        "--pwfile",
        pwfile,
      ],
      { stdio: "pipe" },
    );
    await mkdir(path.join(root, "socket"));
    execFileSync(
      "pg_ctl",
      [
        "-D",
        data,
        "-l",
        path.join(root, "server.log"),
        "-o",
        `-p ${port} -h 127.0.0.1 -k ${path.join(root, "socket")}`,
        "-w",
        "start",
      ],
      { stdio: "pipe" },
    );
    adminUrl = `postgresql://zettaz_admin:${password}@127.0.0.1:${port}/postgres`;
    stop = async () => {
      execFileSync("pg_ctl", ["-D", data, "-m", "fast", "-w", "stop"], {
        stdio: "pipe",
      });
    };
  }
  const role = `zettaz_runtime_${randomBytes(6).toString("hex")}`,
    password = randomBytes(24).toString("hex");
  const admin = new Pool({ connectionString: adminUrl });
  try {
    await admin.query(
      `CREATE ROLE "${role}" LOGIN PASSWORD '${password}' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE`,
    );
    await admin.query(
      `DO $$ BEGIN CREATE ROLE zettaz_runtime NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
    );
    await migrate(adminUrl!, role);
    const runtime = new URL(adminUrl!);
    runtime.username = role;
    runtime.password = password;
    return { adminUrl: adminUrl!, runtimeUrl: runtime.toString(), role, stop };
  } catch (e) {
    await stop();
    throw e;
  } finally {
    await admin.end();
  }
}
