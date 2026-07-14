import assert from "node:assert/strict";
import test from "node:test";

import { connectPostgresDatabase } from "../src/storage/index.js";

test("production PostgreSQL adapter pins queries and transactions to one client", async () => {
  const events = [];
  class FakeClient {
    constructor(config) {
      events.push({ type: "construct", config });
    }

    async connect() {
      events.push({ type: "connect" });
    }

    async query(sql, parameters) {
      events.push({ type: "query", sql, parameters });
      return { rows: [{ ok: true }] };
    }

    async end() {
      events.push({ type: "end" });
    }
  }

  const database = await connectPostgresDatabase({
    connectionString: "postgresql://traqen@example.invalid/traqen",
    ssl: { rejectUnauthorized: true },
    ClientClass: FakeClient,
  });
  await database.exec("BEGIN");
  assert.deepEqual(await database.query("SELECT $1::int AS value", [1]), { rows: [{ ok: true }] });
  await database.exec("COMMIT");
  await database.close();
  await database.close();

  assert.deepEqual(events.map((event) => event.type), [
    "construct",
    "connect",
    "query",
    "query",
    "query",
    "end",
  ]);
  assert.equal(events[0].config.application_name, "traqen");
  assert.throws(() => database.query("SELECT 1"), /connection is closed/);
});
