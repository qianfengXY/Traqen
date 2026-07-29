import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ignoredDirectories = new Set([".git", "node_modules", "coverage", "dist", "build"]);

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(absolute)));
    else files.push(absolute);
  }
  return files;
}

function relative(file) {
  return path.relative(root, file).split(path.sep).join("/");
}

function counterpartFor(file, content) {
  const parsed = path.parse(file);
  if (content.startsWith("> Language: **English**")) {
    return path.join(parsed.dir, `${parsed.name}.zh-CN${parsed.ext}`);
  }
  if (content.startsWith("> 语言：**简体中文**")) {
    return path.join(parsed.dir, `${parsed.name}.en${parsed.ext}`);
  }
  assert.fail(`${relative(file)} must begin with a bilingual language switch`);
}

function workspaceAnalysisPhases(content) {
  const object = content.match(/type WorkspaceAnalysisJob = \{[\s\S]*?\n\};/);
  assert.ok(object, "expected WorkspaceAnalysisJob contract");
  const phase = object[0].match(/phase:\s*([\s\S]*?);/);
  assert.ok(phase, "expected WorkspaceAnalysisJob.phase contract");
  return [...phase[1].matchAll(/"([A-Z_]+)"/g)].map((match) => match[1]);
}

function workspaceAnalysisHappyPathEdges(content) {
  const phases = new Set(workspaceAnalysisPhases(content));
  return content
    .split("\n")
    .filter((line) => line.startsWith("| `"))
    .map((line) => line.split("|").map((cell) => cell.trim()))
    .map((cells) => [
      cells[1]?.match(/^`([A-Z_]+)`$/)?.[1],
      cells[3]?.match(/`([A-Z_]+)`/)?.[1],
    ])
    .filter(([from, to]) => phases.has(from) && phases.has(to))
    .map(([from, to]) => `${from}->${to}`);
}

test("documentation and README files have linked bilingual counterparts", async () => {
  const allFiles = await walk(root);
  const sourceFiles = allFiles.filter((file) => {
    const rel = relative(file);
    const isDocumentation = rel.startsWith("docs/") && rel.endsWith(".md");
    const isReadme = path.basename(file) === "README.md";
    return (isDocumentation || isReadme) && !file.endsWith(".zh-CN.md") && !file.endsWith(".en.md");
  });

  assert.ok(sourceFiles.length > 0, "expected bilingual documentation sources");
  for (const source of sourceFiles) {
    const sourceContent = await readFile(source, "utf8");
    const counterpart = counterpartFor(source, sourceContent);
    const counterpartContent = await readFile(counterpart, "utf8").catch(() => null);

    assert.ok(counterpartContent, `${relative(source)} is missing ${relative(counterpart)}`);
    assert.match(
      sourceContent.split("\n", 1)[0],
      new RegExp(`\\(${path.basename(counterpart).replaceAll(".", "\\.")}\\)`),
      `${relative(source)} must link to its counterpart`,
    );
    assert.match(
      counterpartContent.split("\n", 1)[0],
      new RegExp(`\\(${path.basename(source).replaceAll(".", "\\.")}\\)`),
      `${relative(counterpart)} must link back to its source`,
    );
  }
});

test("F001 lifecycle translations share the complete orchestration phase contract", async () => {
  const lifecyclePaths = [
    "docs/features/workspace-scan-and-analysis-lifecycle.md",
    "docs/features/workspace-scan-and-analysis-lifecycle.zh-CN.md",
  ];
  const documents = await Promise.all(
    lifecyclePaths.map((file) => readFile(path.join(root, file), "utf8")),
  );
  const expectedPhases = [
    "SOURCE_SCAN",
    "FACT_COMMIT",
    "ANALYSIS",
    "RECONCILIATION",
    "EVALUATION",
    "PROJECTION",
    "PUBLISHING",
  ];
  const expectedEdges = [
    "SOURCE_SCAN->FACT_COMMIT",
    "FACT_COMMIT->ANALYSIS",
    "ANALYSIS->RECONCILIATION",
    "RECONCILIATION->EVALUATION",
    "EVALUATION->PROJECTION",
    "PROJECTION->PUBLISHING",
  ];

  for (const document of documents) {
    assert.deepEqual(workspaceAnalysisPhases(document), expectedPhases);
    assert.deepEqual(workspaceAnalysisHappyPathEdges(document), expectedEdges);
  }
});
