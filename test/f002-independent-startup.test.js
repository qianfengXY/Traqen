import assert from "node:assert/strict";
import { access, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { authenticatedDevelopmentApplication, openDevelopmentIdentity } from "../src/auth/development.js";

test("F002 development rejects an invalid explicit F001 configuration before opening identity data", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "tq-f002-startup-"));
  const identityRoot = path.join(root, "must-not-open");
  let runtime;
  try {
    await assert.rejects(async () => {
      runtime = await authenticatedDevelopmentApplication({ TRAQEN_AUTH_DEVELOPMENT: "true",
        TRAQEN_AUTH_DEVELOPMENT_DATA: identityRoot, SOURCE_TRUTH_CONFIG: path.join(root, "missing.json"),
        TRAQEN_PUBLIC_ORIGIN: "http://127.0.0.1:61827" });
    });
    await assert.rejects(access(identityRoot), { code: "ENOENT" });
  } finally { await (runtime?.close ? runtime.close() : runtime?.database.close()); }
});

test("F002 persistent development rejects missing or remote PG and never creates an explicit external authentication key", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "tq-f002-local-db-"));
  for (const databaseUrl of [undefined, "postgres://user@remote.invalid/db", "postgres://user@127.0.0.1/db?host=localhost&host=remote.invalid"]) {
    const keyFile = path.join(root, `external-${String(databaseUrl).length}.key`);
    let runtime;
    try {
      await assert.rejects(async () => {
        runtime = await openDevelopmentIdentity({ TRAQEN_AUTH_DEVELOPMENT: "true", SOURCE_TRUTH_CONFIG: "explicit",
          TRAQEN_AUTH_DEVELOPMENT_DATA: root, TRAQEN_AUTH_KEY_FILE: keyFile, DATABASE_URL: databaseUrl,
          TRAQEN_PUBLIC_ORIGIN: "http://127.0.0.1:61827" });
      }, { code: "AUTH_CONFIGURATION_INVALID" });
      await assert.rejects(access(keyFile), { code: "ENOENT" });
    } finally { await runtime?.database.close(); }
  }
});

test("F002 isolated development exposes an awaited start and idempotent owned close without requiring F003", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "tq-f002-lifecycle-"));
  const runtime = await authenticatedDevelopmentApplication({ TRAQEN_AUTH_DEVELOPMENT: "true",
    TRAQEN_AUTH_DEVELOPMENT_DATA: root, TRAQEN_PUBLIC_ORIGIN: "http://127.0.0.1:61827" });
  try {
    assert.equal(typeof runtime.start, "function");
    assert.equal(typeof runtime.close, "function");
    await runtime.start();
    const first = runtime.close();
    assert.equal(runtime.close(), first);
    await first;
  } finally { await (runtime.close ? runtime.close() : runtime.database.close()); }
});
