import process from "node:process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createIsolatedDevelopmentApplication } from "./development-bootstrap.js";
import { createTraceabilityHttpServer } from "./http-server.js";

const host = process.env.HOST ?? "127.0.0.1";
const port = Number(process.env.PORT ?? 3000);
if (!Number.isInteger(port) || port < 0 || port > 65535) {
  throw new Error("PORT must be an integer between 0 and 65535");
}

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const sourceRoot = process.env.TRAQEN_DEVELOPMENT_SOURCE_ROOT ?? repositoryRoot;
const { application, corsAllowedOrigins, development } = await createIsolatedDevelopmentApplication({
  sourceRoot,
  env: process.env,
});
const server = createTraceabilityHttpServer({ application, corsAllowedOrigins });

server.listen(port, host, () => {
  const address = server.address();
  process.stdout.write(`Traqen development API listening on http://${host}:${address.port}\n`);
  process.stdout.write(`Isolated reference analysis source allowlist: ${development.sourceRoot}\n`);
  process.stdout.write("This in-memory reference bootstrap is local-development-only and is not production evidence.\n");
});

function shutdown(signal) {
  server.close((error) => {
    if (error) {
      process.stderr.write(`${error.stack ?? error.message}\n`);
      process.exitCode = 1;
    }
    process.stdout.write(`Traqen development API stopped after ${signal}\n`);
  });
}

process.once("SIGINT", () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));
