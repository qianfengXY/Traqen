function businessError(code, message, statusCode) {
  return Object.assign(new Error(message), { code, statusCode });
}

export class OrderService {
  #database;
  #inventory;
  #config;
  #clock;
  #orderLocks = new Map();

  constructor({ database, inventory, config, clock = () => new Date() }) {
    this.#database = database;
    this.#inventory = inventory;
    this.#config = Object.freeze({ ...config });
    this.#clock = clock;
  }

  async submitOrder({ orderId, actorId, actorRole, idempotencyKey }) {
    const previous = this.#orderLocks.get(orderId) ?? Promise.resolve();
    let release;
    const current = new Promise((resolve) => { release = resolve; });
    this.#orderLocks.set(orderId, current);
    await previous.catch(() => {});
    try {
      return await this.#submitLocked({ orderId, actorId, actorRole, idempotencyKey });
    } finally {
      release();
      if (this.#orderLocks.get(orderId) === current) this.#orderLocks.delete(orderId);
    }
  }

  async #submitLocked({ orderId, actorId, actorRole, idempotencyKey }) {
    if (!this.#config.submitEnabled) throw businessError("FEATURE_DISABLED", "order submission is disabled", 503);
    if (!this.#config.allowedRoles.includes(actorRole)) throw businessError("FORBIDDEN", "actor cannot submit orders", 403);
    if (!idempotencyKey) throw businessError("IDEMPOTENCY_REQUIRED", "idempotency key is required", 400);

    const replay = await this.#database.query(
      "SELECT response_payload FROM order_submission_idempotency WHERE order_id = $1 AND idempotency_key = $2",
      [orderId, idempotencyKey],
    );
    if (replay.rows[0]) return { ...replay.rows[0].response_payload, replayed: true };

    let reservation = null;
    await this.#database.exec("BEGIN");
    try {
      const selected = await this.#database.query("SELECT id, status FROM orders WHERE id = $1 FOR UPDATE", [orderId]);
      if (!selected.rows[0]) throw businessError("ORDER_NOT_FOUND", "order does not exist", 404);
      if (selected.rows[0].status !== "DRAFT") {
        throw businessError("INVALID_STATE", "only draft orders can be submitted", 409);
      }
      reservation = await this.#inventory.reserve(orderId);
      const submittedAt = this.#clock().toISOString();
      await this.#database.query(
        "UPDATE orders SET status = 'SUBMITTED', submitted_by = $2, submitted_at = $3 WHERE id = $1 AND status = 'DRAFT'",
        [orderId, actorId, submittedAt],
      );
      const payload = { orderId, status: "SUBMITTED", reservationId: reservation.id, submittedAt, replayed: false };
      await this.#database.query(
        "INSERT INTO order_submission_idempotency (order_id, idempotency_key, response_payload) VALUES ($1, $2, $3)",
        [orderId, idempotencyKey, payload],
      );
      await this.#database.exec("COMMIT");
      return payload;
    } catch (error) {
      await this.#database.exec("ROLLBACK");
      if (reservation) await this.#inventory.release(reservation.id);
      throw error;
    }
  }
}
