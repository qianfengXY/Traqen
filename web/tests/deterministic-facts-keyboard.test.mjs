import assert from "node:assert/strict";
import test from "node:test";
import { isEvidenceShortcut } from "../app/deterministic-facts/keyboard.ts";

const key = { key: "Enter", keyCode: 13, isComposing: false, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false };

test("F002 shortcut rejects the observed false-composing IME completion as well as active composition", () => {
  for (const name of ["Enter", " ", "Escape"]) {
    for (const shiftKey of [false, true]) {
      assert.equal(isEvidenceShortcut({ ...key, key: name, keyCode: 229, shiftKey }, [name], shiftKey), false);
      assert.equal(isEvidenceShortcut({ ...key, key: name, isComposing: true, shiftKey }, [name], shiftKey), false);
    }
  }
});

test("F002 read commands never consume editing or platform modifier chords", () => {
  assert.equal(isEvidenceShortcut(key, ["Enter"]), true);
  for (const modifier of ["ctrlKey", "metaKey", "altKey", "shiftKey"]) {
    assert.equal(isEvidenceShortcut({ ...key, [modifier]: true }, ["Enter"]), false);
  }
  assert.equal(isEvidenceShortcut({ ...key, key: "a" }, ["Enter"]), false);
});

test("F002 retains only the declared Shift range chord and plain graph and Escape actions", () => {
  for (const name of ["Enter", " "]) {
    assert.equal(isEvidenceShortcut({ ...key, key: name, shiftKey: true }, ["Enter", " "], true), true);
    assert.equal(isEvidenceShortcut({ ...key, key: name }, ["Enter", " "], true), false);
    assert.equal(isEvidenceShortcut({ ...key, key: name }, ["Enter", " "]), true);
    for (const modifier of ["ctrlKey", "metaKey", "altKey"]) {
      assert.equal(isEvidenceShortcut({ ...key, key: name, shiftKey: true, [modifier]: true }, ["Enter", " "], true), false);
    }
  }
  assert.equal(isEvidenceShortcut({ ...key, key: "Escape", keyCode: 27 }, ["Escape"]), true);
});
