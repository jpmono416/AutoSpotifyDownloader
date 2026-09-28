import { loadEnvConfig } from "@next/env";
import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import next from "next";
import { announceMode, loopbackAddress, trustedLocalRequest } from "../src/lib/app-mode";

process.env.LOCAL_REQUEST_SECRET = randomBytes(32).toString("hex");
loadEnvConfig(process.cwd());
if (announceMode() !== "local") throw new Error("Use APP_MODE=local with LOCAL_DATABASE_URL to run the local launcher.");
const port = Number(process.env.PORT ?? 3000);
const app = next({ dev: !process.argv.includes("--built"), hostname: "127.0.0.1", port });
async function main() {
  await app.prepare();
  const handler = app.getRequestHandler();
  createServer((request, response) => {
    delete request.headers["x-asd-local-proof"];
    request.headers["x-asd-local-proof"] = process.env.LOCAL_REQUEST_SECRET;
    const headers = new Headers();
    for (const [key, value] of Object.entries(request.headers)) if (value) headers.set(key, Array.isArray(value) ? value.join(",") : value);
    if (!loopbackAddress(request.socket.remoteAddress ?? "") || !trustedLocalRequest(headers)) {
      response.writeHead(403); response.end("Trusted loopback requests only."); return;
    }
    void handler(request, response);
  }).listen(port, "127.0.0.1", () => console.log(`Local single-user workspace: http://127.0.0.1:${port}`));
}
main().catch(() => { console.error("Local server failed to start. Check mode, database and port configuration."); process.exitCode = 1; });
