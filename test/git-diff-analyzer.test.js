import assert from "node:assert/strict";
import test from "node:test";

import {
  GitDiffAnalyzer,
  correlateGitDiffWithFactChanges,
  parseGitNameStatus,
} from "../src/scanner/index.js";

test("Git name-status parsing preserves add, delete, and rename paths", () => {
  const changes = parseGitNameStatus(
    "M\0src/order.js\0A\0src/new.js\0D\0src/old.js\0R087\0src/before.js\0src/after.js\0",
  );

  assert.deepEqual(changes, [
    { status: "M", similarity: null, previousPath: null, path: "src/order.js" },
    { status: "A", similarity: null, previousPath: null, path: "src/new.js" },
    { status: "D", similarity: null, previousPath: null, path: "src/old.js" },
    { status: "R", similarity: 87, previousPath: "src/before.js", path: "src/after.js" },
  ]);
});

test("Git Diff analyzer invokes Git without a shell and correlates changed artifacts to Facts", async () => {
  const calls = [];
  const analyzer = new GitDiffAnalyzer({
    runGit: async (rootPath, args) => {
      calls.push({ rootPath, args });
      return "M\0src/order.js\0A\0docs/rule.md\0";
    },
  });
  const gitDiff = await analyzer.analyze({
    rootPath: "/repo",
    fromCommit: "a".repeat(40),
    toCommit: "b".repeat(40),
  });

  assert.deepEqual(calls[0], {
    rootPath: "/repo",
    args: [
      "diff",
      "--name-status",
      "--find-renames=50%",
      "-z",
      "a".repeat(40),
      "b".repeat(40),
      "--",
    ],
  });
  assert.deepEqual(gitDiff.changedArtifacts, ["docs/rule.md", "src/order.js"]);
  const correlation = correlateGitDiffWithFactChanges(gitDiff, [
    { id: "FACT-CHANGE-001", artifact: "src/order.js" },
    { id: "FACT-CHANGE-002", artifact: "src/unrelated.js" },
  ]);
  assert.deepEqual(correlation.factChangeIds, ["FACT-CHANGE-001"]);
  assert.deepEqual(correlation.changedArtifactsWithoutFacts, ["docs/rule.md"]);
});

test("Git Diff analyzer rejects ambiguous refs before invoking Git", async () => {
  const analyzer = new GitDiffAnalyzer({ runGit: async () => "" });
  await assert.rejects(
    analyzer.analyze({ rootPath: "/repo", fromCommit: "HEAD~1", toCommit: "HEAD" }),
    /full Git commit hash/,
  );
});
