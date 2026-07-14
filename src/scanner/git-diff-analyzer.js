import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";

import { contentId, deepFreeze } from "../domain/index.js";

const execFile = promisify(execFileCallback);
const commitPattern = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i;

function requireCommit(value, fieldName) {
  if (typeof value !== "string" || !commitPattern.test(value)) {
    throw new TypeError(`${fieldName} must be a full Git commit hash`);
  }
  return value.toLowerCase();
}

function normalizedArtifact(value) {
  return String(value ?? "").replaceAll("\\", "/").replace(/^\.\//, "");
}

export function parseGitNameStatus(output) {
  if (typeof output !== "string") throw new TypeError("Git diff output must be a string");
  const fields = output.split("\0");
  if (fields.at(-1) === "") fields.pop();
  const changes = [];
  for (let index = 0; index < fields.length;) {
    const rawStatus = fields[index++];
    if (!rawStatus) throw new TypeError("Git diff contains an empty status");
    const status = rawStatus[0];
    if (!["A", "C", "D", "M", "R", "T", "U", "X", "B"].includes(status)) {
      throw new TypeError(`Unsupported Git diff status ${rawStatus}`);
    }
    const renamedOrCopied = status === "R" || status === "C";
    const previousPath = renamedOrCopied ? normalizedArtifact(fields[index++]) : null;
    const path = normalizedArtifact(fields[index++]);
    if (!path || (renamedOrCopied && !previousPath)) {
      throw new TypeError(`Git diff status ${rawStatus} is missing a path`);
    }
    changes.push({
      status,
      similarity: renamedOrCopied ? Number(rawStatus.slice(1)) : null,
      previousPath,
      path,
    });
  }
  return deepFreeze(changes);
}

export function correlateGitDiffWithFactChanges(gitDiff, factChanges) {
  if (!Array.isArray(gitDiff?.changedArtifacts)) throw new TypeError("gitDiff.changedArtifacts must be an array");
  if (!Array.isArray(factChanges)) throw new TypeError("factChanges must be an array");
  const artifacts = new Set(gitDiff.changedArtifacts.map(normalizedArtifact));
  const correlatedChanges = factChanges.filter((change) => artifacts.has(normalizedArtifact(change.artifact)));
  const representedArtifacts = new Set(correlatedChanges.map((change) => normalizedArtifact(change.artifact)));
  return deepFreeze({
    gitDiffId: gitDiff.id,
    factChangeIds: correlatedChanges.map((change) => change.id),
    changedArtifactsWithoutFacts: [...artifacts].filter((artifact) => !representedArtifacts.has(artifact)).sort(),
  });
}

export class GitDiffAnalyzer {
  #runGit;

  constructor({ runGit = null } = {}) {
    this.#runGit = runGit ?? (async (rootPath, args) => {
      const result = await execFile("git", args, {
        cwd: rootPath,
        encoding: "utf8",
        timeout: 30_000,
        maxBuffer: 4 * 1024 * 1024,
        windowsHide: true,
      });
      return result.stdout;
    });
    if (typeof this.#runGit !== "function") throw new TypeError("runGit must be a function");
  }

  async analyze({ rootPath, fromCommit, toCommit }) {
    if (typeof rootPath !== "string" || rootPath.trim() === "") {
      throw new TypeError("rootPath must be a non-empty string");
    }
    const from = requireCommit(fromCommit, "fromCommit");
    const to = requireCommit(toCommit, "toCommit");
    if (from === to) throw new TypeError("fromCommit and toCommit must differ");
    const output = await this.#runGit(rootPath, [
      "diff",
      "--name-status",
      "--find-renames=50%",
      "-z",
      from,
      to,
      "--",
    ]);
    const changes = parseGitNameStatus(output);
    const changedArtifacts = [...new Set(changes.flatMap((change) => [change.previousPath, change.path]).filter(Boolean))]
      .sort();
    const identity = { fromCommit: from, toCommit: to, changes };
    return deepFreeze({
      id: contentId("GIT-DIFF", identity),
      fromCommit: from,
      toCommit: to,
      changes,
      changedArtifacts,
    });
  }
}
