import { AsyncLocalStorage } from "node:async_hooks";
import { transaction } from "../source-truth/repository.js";
// A checked-out connection belongs to one transaction. Async descendants must not
// reuse it after commit; they start a fresh transaction at their next boundary.
export function contextualDatabase(database) {
  const local = new AsyncLocalStorage();
  const current = () => {
    const value = local.getStore();
    return value?.active ? value.tx : database;
  };
  return {
    query: (sql, args) => current().query(sql, args),
    exec: (sql) => (current().exec ? current().exec(sql) : current().query(sql)),
    async transaction(work) {
      const existing = local.getStore();
      if (existing?.active) return work(existing.tx);
      return transaction(database, async (tx) => {
        const state = { tx, active: true };
        try {
          return await local.run(state, () => work(tx));
        } finally {
          state.active = false;
        }
      });
    },
    close: () => database.close?.() ?? database.end?.(),
  };
}
