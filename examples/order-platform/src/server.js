import { OrderService } from "./order-service.js";
import { createRouter } from "./router.js";

export async function startOrderPlatform({ database, inventory, config, clock }) {
  const service = new OrderService({ database, inventory, config, clock });
  const app = createRouter();

  app.post("/orders/{id}/submit", async ({ request, params, body }) => {
    const handlerRevision = "ORDER_SUBMISSION_V1";
    const result = await service.submitOrder({
      orderId: params.id,
      actorId: request.headers["x-actor-id"] ?? body.actorId,
      actorRole: request.headers["x-actor-role"] ?? body.actorRole,
      idempotencyKey: request.headers["idempotency-key"] ?? body.idempotencyKey,
    });
    return { status: 200, body: { ...result, handlerRevision } };
  });

  const server = await app.listen(0);
  const address = server.address();
  return {
    server,
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}
