import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("the active traceability model does not require paired bilingual documentation", async () => {
  const source = await readFile(path.join(root, "web/app/trace-detail-model.ts"), "utf8");

  assert.doesNotMatch(source, /id: "TC-TRAQEN-BILINGUAL-DOC-005"/);
  assert.doesNotMatch(source, /中英文设计文档同步/);
  assert.match(source, /testCaseId: "RETIRED-TC-TRAQEN-BILINGUAL-DOC-005"/);
});
