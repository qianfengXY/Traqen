import { OrderService } from "./order-service.js";
import { createRouter } from "./router.js";
import { describeOrderPlatformArtifact } from "./artifact.js";

export { describeOrderPlatformArtifact } from "./artifact.js";

export async function startOrderPlatform({ database, inventory, telemetry, config, clock }) {
  const artifact = await describeOrderPlatformArtifact();
  const service = new OrderService({ database, inventory, config, clock });
  const app = createRouter();

  app.post("/orders/{id}/submit", async ({ request, params, body }) => {
    const handlerRevision = "ORDER_SUBMISSION_V1";
    const traceId = request.headers["x-trace-id"] ?? `TRACE-${params.id}`;
    telemetry?.recordLog({ traceId, level: "INFO", event: "ORDER_SUBMIT_RECEIVED", orderId: params.id });
    try {
      const result = await service.submitOrder({
        orderId: params.id,
        actorId: request.headers["x-actor-id"] ?? body.actorId,
        actorRole: request.headers["x-actor-role"] ?? body.actorRole,
        idempotencyKey: request.headers["idempotency-key"] ?? body.idempotencyKey,
      });
      telemetry?.recordTrace({
        traceId,
        service: "order-platform",
        operation: "submitOrder",
        status: "OK",
        orderId: params.id,
        handlerRevision,
      });
      telemetry?.recordLog({ traceId, level: "INFO", event: "ORDER_SUBMIT_COMPLETED", orderId: params.id });
      return { status: 200, body: { ...result, handlerRevision, traceId } };
    } catch (error) {
      telemetry?.recordTrace({
        traceId,
        service: "order-platform",
        operation: "submitOrder",
        status: "ERROR",
        orderId: params.id,
        errorCode: error.code ?? "INTERNAL_ERROR",
        handlerRevision,
      });
      telemetry?.recordLog({
        traceId,
        level: "ERROR",
        event: "ORDER_SUBMIT_FAILED",
        orderId: params.id,
        errorCode: error.code ?? "INTERNAL_ERROR",
      });
      throw error;
    }
  });

  const server = await app.listen(0);
  const address = server.address();
  return {
    server,
    artifact,
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}
