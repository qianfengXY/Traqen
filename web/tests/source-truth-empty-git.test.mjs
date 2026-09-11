import assert from "node:assert/strict";
import test from "node:test";
import { isConfirmedEmptyGitSource, isEmptyGitComponent } from "../app/source-truth/empty-git.ts";

const component = { id: "component", sourceId: "git", kind: "GIT", scope: { kind: "GIT_ROOT", root: null },
  nativeIdentity: { commit: "c".repeat(40), tree: "t".repeat(40) }, manifestId: "m".repeat(64),
  fileCount: "0", directoryCount: "0", knownBytes: "0", gapCount: "0" };
const source = { ...component, mode: "UPDATE", enumerationClosed: true,
  summary: { fileCount: "0", directoryCount: "0", knownBytes: "0", pendingCount: "0" } };
const detail = { run: { status: "REVIEW_REQUIRED" }, candidate: { components: [{ id: component.id, sourceId: "git", kind: "GIT" }] } };

test("confirmed empty Git is a closed, reconciled component of this candidate, including exact reuse", () => {
  for (const mode of ["UPDATE", "REUSE"]) assert.equal(isConfirmedEmptyGitSource({ ...source, mode }, detail), true);
  for (const status of ["PREPARING_SEAL", "FINALIZING", "SUCCEEDED"]) {
    assert.equal(isConfirmedEmptyGitSource(source, { ...detail, run: { status } }), true);
  }
  assert.equal(isConfirmedEmptyGitSource(source, { ...detail, candidate: { components: [
    ...detail.candidate.components, { id: "other", sourceId: "directory", kind: "DIRECTORY_UPLOAD" },
  ], fileCount: "9" } }), true, "one empty component does not label the combined bundle empty");
});

test("zero counts never confirm unresolved, failed, cancelled, or unbound Git sources", () => {
  for (const patch of [{ enumerationClosed: false }, { manifestId: null }, { nativeIdentity: null },
    { nativeIdentity: { tree: "tree" } }, { nativeIdentity: { commit: "commit" } }, { kind: "DIRECTORY_UPLOAD" },
    { summary: { ...source.summary, pendingCount: "1" } }, { summary: { ...source.summary, pendingCount: undefined } }]) {
    assert.equal(isConfirmedEmptyGitSource({ ...source, ...patch }, detail), false);
  }
  for (const status of ["BLOCKED", "FAILED_RETRYABLE", "CANCELLED", "ENUMERATING", "WAITING_FOR_CLIENT"]) {
    assert.equal(isConfirmedEmptyGitSource(source, { ...detail, run: { status } }), false);
  }
  assert.equal(isConfirmedEmptyGitSource(source, { ...detail, candidate: null }), false);
  assert.equal(isConfirmedEmptyGitSource(source, { ...detail, candidate: { components: [{ sourceId: "different", kind: "GIT" }] } }), false);
  assert.equal(isConfirmedEmptyGitSource(source, { ...detail, candidate: { components: [{ sourceId: "git", kind: "DIRECTORY_UPLOAD" }] } }), false);
});

test("frozen empty Git preserves scope and identity; nonempty and zero-byte directory versions are not empty Git", () => {
  assert.equal(isEmptyGitComponent(component), true);
  assert.equal(isEmptyGitComponent({ ...component, scope: { kind: "GIT_ROOT", root: "docs" } }), true);
  for (const patch of [{ kind: "DIRECTORY_UPLOAD" }, { manifestId: "" }, { nativeIdentity: null },
    { nativeIdentity: { commit: "commit", tree: "" } }, { fileCount: "1" }, { directoryCount: "1" },
    { knownBytes: "1" }, { fileCount: undefined }, { fileCount: 0 }]) {
    assert.equal(isEmptyGitComponent({ ...component, ...patch }), false);
  }
});
