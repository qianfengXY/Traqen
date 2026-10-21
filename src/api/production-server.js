import pg from "pg";
import { authRuntime, privateFile } from "../auth/runtime.js";
import { createHmac } from "node:crypto";
import { createF002Runtime } from "../deterministic-facts/runtime.js";
import { contextualDatabase } from "../auth/database.js";
import { authorizedStore } from "../auth/authorized-store.js";
import { authContext } from "../auth/context.js";
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

if (process.env.TRAQEN_AUTH_DEVELOPMENT === 'true') throw new Error('Use the isolated development entry for HTTP development; production requires HTTPS authentication');
const host = process.env.HOST ?? "127.0.0.1";
if (!["127.0.0.1","::1","localhost"].includes(host)) throw new Error("Authentication API must bind loopback behind the configured same-origin HTTPS gateway");
const port = Number(process.env.PORT ?? 3000);
if (!Number.isInteger(port) || port < 0 || port > 65535) {
  throw new Error("PORT must be an integer between 0 and 65535");
}

// Parse private Source Truth settings before constructing any runtime. A typo or
// insecure config is a startup failure, not a silently absent persistence layer.
const sourceConfiguration = process.env.SOURCE_TRUTH_CONFIG
  ? await readSourceTruthConfiguration(process.env.SOURCE_TRUTH_CONFIG,{unifiedAuthentication:true}).catch((error) => { throw new Error(`${error.code ?? "SOURCE_CONFIGURATION_INVALID"}: 来源快照私有配置未通过校验`); })
  : null;
const pool = new pg.Pool({ connectionString: requiredEnvironment("DATABASE_URL"), ssl: postgresSsl(process.env.POSTGRES_SSL) });
const database = contextualDatabase(pool);
const migrationsDirectory = fileURLToPath(new URL("../../db/migrations", import.meta.url));
try {
  await applyMigrations(database, migrationsDirectory);
} catch (error) {
  await database.close().catch(() => {});
  throw error;
}
const identity = await authRuntime(database);
const bootstrap = {active:true};
const configuredApplication = authContext.run({ system: true }, () => createConfiguredApplication({
  store: authorizedStore(new PostgresTraceabilityStore(database), identity.service, database, {bootstrap}),
  identityService: identity.service,
  env: process.env,
}));
await configuredApplication.ready;
bootstrap.active = false;
const { application, corsAllowedOrigins } = configuredApplication;
let sourceRuntime = null;
try {
  if (sourceConfiguration) sourceRuntime = await createSourceTruthRuntime({ configuration: sourceConfiguration,
    connectionString: requiredEnvironment("DATABASE_URL"), ssl: postgresSsl(process.env.POSTGRES_SSL), host, identityService: identity.service });
} catch (error) {
  await database.close();
  throw new Error(`${error.code ?? "SOURCE_CONFIGURATION_INVALID"}: 来源快照部署条件未通过校验；未开放服务`);
}
let deterministicFactsRuntime;
await initializeFacts();
const server = createTraceabilityHttpServer({ application, corsAllowedOrigins, auth: identity.http, sourceTruthHandler: sourceRuntime?.sourceTruthHandler,
  sourceTruthAllowedOrigins: sourceConfiguration?.origins,
  deterministicFactsHandler: deterministicFactsRuntime?.deterministicFactsHandler,
  deterministicFactsAllowedOrigins: sourceConfiguration?.origins });

async function initializeFacts() {
  if (!sourceRuntime) return null;
  try {
    const key = await privateFile(process.env.TRAQEN_AUTH_KEY_FILE, { maximum: 32 });
    const cursorSecret = createHmac("sha256", key).update("Traqen.F002.Cursor.v1").digest("hex");
    deterministicFactsRuntime = await createF002Runtime({ sourceRuntime, cursorSecret });
    return deterministicFactsRuntime;
  } catch (error) {
    await sourceRuntime.close().catch(() => {});
    await database.close().catch(() => {});
    throw new Error(`${error.code ?? "F002_CONFIGURATION_INVALID"}: 技术证据服务配置未通过校验；未开放服务`);
  }
}

server.listen(port, host, () => {
  sourceRuntime?.start();
  void deterministicFactsRuntime?.start();
  const address = server.address();
  process.stdout.write(`Traqen API listening on http://${host}:${address.port}\n`);
});

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  const closed = new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  server.closeAllConnections();
  await deterministicFactsRuntime?.close();
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
