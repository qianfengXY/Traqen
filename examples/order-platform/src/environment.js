import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import { PGlite } from "@electric-sql/pglite";

export async function createOrderPlatformEnvironment({ schemaUrl, config = {} } = {}) {
  const database = new PGlite();
  const schema = await readFile(schemaUrl ?? new URL("../db/schema.sql", import.meta.url), "utf8");
  await database.exec(schema);
  const reservations = new Map();
  const logs = [];
  const traces = [];
  let sequence = 0;
  const inventory = {
    async reserve(orderId) {
      sequence += 1;
      const reservation = { id: `RESERVATION-${sequence}`, orderId };
      reservations.set(reservation.id, reservation);
      return reservation;
    },
    async release(reservationId) {
      reservations.delete(reservationId);
    },
    activeReservations() {
      return [...reservations.values()];
    },
  };
  const telemetry = {
    recordLog(record) {
      logs.push(structuredClone(record));
    },
    recordTrace(record) {
      traces.push(structuredClone(record));
    },
    snapshot(traceId) {
      return {
        logs: logs.filter((item) => !traceId || item.traceId === traceId).map((item) => structuredClone(item)),
        traces: traces.filter((item) => !traceId || item.traceId === traceId).map((item) => structuredClone(item)),
      };
    },
    clear() {
      logs.length = 0;
      traces.length = 0;
    },
  };
  const resolvedConfig = {
    submitEnabled: config.submitEnabled ?? true,
    allowedRoles: config.allowedRoles ?? ["customer", "admin"],
  };
  const runtimeDigest = `sha256:${createHash("sha256").update(JSON.stringify({
    database: "pglite-postgresql-compatible",
    schema: `sha256:${createHash("sha256").update(schema).digest("hex")}`,
    config: resolvedConfig,
    inventory: "in-memory-reference-v1",
  })).digest("hex")}`;
  return {
    database,
    inventory,
    telemetry,
    config: resolvedConfig,
    runtime: Object.freeze({ id: `ORDER-RUNTIME-${runtimeDigest.slice(-16)}`, digest: runtimeDigest }),
    async close() {
      await database.close();
    },
  };
}
