import test from "node:test";
import assert from "node:assert/strict";
import { WorkJournal, journalSnapshot } from "../app/business-knowledge/work-journal.ts";
test("late durable acknowledgement updates only original operation coordinate, never authority or a newer operation", () => {
  const map = new Map(),
    store = {
      getItem: (k) => map.get(k) ?? null,
      setItem: (k, v) => map.set(k, v),
      removeItem: (k) => map.delete(k),
    };
  const j = new WorkJournal(store, "w", "actor", "session-create:R");
  const op = j.begin();
  assert.throws(() => j.begin());
  j.accepted("foreign", "S");
  assert.equal(j.read().resultId, undefined);
  j.accepted(op, "S");
  assert.deepEqual(j.read(), { operationId: op, resultId: "S" });
  const reload = new WorkJournal(store, "w", "actor", "session-create:R");
  assert.equal(reload.read().resultId, "S");
  j.resolve(op);
  const newer = j.begin();
  j.accepted(op, "old");
  assert.equal(j.read().operationId, newer);
  assert.equal(j.read().resultId, undefined);
  assert.equal(new WorkJournal(store, "w", "other", "session-create:R").read(), null);
  assert.ok(!JSON.stringify([...map]).includes("authority"));
  const exact = new WorkJournal(store, "w", "actor", "human-case");
  assert.equal(exact.begin("case-fixed"), "case-fixed");
  assert.equal(new WorkJournal(store, "w", "actor", "human-case").read().operationId, "case-fixed");
  assert.throws(() => exact.begin("new-case"));
  exact.resolve("case-fixed");
  assert.throws(() => exact.begin("bad/id"));
  assert.equal(exact.read(), null);
});
test("storage loss after mount keeps reads available and disables unjournalled writes without a render exception", () => {
  let locked = false;
  const journal = new WorkJournal(
    {
      getItem: () => {
        if (locked) throw Error("storage disabled");
        return null;
      },
      setItem: () => {},
      removeItem: () => {},
    },
    "w",
    "actor",
    "ask:S",
  );
  assert.equal(journalSnapshot({ journal, error: null }).journal, journal);
  locked = true;
  const value = journalSnapshot({ journal, error: null });
  assert.equal(value.pending, null);
  assert.equal(value.journal, null);
  assert.match(value.error.message, /storage disabled/);
});
