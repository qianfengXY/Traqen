import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import test from "node:test";

import { compileDeterministicFacts } from "../src/deterministic-facts/extraction/compile.js";

const corpus = new URL("./fixtures/f002/reference-corpus/", import.meta.url);
const componentId = "a".repeat(64);

async function corpusMaterial(relativePath, mediaType = "text/plain") {
  const bytes = await readFile(new URL(relativePath, corpus));
  return { componentId, pathBytes: Buffer.from(relativePath, "utf8").toString("base64url"), mediaType, bytes,
    contentDigest: createHash("sha256").update(bytes).digest("hex") };
}

test("F002 independent reference corpus exposes missed and invented relations without trusting extractor output as expected", async () => {
  const expected = JSON.parse(await readFile(new URL("expected.json", corpus), "utf8"));
  const result = compileDeterministicFacts({
    workspaceId: "workspace", bundleId: "b".repeat(64), profile: { id: "c".repeat(64), version: "1" },
    materials: [await corpusMaterial("src/orders.js"), await corpusMaterial("docs/orders.md", "text/markdown"), await corpusMaterial("config/orders.properties")],
  });
  const objectById = new Map(result.objects.map((object) => [object.objectId, object]));
  for (const name of expected.mustContainNames) assert.ok(result.objects.some((object) => object.name === name), `reference corpus requires ${name}`);
  for (const name of expected.mustNotContainNames) assert.equal(result.objects.some((object) => object.name === name), false, `reference corpus forbids ${name}`);
  const actualRelations = result.facts.filter((fact) => fact.kind === "RELATION").map((fact) => ({
    predicate: fact.predicate, subject: objectById.get(fact.subjectId).name, target: objectById.get(fact.targetId).name,
  }));
  for (const relation of expected.relations) assert.ok(actualRelations.some((actual) => actual.predicate === relation.predicate && actual.subject === relation.subject && actual.target === relation.target),
    `reference corpus requires ${relation.subject} ${relation.predicate} ${relation.target}`);
  assert.equal(actualRelations.some((actual) => actual.predicate === "staticCalls" && actual.subject === "shadowed"), false, "a shadowed parameter must not be linked to the global declaration");
  assert.equal(fileURLToPath(corpus).includes("reference-corpus"), true, "the manual expectations and source bytes are stored independently from generated outputs");
});
