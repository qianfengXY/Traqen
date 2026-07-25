import { fetchOrder as helper } from "./order-service.js";

export function outer() {
  function helper() {
    return { local: true };
  }
  return helper();
}

export function run() {
  return helper("ORDER-001");
}
