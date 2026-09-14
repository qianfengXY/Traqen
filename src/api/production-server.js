import process from "node:process";
import { fileURLToPath } from "node:url";

import { createConfiguredApplication } from "./application-bootstrap.js";
import { createTraceabilityHttpServer } from "./http-server.js";
import { createSourceTruthRuntime, readSourceTruthConfiguration } from "../source-truth/configuration.js";
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
// Parse private Source Truth settings before constructing any runtime. A typo or
// insecure config is a startup failure, not a silently absent persistence layer.
const sourceConfiguration = process.env.SOURCE_TRUTH_CONFIG
  ? await readSourceTruthConfiguration(process.env.SOURCE_TRUTH_CONFIG).catch((error) => { throw new Error(`${error.code ?? "SOURCE_CONFIGURATION_INVALID"}: 来源快照私有配置未通过校验`); })
  : null;
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
let sourceRuntime = null;
try {
  if (sourceConfiguration) sourceRuntime = await createSourceTruthRuntime({ configuration: sourceConfiguration,
    connectionString: requiredEnvironment("DATABASE_URL"), ssl: postgresSsl(process.env.POSTGRES_SSL), host });
} catch (error) {
  await database.close();
  throw new Error(`${error.code ?? "SOURCE_CONFIGURATION_INVALID"}: 来源快照部署条件未通过校验；未开放服务`);
}
const server = createTraceabilityHttpServer({ application, corsAllowedOrigins, apiBearerToken, sourceTruthHandler: sourceRuntime?.sourceTruthHandler,
  sourceTruthAllowedOrigins: sourceConfiguration?.origins });

server.listen(port, host, () => {
  sourceRuntime?.start();
  const address = server.address();
  process.stdout.write(`Traqen API listening on http://${host}:${address.port}\n`);
});

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  const closed = new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  server.closeAllConnections();
  await sourceRuntime?.close();
  await closed;
  await database.close();
  process.stdout.write(`Traqen API stopped after ${signal}\n`);
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => shutdown(signal).catch((error) => {
    process.stderr.write(`${error.stack ?? error.message}\n`);
    process.exitCode = 1;
  }));
}
