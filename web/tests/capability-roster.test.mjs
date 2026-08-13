import assert from "node:assert/strict";
import test from "node:test";

import {
  addChildSlot,
  createDefaultChildSlots,
  removeChildSlot,
} from "../app/capability-roster.ts";

test("new Workspace roster defaults to exactly two independently configurable Child slots", () => {
  const slots = createDefaultChildSlots("model-a", ["skill-a"], ["mcp-a"]);

  assert.deepEqual(slots.map(({ id }) => id), ["CHILD-1", "CHILD-2"]);
  assert.ok(slots.every(({ model }) => model === "model-a"));
  assert.notEqual(slots[0].skillNames, slots[1].skillNames);
  assert.notEqual(slots[0].mcpNames, slots[1].mcpNames);
});

test("roster supports add/remove while enforcing a minimum of two", () => {
  const defaults = createDefaultChildSlots();
  const expanded = addChildSlot(defaults, { model: "model-b", skillNames: [], mcpNames: [] });
  assert.deepEqual(expanded.map(({ id }) => id), ["CHILD-1", "CHILD-2", "CHILD-3"]);

  const two = removeChildSlot(expanded, "CHILD-3");
  assert.deepEqual(two.map(({ id }) => id), ["CHILD-1", "CHILD-2"]);
  assert.deepEqual(removeChildSlot(two, "CHILD-1"), two);

  const reexpanded = addChildSlot(two, { model: "model-b", skillNames: [], mcpNames: [] });
  assert.deepEqual(reexpanded.map(({ id }) => id), ["CHILD-1", "CHILD-2", "CHILD-3"]);
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
