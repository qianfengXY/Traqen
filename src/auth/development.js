import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { randomBytes, createHmac } from "node:crypto";
import pg from "pg";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { applyMigrations, PostgresTraceabilityStore } from "../storage/index.js";
import { contextualDatabase } from "./database.js";
import { authRuntime, privateFile } from "./runtime.js";
import { authorizedStore } from "./authorized-store.js";
import { authContext } from "./context.js";
import { createIsolatedDevelopmentApplication } from "../api/development-bootstrap.js";
import { demand } from "./errors.js";
import { readSourceTruthConfiguration, createSourceTruthRuntime } from "../source-truth/configuration.js";
import { createF002Runtime } from "../deterministic-facts/runtime.js";
export async function openDevelopmentIdentity(env = process.env) {
  demand(env.TRAQEN_AUTH_DEVELOPMENT === "true", "AUTH_CONFIGURATION_INVALID", "必须显式启用隔离开发模式", 503);
  const root = path.resolve(env.TRAQEN_AUTH_DEVELOPMENT_DATA ?? ".traqen-dev/identity");
  await mkdir(root, { recursive: true, mode: 0o700 });
  const externalKey = env.SOURCE_TRUTH_CONFIG ? env.TRAQEN_AUTH_KEY_FILE : null;
  const keyFile = externalKey ?? path.join(root, "authentication.key");
  // An explicit deployment key is only read; local development never creates it.
  if (!externalKey) {
    try {
      await writeFile(keyFile, randomBytes(32), { mode: 0o600, flag: "wx" });
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
  }
  let raw;
  if (env.SOURCE_TRUTH_CONFIG) {
    demand(typeof env.DATABASE_URL === "string" && /^postgres(?:ql)?:\/\//.test(env.DATABASE_URL),
      "AUTH_CONFIGURATION_INVALID", "持久材料开发入口须显式配置同一个隔离 PostgreSQL 数据库", 503);
    let host;
    try { host = new pg.Client({ connectionString: env.DATABASE_URL, ssl: false }).connectionParameters.host; }
    catch { demand(false, "AUTH_CONFIGURATION_INVALID", "开发材料数据库地址无效", 503); }
    // Check the parameters pg actually uses, including duplicate host queries.
    demand(typeof host === "string" && (host.startsWith("/") || ["localhost", "127.0.0.1", "::1", "[::1]"].includes(host)),
      "AUTH_CONFIGURATION_INVALID", "开发材料服务仅允许明确的本机隔离数据库", 503);
    raw = new pg.Pool({ connectionString: env.DATABASE_URL, ssl: false, connectionTimeoutMillis: 10000 });
    raw.on("error", () => {});
  } else raw = await PGlite.create(path.join(root, "database"));
  const database = contextualDatabase(raw);
  try {
    await applyMigrations(database, fileURLToPath(new URL("../../db/migrations/", import.meta.url)));
    const identity = await authRuntime(database, {
      ...env,
      TRAQEN_AUTH_KEY_FILE: keyFile,
      TRAQEN_PUBLIC_ORIGIN: env.TRAQEN_PUBLIC_ORIGIN ?? "http://127.0.0.1:3000",
    });
    return { database, identity, root, keyFile };
  } catch (error) {
    await database.close();
    throw error;
  }
}
export async function authenticatedDevelopmentApplication(env = process.env) {
  const sourceConfiguration = env.SOURCE_TRUTH_CONFIG
    ? await readSourceTruthConfiguration(env.SOURCE_TRUTH_CONFIG, { unifiedAuthentication: true }) : null;
  const runtime = await openDevelopmentIdentity(env),
    bootstrap = { active: true };
  // Development never opens the deployment's default encrypted model profile store.
  const developmentEnv = {
    ...env,
    ANALYSIS_MODEL_STORE_PATH: path.join(runtime.root, "models.json"),
    ANALYSIS_MODEL_PROFILES_JSON: "[]",
  };
  let configured, sourceRuntime, deterministicFactsRuntime;
  try {
    configured = await authContext.run({ system: true }, () =>
      createIsolatedDevelopmentApplication({
        sourceRoot: env.TRAQEN_DEVELOPMENT_SOURCE_ROOT ?? fileURLToPath(new URL("../../", import.meta.url)),
        snapshotRoot: path.join(runtime.root, "snapshots"),
        store: authorizedStore(
          new PostgresTraceabilityStore(runtime.database),
          runtime.identity.service,
          runtime.database,
          { bootstrap },
        ),
        identityService: runtime.identity.service,
        env: developmentEnv,
      }),
    );
    bootstrap.active = false;
    if (sourceConfiguration) {
      sourceRuntime = await createSourceTruthRuntime({ configuration: sourceConfiguration, connectionString: env.DATABASE_URL,
        ssl: false, host: "127.0.0.1", identityService: runtime.identity.service });
      const key = await privateFile(runtime.keyFile, { maximum: 32 });
      const cursorSecret = createHmac("sha256", key).update("Traqen.F002.Cursor.v1").digest("hex");
      deterministicFactsRuntime = await createF002Runtime({ sourceRuntime, cursorSecret });
    }
  } catch (error) {
    try { await deterministicFactsRuntime?.close(); }
    finally { try { await sourceRuntime?.close(); } finally { await runtime.database.close(); } }
    throw error;
  }
  bootstrap.active = false;
  let closing;
  return { ...configured, ...runtime, sourceRuntime, deterministicFactsRuntime,
    async start() { sourceRuntime?.start(); await deterministicFactsRuntime?.start(); },
    close() { return closing ??= (async () => {
      try { await deterministicFactsRuntime?.close(); }
      finally { try { await sourceRuntime?.close(); } finally { await runtime.database.close(); } }
    })(); },
  };
}
