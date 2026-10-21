import assert from "node:assert/strict";
import test from "node:test";
import * as model from "../app/deterministic-facts/model.ts";

const id = char => char.repeat(64);
const material = { kind: "MATERIAL", id: id("a"), payload: { componentId: id("b"), displayPath: "src/same.js", kind: "JAVASCRIPT" } };
const otherMaterial = { ...material, id: id("c"), payload: { ...material.payload, componentId: id("d") } };
const parent = { kind: "OBJECT", id: id("e"), payload: { materialId: material.id, kind: "FUNCTION", name: "outer", anchor: { kind: "TEXT", lineStart: 2 } } };
const child = { kind: "OBJECT", id: id("f"), payload: { materialId: material.id, parentId: parent.id, kind: "FUNCTION", name: "cancel", anchor: { kind: "TEXT", lineStart: 4 } } };
const otherObject = { ...parent, id: id("1"), payload: { ...parent.payload, materialId: otherMaterial.id } };
const filters = { query: "", materialType: "", processingStatus: "" };
const project = (...args) => {
  assert.equal(typeof model.projectEvidenceDirectory, "function", "the directory must project admitted material and explicit parent identities, not guessed names");
  return model.projectEvidenceDirectory(...args);
};

test("F002 directory preserves no-Fact materials and same paths in separate component identities", () => {
  const groups = project([material, otherMaterial], [parent, child, otherObject], filters, null);
  assert.deepEqual(groups.map(group => group.material), [material, otherMaterial]);
  assert.equal(groups[0].objects[0].record, parent);
  assert.equal(groups[0].objects[0].children[0].record, child);
  assert.equal(groups[1].objects[0].record, otherObject);
  assert.deepEqual(project([material], [], filters, null)[0].objects, [], "no Fact or object is required to discover a material");
  assert.equal(parent.payload.parentId, undefined, "projection cannot modify sealed records to manufacture a parent");
});

test("F002 directory symbol matches retain their real material and explicit ancestor path", () => {
  const groups = project([material, otherMaterial], [parent, child, otherObject], { ...filters, query: "cancel" }, null);
  assert.equal(groups.length, 1, "the material path need not itself contain the matching symbol name");
  assert.equal(groups[0].material, material);
  assert.equal(groups[0].objects[0].record, parent);
  assert.deepEqual(groups[0].objects[0].children[0].fields, ["name"]);
  assert.equal(project([material], [child], { ...filters, query: "secret" }, null).length, 0);
  const secret = { ...child, payload: { ...child.payload, value: "DO_NOT_SEARCH_SECRET" } };
  assert.equal(project([material], [secret], { ...filters, query: "DO_NOT_SEARCH_SECRET" }, null).length, 0);
});

test("F002 directory applies actual material capability filters to symbol matches", () => {
  const coverage = { items: [{ materialId: material.id, capabilityId: "javascript", status: "UNSUPPORTED" }] };
  const input = { ...filters, query: "cancel", materialType: "JAVASCRIPT", processingStatus: "UNSUPPORTED" };
  assert.equal(project([material], [parent, child], input, coverage).length, 1);
  assert.equal(project([material], [parent, child], input, null).length, 0, "missing coverage cannot silently clear a disposition filter");
  assert.equal(project([material], [parent, child], { ...input, materialType: "JAVA" }, coverage).length, 0);
});

test("F002 directory refuses cross-material cyclic and unavailable parents without hiding the object", () => {
  const cross = { ...child, payload: { ...child.payload, parentId: otherObject.id } };
  const missing = { ...parent, payload: { ...parent.payload, parentId: id("2") } };
  const groups = project([material, otherMaterial], [cross, missing, otherObject], filters, null);
  assert.deepEqual(groups[0].objects.map(node => node.reason).sort(), ["PARENT_NOT_LOADED", "PARENT_OUTSIDE_MATERIAL"].sort());
  const cycleParent = { ...parent, payload: { ...parent.payload, parentId: child.id } };
  const cycle = project([material], [cycleParent, child], filters, null)[0];
  assert.equal(cycle.objects.length, 2);
  assert.ok(cycle.objects.every(node => node.reason === "PARENT_CYCLE" && node.children.length === 0));
  assert.equal(project([otherMaterial], [parent], filters, null)[0].objects.length, 0, "a missing material cannot be replaced by a same-path material");
});

function storage() {
  const values = new Map();
  return { values, getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
}
const identity = { workspaceId: "workspace", actorId: "reader", graphVersionId: id("3"), authorized: true };
const metadata = { query: "", directoryScrollTop: 0, readingLine: 1, expandedDirectory: [`MATERIAL:${material.id}`, `OBJECT:${parent.id}`] };

test("F002 directory expansion survives only current member and exact version authorization", () => {
  const saved = storage();
  model.rememberEvidenceView(saved, identity, { ...metadata, recordPayload: "DO_NOT_PERSIST", apiToken: "DO_NOT_PERSIST" });
  assert.deepEqual(model.restoreEvidenceView(saved, identity).expandedDirectory, metadata.expandedDirectory);
  assert.deepEqual(model.restoreEvidenceView(saved, { ...identity, actorId: "other" }).expandedDirectory, []);
  assert.deepEqual(model.restoreEvidenceView(saved, { ...identity, graphVersionId: id("4") }).expandedDirectory, []);
  const forbidden = { getItem: () => { throw new Error("unauthorized read"); } };
  assert.deepEqual(model.restoreEvidenceView(forbidden, { ...identity, authorized: false }).expandedDirectory, []);
  assert.equal([...saved.values.values()].some(value => value.includes("DO_NOT_PERSIST")), false);
});

test("F002 directory expansion rejects corrupt identities duplicate keys and unbounded collections", () => {
  const saved = storage();
  for (const expandedDirectory of [["https://attacker.test"], [`FACT:${id("5")}`], [metadata.expandedDirectory[0], metadata.expandedDirectory[0]], "invalid", Array.from({ length: 65 }, (_, n) => `OBJECT:${n.toString(16).padStart(64, "0")}`)]) {
    assert.throws(() => model.rememberEvidenceView(saved, identity, { ...metadata, expandedDirectory }), /目录|展开|元数据|边界/);
  }
});
