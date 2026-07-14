import assert from "node:assert/strict";
import test from "node:test";

import { createOrderPlatformEnvironment } from "../src/environment.js";
import { OrderService } from "../src/order-service.js";
import { startOrderPlatform } from "../src/server.js";

async function request(baseUrl, orderId, overrides = {}) {
  return fetch(`${baseUrl}/orders/${orderId}/submit`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-actor-id": "USER-001", "x-actor-role": "customer", "idempotency-key": "KEY-001", ...(overrides.headers ?? {}) },
    body: JSON.stringify(overrides.body ?? {}),
  });
}

test("reference order platform enforces state, role, idempotency, database write, and inventory lifecycle", async (t) => {
  const environment = await createOrderPlatformEnvironment();
  const platform = await startOrderPlatform(environment);
  t.after(async () => { await platform.close(); await environment.close(); });
  await environment.database.query("INSERT INTO orders (id, status) VALUES ($1, 'DRAFT')", ["ORDER-001"]);
  await environment.database.query("INSERT INTO orders (id, status) VALUES ($1, 'DRAFT')", ["ORDER-002"]);

  const forbidden = await request(platform.baseUrl, "ORDER-002", { headers: { "x-actor-role": "viewer" } });
  assert.equal(forbidden.status, 403);

  const submitted = await request(platform.baseUrl, "ORDER-001");
  assert.equal(submitted.status, 200);
  assert.equal((await submitted.json()).status, "SUBMITTED");
  assert.equal((await environment.database.query("SELECT status FROM orders WHERE id = $1", ["ORDER-001"])).rows[0].status, "SUBMITTED");
  assert.equal(environment.inventory.activeReservations().length, 1);

  const replay = await request(platform.baseUrl, "ORDER-001");
  assert.equal(replay.status, 200);
  assert.equal((await replay.json()).replayed, true);
  assert.equal(environment.inventory.activeReservations().length, 1);

  const invalidState = await request(platform.baseUrl, "ORDER-001", { headers: { "idempotency-key": "KEY-002" } });
  assert.equal(invalidState.status, 409);
});

test("reference order service rolls back the database and inventory reservation on a write failure", async (t) => {
  const environment = await createOrderPlatformEnvironment();
  t.after(() => environment.close());
  await environment.database.query("INSERT INTO orders (id, status) VALUES ($1, 'DRAFT')", ["ORDER-ROLLBACK"]);
  const database = {
    exec: (sql) => environment.database.exec(sql),
    query(sql, parameters) {
      if (/^UPDATE orders/i.test(sql)) throw new Error("simulated database write failure");
      return environment.database.query(sql, parameters);
    },
  };
  const service = new OrderService({
    database,
    inventory: environment.inventory,
    config: environment.config,
  });

  await assert.rejects(
    service.submitOrder({
      orderId: "ORDER-ROLLBACK",
      actorId: "USER-001",
      actorRole: "customer",
      idempotencyKey: "ROLLBACK-KEY",
    }),
    /simulated database write failure/,
  );
  assert.equal(
    (await environment.database.query("SELECT status FROM orders WHERE id = $1", ["ORDER-ROLLBACK"])).rows[0].status,
    "DRAFT",
  );
  assert.deepEqual(environment.inventory.activeReservations(), []);
});

test("reference order platform fails closed when the submission feature flag is disabled", async (t) => {
  const environment = await createOrderPlatformEnvironment({ config: { submitEnabled: false } });
  const platform = await startOrderPlatform(environment);
  t.after(async () => { await platform.close(); await environment.close(); });
  await environment.database.query("INSERT INTO orders (id, status) VALUES ($1, 'DRAFT')", ["ORDER-DISABLED"]);

  const response = await request(platform.baseUrl, "ORDER-DISABLED");
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error, "FEATURE_DISABLED");
  assert.equal(
    (await environment.database.query("SELECT status FROM orders WHERE id = $1", ["ORDER-DISABLED"])).rows[0].status,
    "DRAFT",
  );
});

test("reference order platform serializes concurrent submissions for the same draft order", async (t) => {
  const environment = await createOrderPlatformEnvironment();
  const platform = await startOrderPlatform(environment);
  t.after(async () => { await platform.close(); await environment.close(); });
  await environment.database.query("INSERT INTO orders (id, status) VALUES ($1, 'DRAFT')", ["ORDER-CONCURRENT"]);

  const [first, second] = await Promise.all([
    request(platform.baseUrl, "ORDER-CONCURRENT", { headers: { "idempotency-key": "CONCURRENT-1" } }),
    request(platform.baseUrl, "ORDER-CONCURRENT", { headers: { "idempotency-key": "CONCURRENT-2" } }),
  ]);
  assert.deepEqual([first.status, second.status].sort(), [200, 409]);
  assert.equal(
    (await environment.database.query("SELECT status FROM orders WHERE id = $1", ["ORDER-CONCURRENT"])).rows[0].status,
    "SUBMITTED",
  );
  assert.equal(environment.inventory.activeReservations().length, 1);
});
