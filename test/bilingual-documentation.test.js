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
