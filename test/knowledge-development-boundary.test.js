import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { openDevelopmentIdentity } from "../src/auth/development.js";

test("default local identity ignores deployment database and key unless persistent sources are explicitly selected", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "traqen-local-identity-boundary-"));
  const runtime = await openDevelopmentIdentity({ TRAQEN_AUTH_DEVELOPMENT: "true", TRAQEN_AUTH_DEVELOPMENT_DATA: root,
    TRAQEN_PUBLIC_ORIGIN: "http://127.0.0.1:6246", DATABASE_URL: "postgresql://must-not-contact.invalid/deployment",
    TRAQEN_AUTH_KEY_FILE: path.join(root, "must-not-open-deployment.key") });
  try { assert.equal(runtime.keyFile, path.join(root, "authentication.key")); }
  finally { await runtime.database.close(); }
});

test("native development requires an explicit local source database, with actual PG parameter parsing", async () => {
  for (const databaseUrl of [null, "postgresql://user@remote.invalid/db", "postgresql://user@localhost/db?host=/tmp/owned&host=remote.invalid"]) {
    const root = await mkdtemp(path.join(tmpdir(), "traqen-native-config-refusal-"));
    await assert.rejects(openDevelopmentIdentity({ TRAQEN_AUTH_DEVELOPMENT: "true", TRAQEN_AUTH_DEVELOPMENT_DATA: root,
      SOURCE_TRUTH_CONFIG: path.join(root, "explicit-source-config.json"), DATABASE_URL: databaseUrl }), { code: "AUTH_CONFIGURATION_INVALID" });
  }
});
