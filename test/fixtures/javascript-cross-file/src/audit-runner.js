import { auditOrder } from "./internal-audit.js";

export function runAudit(order) {
  return auditOrder(order);
}
