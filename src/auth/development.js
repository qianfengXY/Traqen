import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { applyMigrations, PostgresTraceabilityStore } from "../storage/index.js";
import { contextualDatabase } from "./database.js";
import { authRuntime } from "./runtime.js";
import { authorizedStore } from "./authorized-store.js";
import { authContext } from "./context.js";
import { createIsolatedDevelopmentApplication } from "../api/development-bootstrap.js";
import { demand } from "./errors.js";
export async function openDevelopmentIdentity(env = process.env) {
  demand(env.TRAQEN_AUTH_DEVELOPMENT === "true", "AUTH_CONFIGURATION_INVALID", "必须显式启用隔离开发模式", 503);
  const root = path.resolve(env.TRAQEN_AUTH_DEVELOPMENT_DATA ?? ".traqen-dev/identity");
  await mkdir(root, { recursive: true, mode: 0o700 });
  const keyFile = path.join(root, "authentication.key");
  try {
    await writeFile(keyFile, randomBytes(32), { mode: 0o600, flag: "wx" });
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
  }
  const raw = await PGlite.create(path.join(root, "database")),
    database = contextualDatabase(raw);
  try {
    await applyMigrations(database, fileURLToPath(new URL("../../db/migrations/", import.meta.url)));
    const identity = await authRuntime(database, {
      ...env,
      TRAQEN_AUTH_KEY_FILE: keyFile,
      TRAQEN_PUBLIC_ORIGIN: env.TRAQEN_PUBLIC_ORIGIN ?? "http://127.0.0.1:3000",
    });
    return { database, identity, root };
  } catch (error) {
    await raw.close();
    throw error;
  }
}
export async function authenticatedDevelopmentApplication(env = process.env) {
  const runtime = await openDevelopmentIdentity(env),
    bootstrap = { active: true };
  // Development never opens the deployment's default encrypted model profile store.
  const developmentEnv = {
    ...env,
    ANALYSIS_MODEL_STORE_PATH: path.join(runtime.root, "models.json"),
    ANALYSIS_MODEL_PROFILES_JSON: "[]",
  };
  let configured;
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
  } catch (error) {
    await runtime.database.close();
    throw error;
  }
  bootstrap.active = false;
  return { ...configured, ...runtime };
}
