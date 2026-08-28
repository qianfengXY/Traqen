import assert from "node:assert/strict";
import test from "node:test";

import {
  addChildSlot,
  createDefaultChildSlots,
  removeChildSlot,
} from "../app/capability-roster.ts";

test("new Workspace roster starts with one unconfigured Child slot", () => {
  const slots = createDefaultChildSlots();

  assert.deepEqual(slots.map(({ id }) => id), ["CHILD-1"]);
  assert.equal(slots[0].model, "");
  assert.deepEqual(slots[0].skillNames, []);
  assert.deepEqual(slots[0].mcpNames, []);
});

test("roster supports add/remove while enforcing a minimum of one", () => {
  const defaults = createDefaultChildSlots();
  const expanded = addChildSlot(defaults, { model: "model-b", skillNames: [], mcpNames: [] });
  assert.deepEqual(expanded.map(({ id }) => id), ["CHILD-1", "CHILD-2"]);

  const one = removeChildSlot(expanded, "CHILD-1");
  assert.deepEqual(one.map(({ id }) => id), ["CHILD-2"]);
  assert.deepEqual(removeChildSlot(one, "CHILD-2"), one);

  const reexpanded = addChildSlot(one, { model: "model-b", skillNames: [], mcpNames: [] });
  assert.deepEqual(reexpanded.map(({ id }) => id), ["CHILD-2", "CHILD-1"]);
});

test("persisted server roster stays authoritative and is not replaced by defaults", () => {
  const persisted = [{
    id: "REVIEWER-A",
    model: "persisted-model",
    skillNames: ["review"],
    mcpNames: [],
    independenceGroup: "INDEPENDENT-A",
  }];

  const reloaded = persisted.map((slot) => ({
    ...slot,
    skillNames: [...slot.skillNames],
    mcpNames: [...slot.mcpNames],
  }));
  assert.deepEqual(reloaded, persisted);
  assert.notDeepEqual(reloaded, createDefaultChildSlots());
});
