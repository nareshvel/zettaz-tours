"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const app_1 = require("./app");
async function main() {
    const port = Number(process.env.PORT ?? 3190);
    if (!Number.isInteger(port) || port < 1024 || port > 65535)
        throw new Error("Invalid PORT");
    const app = await (0, app_1.createApp)();
    app.enableShutdownHooks();
    await app.listen(port, "127.0.0.1");
}
main().catch((error) => {
    console.error(error instanceof Error ? error.message : "Startup failed");
    process.exitCode = 1;
});
