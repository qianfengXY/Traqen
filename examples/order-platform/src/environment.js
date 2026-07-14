import { readFile } from "node:fs/promises";

import { PGlite } from "@electric-sql/pglite";

export async function createOrderPlatformEnvironment({ schemaUrl, config = {} } = {}) {
  const database = new PGlite();
  const schema = await readFile(schemaUrl ?? new URL("../db/schema.sql", import.meta.url), "utf8");
  await database.exec(schema);
  const reservations = new Map();
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
  return {
    database,
    inventory,
    config: {
      submitEnabled: config.submitEnabled ?? true,
      allowedRoles: config.allowedRoles ?? ["customer", "admin"],
    },
    async close() {
      await database.close();
    },
  };
}
