import { fetchOrder as loadPersistedOrder } from "./order-service.js";

function getOrder(req, res) {
  return res.json(loadPersistedOrder(req.params.id));
}

export { getOrder as handleGetOrder };
