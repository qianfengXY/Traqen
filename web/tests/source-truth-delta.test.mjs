import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { deltaSources, selectedDeltaSource } from "../app/source-truth/delta.ts";

const source = (sourceId, kind = "DIRECTORY_UPLOAD", id = sourceId) => ({ sourceId, kind, id });
const version = (...components) => ({ components });

test("delta source selection includes a removed baseline component without inventing file deletions", () => {
  const directory = source("directory"), git = source("git", "GIT");
  const baseline = version(directory, git), target = version(git);
  assert.deepEqual(deltaSources(target, baseline).map((item) => item.sourceId), ["git", "directory"]);
  assert.deepEqual(target.components, [git]);
  assert.deepEqual(baseline.components, [directory, git]);
});

test("delta source identity is the registration, not the kind or immutable component version", () => {
  const before = source("old-directory"), after = source("new-directory");
  assert.deepEqual(deltaSources(version(after), version(before)).map((item) => item.sourceId), ["new-directory", "old-directory"]);
  const changed = source("old-directory", "DIRECTORY_UPLOAD", "new-component");
  assert.deepEqual(deltaSources(version(changed), version(before)), [changed]);
});

test("delta sources belong only to the selected pair and preserve the target before a baseline is selected", () => {
  const shared = source("shared"), removed = source("removed"), other = source("other");
  assert.deepEqual(deltaSources(version(shared)), [shared]);
  assert.deepEqual(deltaSources(version(shared), version(other)), [shared, other]);
  assert.deepEqual(deltaSources(version(shared), version(removed)), [shared, removed]);
});

test("the real frozen-version view uses the selected pair for its comparison source options", async () => {
  const view = await readFile(new URL("../app/source-truth/version-view.tsx", import.meta.url), "utf8");
  assert.match(view, /deltaSources\(version, baseline\)/);
  assert.match(view, /comparisonSources\.map\(/);
  assert.match(view, /value=\{selectedSourceId\}/);
  assert.match(view, /sourceId: selectedSourceId/);
  assert.match(view, /setSourceId\(selectedDeltaSource\(deltaSources\(version, versions\.find\(/);
  assert.match(view, /来源已移除（仅基线）/);
  assert.match(view, /来源新增（仅目标）/);
});

test("switching a baseline retains only a source that belongs to the newly selected pair", () => {
  const target = version(source("git", "GIT"));
  const previousPair = deltaSources(target, version(source("old-directory")));
  assert.equal(selectedDeltaSource(previousPair, "old-directory"), "old-directory");
  const nextPair = deltaSources(target, version(source("new-directory")));
  assert.equal(selectedDeltaSource(nextPair, "old-directory"), "git");
  assert.equal(selectedDeltaSource(nextPair, "new-directory"), "new-directory");
  assert.equal(selectedDeltaSource(nextPair, ""), "git");
  assert.equal(selectedDeltaSource([], "old-directory"), "");
});
