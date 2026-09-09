"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.localDatabase = localDatabase;
const node_child_process_1 = require("node:child_process");
const promises_1 = require("node:fs/promises");
const node_os_1 = require("node:os");
const node_path_1 = __importDefault(require("node:path"));
const node_crypto_1 = require("node:crypto");
const node_net_1 = require("node:net");
const pg_1 = require("pg");
const migrate_1 = require("./migrate");
async function freePort() {
    const server = (0, node_net_1.createServer)();
    await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    if (!address || typeof address === "string")
        throw new Error("No port");
    await new Promise((r, j) => server.close((e) => (e ? j(e) : r())));
    return address.port;
}
async function localDatabase() {
    // TEST_ADMIN_DATABASE_URL must target a disposable test database (e.g. CI service).
    const external = process.env.TEST_ADMIN_DATABASE_URL;
    let adminUrl = external, stop = async () => { };
    if (!external) {
        const root = await (0, promises_1.mkdtemp)(node_path_1.default.join((0, node_os_1.tmpdir)(), "zettaz-pg-")), data = node_path_1.default.join(root, "data");
        const port = await freePort();
        const password = (0, node_crypto_1.randomBytes)(24).toString("hex");
        const pwfile = node_path_1.default.join(root, "password");
        await (0, promises_1.writeFile)(pwfile, password, { mode: 0o600 });
        (0, node_child_process_1.execFileSync)("initdb", [
            "-D",
            data,
            "-U",
            "zettaz_admin",
            "--auth-host=scram-sha-256",
            "--auth-local=trust",
            "--pwfile",
            pwfile,
        ], { stdio: "pipe" });
        await (0, promises_1.mkdir)(node_path_1.default.join(root, "socket"));
        (0, node_child_process_1.execFileSync)("pg_ctl", [
            "-D",
            data,
            "-l",
            node_path_1.default.join(root, "server.log"),
            "-o",
            `-p ${port} -h 127.0.0.1 -k ${node_path_1.default.join(root, "socket")}`,
            "-w",
            "start",
        ], { stdio: "pipe" });
        adminUrl = `postgresql://zettaz_admin:${password}@127.0.0.1:${port}/postgres`;
        stop = async () => {
            (0, node_child_process_1.execFileSync)("pg_ctl", ["-D", data, "-m", "fast", "-w", "stop"], {
                stdio: "pipe",
            });
        };
    }
    const role = `zettaz_runtime_${(0, node_crypto_1.randomBytes)(6).toString("hex")}`, password = (0, node_crypto_1.randomBytes)(24).toString("hex");
    const admin = new pg_1.Pool({ connectionString: adminUrl });
    try {
        await admin.query(`CREATE ROLE "${role}" LOGIN PASSWORD '${password}' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE`);
        await (0, migrate_1.migrate)(adminUrl, role);
        const runtime = new URL(adminUrl);
        runtime.username = role;
        runtime.password = password;
        return { adminUrl: adminUrl, runtimeUrl: runtime.toString(), role, stop };
    }
    catch (e) {
        await stop();
        throw e;
    }
    finally {
        await admin.end();
    }
}
