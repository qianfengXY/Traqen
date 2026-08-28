import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { PGlite } from "@electric-sql/pglite";

import { createGlobalAccountRevision } from "../src/domain/index.js";
import { MemoryTraceabilityStore, PostgresTraceabilityStore } from "../src/storage/index.js";
import { applyMigrations } from "../src/storage/postgres/migrations.js";

const migrationsDirectory = fileURLToPath(new URL("../db/migrations", import.meta.url));
const clock = () => new Date("2026-08-28T16:00:00.000Z");

function account(revision = 1) {
  return createGlobalAccountRevision({
    accountId: "account-oauth", displayName: "Codex account", authMethod: "OAUTH", cliAdapter: "CODEX", oauthStatus: "NOT_AUTHENTICATED", revision,
  }, clock);
}

async function assertAccountPersistence(store) {
  const first = account();
  const stored = await store.appendGlobalAccountRevision(first);
  assert.deepEqual(stored, first);
  assert.deepEqual(await store.listGlobalAccountRevisions(), [first]);
  await assert.rejects(
    () => store.appendGlobalAccountRevision({ ...first, displayName: "Conflict" }),
    /conflict/i,
  );
  assert.doesNotMatch(JSON.stringify(stored), /accessToken|apiKey|secret/i);
}

test("F006 global account revisions are immutable in the memory store", async () => {
  await assertAccountPersistence(new MemoryTraceabilityStore());
});

test("F006 global account revisions survive the PostgreSQL migration boundary", async (t) => {
  const database = await PGlite.create();
  t.after(() => database.close());
  await applyMigrations(database, migrationsDirectory);
  await assertAccountPersistence(new PostgresTraceabilityStore(database));
});
