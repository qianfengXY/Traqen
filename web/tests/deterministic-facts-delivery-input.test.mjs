import assert from "node:assert/strict";
import test from "node:test";
import { extractionScopes } from "../app/deterministic-facts/delivery-input.ts";

const component = "a".repeat(64), second = "b".repeat(64);
test("ordinary extraction can select one frozen directory or file without changing its component or UTF-8 path", () => {
  for (const kind of ["DIRECTORY", "ENTRY"]) {
    const actual = extractionScopes([component], false, kind, "src/中文.ts");
    assert.deepEqual(actual, [{ selections: [{ kind, componentId: component, pathBytes: Buffer.from("src/中文.ts").toString("base64url") }] }]);
  }
  assert.deepEqual(extractionScopes([component, second], true), [component, second].map(componentId => ({ selections: [{ kind: "COMPONENT", componentId }] })));
  assert.deepEqual(extractionScopes([component, second], false), [{ selections: [component, second].map(componentId => ({ kind: "COMPONENT", componentId })) }]);
});
test("narrow selectors reject ambiguous components, absolute paths, traversal and missing scope rather than widening to the whole source", () => {
  for (const value of ["", "../other", "/Users/elsewhere", "src/../other", "C:\\source", "src//a", "src\u0000a"]) {
    assert.throws(() => extractionScopes([component], false, "DIRECTORY", value));
  }
  assert.throws(() => extractionScopes([component, second], false, "ENTRY", "a.js"));
  assert.throws(() => extractionScopes([], false));
});
