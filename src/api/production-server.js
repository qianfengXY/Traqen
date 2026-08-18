import process from "node:process";
import { fileURLToPath } from "node:url";

import { createConfiguredApplication } from "./application-bootstrap.js";
import { createTraceabilityHttpServer } from "./http-server.js";
import {
  applyMigrations,
  connectPostgresDatabase,
  PostgresTraceabilityStore,
} from "../storage/index.js";

function requiredEnvironment(name) {
  const value = process.env[name];
  if (typeof value !== "string" || value === "") throw new Error(`${name} is required`);
  return value;
}

function postgresSsl(value = "require") {
  if (value === "disable") return false;
  if (value === "require") return { rejectUnauthorized: true };
  if (value === "no-verify") return { rejectUnauthorized: false };
  throw new Error("POSTGRES_SSL must be require, no-verify, or disable");
}

const host = process.env.HOST ?? "0.0.0.0";
const port = Number(process.env.PORT ?? 3000);
if (!Number.isInteger(port) || port < 0 || port > 65535) {
  throw new Error("PORT must be an integer between 0 and 65535");
}
const apiBearerToken = requiredEnvironment("API_BEARER_TOKEN");
const database = await connectPostgresDatabase({
  connectionString: requiredEnvironment("DATABASE_URL"),
  ssl: postgresSsl(process.env.POSTGRES_SSL),
});
const migrationsDirectory = fileURLToPath(new URL("../../db/migrations", import.meta.url));
try {
  await applyMigrations(database, migrationsDirectory);
} catch (error) {
  await database.close().catch(() => {});
  throw error;
}
const configuredApplication = createConfiguredApplication({
  store: new PostgresTraceabilityStore(database),
  env: process.env,
});
await configuredApplication.ready;
const { application, corsAllowedOrigins } = configuredApplication;
const server = createTraceabilityHttpServer({ application, corsAllowedOrigins, apiBearerToken });

server.listen(port, host, () => {
  const address = server.address();
  process.stdout.write(`Traqen API listening on http://${host}:${address.port}\n`);
});

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  await database.close();
  process.stdout.write(`Traqen API stopped after ${signal}\n`);
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => shutdown(signal).catch((error) => {
    process.stderr.write(`${error.stack ?? error.message}\n`);
    process.exitCode = 1;
  }));
}
