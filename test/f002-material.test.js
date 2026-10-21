import assert from "node:assert/strict";
import test from "node:test";

import { F002AdmissionService } from "../src/deterministic-facts/admission.js";
import { createProfileId } from "../src/deterministic-facts/identity.js";
import { F002MaterialService } from "../src/deterministic-facts/material-service.js";
import { redactDisplayBytes } from "../src/deterministic-facts/policy.js";
import { F002PublicationService } from "../src/deterministic-facts/publication-service.js";
import { F002Repository } from "../src/deterministic-facts/repository.js";
import { F002Worker } from "../src/deterministic-facts/worker.js";
import { SourceAdmissionService } from "../src/source-truth/admission-service.js";
import { SourcePublicationService } from "../src/source-truth/publication-service.js";
import { candidateFixture } from "./support/source-truth-candidate-fixture.js";
import { owner, reader } from "./support/source-truth-database.js";
import { verifiedF002Records } from "./support/f002-records.js";

function profile() {
  const input = { version: "1", schemaVersion: 1, capabilityIds: ["inventory"], ruleVersions: ["inventory@1"], canonicalizationVersion: "1", extractionLimits: { maxBytes: 1024, maxRecords: 10 }, redactionPolicyRevision: "policy-v1" };
  return { ...input, id: createProfileId(input), startable: true };
}

async function readWorkerSealedMaterial(t, { content, entryPath, directoryPaths = [], operationId }) {
  const source = await candidateFixture(t, { git: true, entryPath, directoryPaths, content });
  const prepared = await source.candidates.prepare(source.context);
  await source.advance("RECONCILING", "REVIEW_REQUIRED");
  const sourcePublication = new SourcePublicationService(source.repository, source.candidates);
  const confirmation = await sourcePublication.confirm(owner, source.context, { candidateId: prepared.id, gapSetId: prepared.gapSetId });
  const frozen = await sourcePublication.seal(owner, source.context, { confirmationId: confirmation.id, clientToken: `${operationId}-source` });
  const repository = new F002Repository(source.db, {
    authorize: (actor, workspaceId, tx, maintain) => source.repository.authorize(actor, workspaceId, maintain, tx),
  });
  const profileInput = { version: "1", schemaVersion: 1, capabilityIds: ["inventory", "yaml"], ruleVersions: ["inventory@1", "yaml@1"],
    canonicalizationVersion: "1", extractionLimits: { maxBytes: 4096, maxRecords: 100 }, redactionPolicyRevision: "policy-v1" };
  const configuredProfile = { ...profileInput, id: createProfileId(profileInput), startable: true };
  await repository.registerProfile(configuredProfile);
  const admission = new F002AdmissionService(repository, new SourceAdmissionService(source.repository, source.candidates));
  const reference = { bundleId: frozen.bundle.id, receiptId: frozen.receipt.id };
  const inventory = await admission.sourceAdmission.inventory(owner, "workspace", reference);
  const componentId = inventory.items[0].componentId;
  const run = await admission.start(owner, "workspace", { operationId, reference, profile: configuredProfile,
    scopes: [{ selections: [{ kind: "COMPONENT", componentId }] }] });
  const scope = run.scopes[0];
  const ready = await new F002Worker(repository, { admission }).run(owner, "workspace", run.id, scope.scopeId,
    { workerId: `${operationId}-worker`, leaseMs: 60_000, timeoutMs: 10_000 });
  assert.equal(ready.status, "READY_TO_SEAL");
  const sealed = await new F002PublicationService(repository).publish(owner, "workspace", run.id, scope.scopeId,
    { revision: ready.revision, operationId: `${operationId}-seal` });
  const material = (await source.db.query("SELECT id,payload FROM f002_record WHERE workspace_id=$1 AND graph_version_id=$2 AND kind='MATERIAL'", ["workspace", sealed.graphVersionId])).rows[0];
  assert.ok(material, "the worker must publish the admitted material");
  await assert.rejects(source.repository.authorize(reader, "workspace", true), { code: "SOURCE_FORBIDDEN" });
  const result = await new F002MaterialService(repository, admission).read(reader, "workspace", sealed.graphVersionId, material.id);
  const chunks = [];
  for await (const chunk of admission.readFile(reader, "workspace", run.id, { componentId: material.payload.componentId, pathBytes: material.payload.pathBytes })) chunks.push(Buffer.from(chunk));
  const frozenBytes = Buffer.concat(chunks);
  assert.deepEqual(frozenBytes, Buffer.from(content, "utf8"), "re-reading the actual F001 frozen source after presentation must retain every original byte");
  assert.equal(result.originalDigest, source.digest);
  return { source, result, frozenBytes, material, graphVersionId: sealed.graphVersionId };
}

async function fixture(t) {
  const source = await candidateFixture(t);
  const prepared = await source.candidates.prepare(source.context);
  await source.advance("RECONCILING", "REVIEW_REQUIRED");
  const publication = new SourcePublicationService(source.repository, source.candidates);
  const confirmation = await publication.confirm(owner, source.context, { candidateId: prepared.id, gapSetId: prepared.gapSetId });
  const frozen = await publication.seal(owner, source.context, { confirmationId: confirmation.id, clientToken: "f002-material" });
  const repository = new F002Repository(source.db, { authorize: (actor, workspaceId, tx) => source.repository.authorize(actor, workspaceId, false, tx) });
  const configuredProfile = profile();
  await repository.registerProfile(configuredProfile);
  const admission = new F002AdmissionService(repository, new SourceAdmissionService(source.repository, source.candidates));
  const reference = { bundleId: frozen.bundle.id, receiptId: frozen.receipt.id };
  const inventory = await admission.sourceAdmission.inventory(owner, "workspace", reference);
  const componentId = inventory.items[0].componentId;
  const run = await admission.start(owner, "workspace", { operationId: "material-run", reference, profile: configuredProfile,
    scopes: [{ selections: [{ kind: "COMPONENT", componentId }] }] });
  const scope = run.scopes[0];
  const claimed = await repository.claimScope(owner, "workspace", run.id, scope.scopeId, { workerId: "material-worker", leaseMs: 60_000 });
  const verified = verifiedF002Records({ workspaceId: "workspace", bundleId: reference.bundleId, componentId, profile: configuredProfile,
    path: Buffer.from(source.entry.pathBytes, "base64url").toString("utf8"), source: source.bytes.toString("utf8"), mediaType: "text/plain" });
  const materialId = verified.materialId;
  const f002Publication = new F002PublicationService(repository);
  await f002Publication.prepare(owner, "workspace", run.id, scope.scopeId, { generation: claimed.generation, records: verified.records });
  await repository.recordScopeItems(owner, { workspaceId: "workspace", runId: run.id, scopeId: scope.scopeId, generation: claimed.generation,
    items: [{ materialId, capabilityId: "javascript", status: "DONE" }] });
  const ready = await repository.readyToSeal(owner, { workspaceId: "workspace", runId: run.id, scopeId: scope.scopeId, generation: claimed.generation });
  const sealed = await f002Publication.publish(owner, "workspace", run.id, scope.scopeId, { revision: ready.revision, operationId: "material-seal" });
  return { ...source, sourceRepository: source.repository, repository, admission, run, materialId, graphVersionId: sealed.graphVersionId };
}

test("F002 reads a sealed no-Fact material through F001, verifies its hash, and keeps audit content-free", async (t) => {
  const f = await fixture(t);
  const materials = new F002MaterialService(f.repository, f.admission);
  const result = await materials.read(owner, "workspace", f.graphVersionId, f.materialId);
  assert.deepEqual(result.bytes, f.bytes);
  assert.equal(result.originalDigest, f.digest);
  assert.match(result.readableRef, /^[a-f0-9]{64}$/);
  const events = await f.db.query("SELECT event_type,payload FROM f002_event WHERE workspace_id='workspace' AND run_id=$1 ORDER BY sequence", [f.run.id]);
  assert.deepEqual(events.rows.slice(-2).map((row) => row.event_type), ["READ_INTENT", "READ_COMPLETED"]);
  assert.equal(JSON.stringify(events.rows.slice(-2)).includes(JSON.stringify(f.bytes.toString("utf8"))), false, "audit must not store source bytes");
  await f.sourceRepository.provision("workspace", { tenantId: "tenant", grants: [{ actorId: "owner", role: "REVOKED" }] });
  await assert.rejects(materials.read(owner, "workspace", f.graphVersionId, f.materialId), { code: "SOURCE_FORBIDDEN" });
});

test("F002 policy redacts secret assignment values without changing the original content hash", () => {
  const original = Buffer.from("api_key=visible-secret\nname=orders\n", "utf8");
  const display = redactDisplayBytes(original);
  assert.equal(display.redacted, true);
  assert.equal(display.bytes.toString("utf8").includes("visible-secret"), false);
  assert.equal(original.toString("utf8").includes("visible-secret"), true);
});

test("F002 controlled presentation selects inert text for a worker-sealed no-Fact configuration", async t => {
  const content = "password=SYNTHETIC_MEDIA_PASSWORD\r\nname=orders\r\n# readable physical line\r\n";
  const { source, result, material, graphVersionId } = await readWorkerSealedMaterial(t,
    { content, entryPath: "application.properties", operationId: "material-display-text-type" });
  assert.equal(material.payload.mediaType, "application/octet-stream", "sealed source metadata must not be rewritten to make a presentation pass");
  assert.equal((await source.db.query("SELECT count(*)::integer AS count FROM f002_record WHERE graph_version_id=$1 AND kind='FACT'", [graphVersionId])).rows[0].count, 0);
  assert.equal(result.mediaType, "text/plain", "the controlled HTTP reader must expose inert text so the real UI can render physical lines");
  assert.equal(result.bytes.includes("SYNTHETIC_MEDIA_PASSWORD"), false);
  assert.equal(result.bytes.includes("name=orders"), true);
  assert.equal(result.bytes.toString().split(/\r\n|\r|\n/).length, 4);
});

test("F002 controlled presentation keeps non-text bytes opaque regardless of a text filename", async t => {
  const content = Buffer.from([0, 0xff, 1, 2, 10, 3]);
  const { result } = await readWorkerSealedMaterial(t,
    { content, entryPath: "not-text.txt", operationId: "material-display-binary-type" });
  assert.equal(result.mediaType, "application/octet-stream");
  assert.deepEqual(result.bytes, content);
});

test("F002 known configuration binary encoding is refused instead of reclassified by its filename", async t => {
  const content = Buffer.from([0, 0xff, 1, 2, 10, 3]);
  const { result } = await readWorkerSealedMaterial(t,
    { content, entryPath: "application.properties", operationId: "material-config-binary-type" });
  assert.equal(result.transform, "CONFIG_SECRET_PRESENTATION_REFUSAL");
  assert.equal(result.redacted, true);
  assert.equal(result.mediaType, "text/plain");
  assert.notDeepEqual(result.bytes, content);
});

test("F002 controlled dotenv presentation uses current policy on an old worker-sealed no-Fact source", async t => {
  const content = 'export API_TOKEN="FIRST_DOTENV_SENTINEL\r\nSECOND_DOTENV_SENTINEL"\r\nPORT=8080\r\n';
  const { source, result, material, graphVersionId } = await readWorkerSealedMaterial(t,
    { content, entryPath: ".env.production", operationId: "material-dotenv-old-profile" });
  assert.equal(material.payload.mediaType, "application/octet-stream");
  assert.equal((await source.db.query("SELECT count(*)::integer AS count FROM f002_record WHERE graph_version_id=$1 AND kind='FACT'", [graphVersionId])).rows[0].count, 0);
  assert.equal(result.mediaType, "text/plain"); assert.equal(result.policyRevision, "policy-v4-private-key-boundaries");
  assert.equal(result.transform, "CONFIG_SECRET_VALUE_REDACTION");
  for (const marker of ["FIRST_DOTENV_SENTINEL", "SECOND_DOTENV_SENTINEL"]) assert.equal(result.bytes.includes(marker), false);
  assert.ok(result.bytes.includes("PORT=8080")); assert.equal(result.bytes.toString().split("\r\n").length, content.split("\r\n").length);
});

test("F002 controlled dotenv presentation refuses malformed or non-UTF8 sources after real admitted reads", async t => {
  for (const [suffix, content] of [["unclosed", Buffer.from('export API_TOKEN="FIRST_DOTENV_SENTINEL\n')],
    ["encoding", Buffer.from([0xff, ...Buffer.from('API_TOKEN=FIRST_DOTENV_SENTINEL')])]]) {
    const { result } = await readWorkerSealedMaterial(t,
      { content, entryPath: `.env.${suffix}`, operationId: `material-dotenv-${suffix}` });
    assert.equal(result.transform, "CONFIG_SECRET_PRESENTATION_REFUSAL");
    assert.equal(result.policyRevision, "policy-v4-private-key-boundaries"); assert.equal(result.mediaType, "text/plain");
    assert.equal(result.bytes.includes("FIRST_DOTENV_SENTINEL"), false);
  }
});

test("F002 controlled dotenv presentation protects a known filename under a non-UTF8 admitted parent directory", async t => {
  const { result } = await readWorkerSealedMaterial(t, { content: 'export API_TOKEN="FIRST_DOTENV_SENTINEL\nSECOND_DOTENV_SENTINEL"\n',
    entryPath: Buffer.from([0xff, 47, ...Buffer.from(".env.prod")]), directoryPaths: [Buffer.from([0xff])], operationId: "material-dotenv-opaque-path" });
  assert.equal(result.transform, "CONFIG_SECRET_VALUE_REDACTION"); assert.equal(result.policyRevision, "policy-v4-private-key-boundaries");
  assert.equal(result.bytes.includes("FIRST_DOTENV_SENTINEL"), false); assert.equal(result.bytes.includes("SECOND_DOTENV_SENTINEL"), false);
});

const rasterFixtures = [
  ["PNG", "image/png", "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j7yQAAAAASUVORK5CYII="],
  ["GIF", "image/gif", "R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=="],
];
for (const [format, mediaType, encoded] of rasterFixtures) {
  test(`F002 controlled raster image ${format} remains readable with no Fact and no trusted source MIME`, async t => {
    const content = Buffer.from(encoded, "base64");
    const { source, result, material, graphVersionId } = await readWorkerSealedMaterial(t,
      { content, entryPath: `unparsed-${format.toLowerCase()}.bin`, operationId: `material-raster-${format.toLowerCase()}` });
    assert.equal(material.payload.mediaType, "application/octet-stream");
    assert.equal((await source.db.query("SELECT count(*)::integer AS count FROM f002_record WHERE graph_version_id=$1 AND kind='FACT'", [graphVersionId])).rows[0].count, 0);
    assert.equal(result.mediaType, mediaType, "an approved original raster image must reach the image decoder without inventing a Fact or trusting its extension");
    assert.deepEqual(result.bytes, content);
    assert.equal(result.originalDigest, result.displayDigest);
    assert.equal(result.redacted, false);
  });
}

test("F002 presentation policy redacts nested JSON configuration secrets", () => {
  const original = Buffer.from('{"database":{"password":"SYNTHETIC_REVIEW_SECRET"},"token":"also-secret","name":"orders"}', "utf8");
  const display = redactDisplayBytes(original);
  assert.equal(display.redacted, true);
  assert.equal(display.bytes.toString("utf8").includes("SYNTHETIC_REVIEW_SECRET"), false);
  assert.equal(display.bytes.toString("utf8").includes("also-secret"), false);
  assert.equal(display.bytes.toString("utf8").includes("orders"), true);
});

test("F002 presentation policy redacts recognized YAML and properties secret values across grammar forms", () => {
  const secret = "SYNTHETIC_CONFIG_SECRET";
  const cases = [
    ["quoted YAML key", `"password": ${secret}\n`],
    ["YAML escaped quoted key", `"pass\\u0077ord": ${secret}\n`],
    ["YAML hexadecimal escaped key", `"pass\\x77ord": ${secret}\n`],
    ["YAML sequence mapping", `credentials:\n  - password: ${secret}\n`],
    ["YAML flow mapping", `credentials: {password: ${secret}}\n`],
    ["YAML quoted flow key", `credentials: {"password": ${secret}}\n`],
    ["YAML indentless sequence value", `password:\n- ${secret}\n`],
    ["YAML single-pair flow mapping", `credentials: [password: ${secret}]\n`],
    ["YAML sequence explicit key", `credentials:\n  - ? password\n    : ${secret}\n`],
    ["YAML escaped key with separation", `"pass\\x77ord" : ${secret}\n`],
    ["YAML literal scalar", `password: |\n  ${secret}\n`],
    ["YAML multiline plain scalar", `password: ${secret}_FIRST\n  ${secret}_SECOND\n`],
    ["properties continuation", `password=\\\n  ${secret}\n`],
    ["properties escaped key", `pass\\u0077ord=${secret}\n`],
    ["properties continued key", `pass\\\n  word=${secret}\n`],
    ["properties comment cannot continue", `# harmless comment \\\npassword=${secret}\n`],
  ];
  for (const [name, source] of cases) {
    const display = redactDisplayBytes(Buffer.from(source, "utf8"));
    assert.equal(display.redacted, true, `${name} must report a display transform`);
    assert.equal(display.bytes.toString("utf8").includes(secret), false, `${name} must not expose a recognized secret value`);
  }
  const empty = Buffer.from("password=\nname=orders\n", "utf8");
  assert.deepEqual(redactDisplayBytes(empty).bytes, empty, "an empty sensitive value is safe to preserve");
  const benign = Buffer.from("app: orders\n", "utf8");
  assert.deepEqual(redactDisplayBytes(benign).bytes, benign, "ordinary configuration remains readable");
});

const contextualSensitiveCases = [
  ["YAML comment before an indentless sensitive sequence", `password: # rotation values\n- SYNTHETIC_CONTEXT_SECRET\n`, "CONFIG_SECRET_VALUE_REDACTION"],
  ["YAML bare-hyphen sensitive sequence value", `password:\n-\n  SYNTHETIC_CONTEXT_SECRET\n`, "CONFIG_SECRET_VALUE_REDACTION"],
  ["YAML flow explicit sensitive key", `credentials: { ? password: SYNTHETIC_CONTEXT_SECRET }\n`, "CONFIG_SECRET_PRESENTATION_REFUSAL"],
  ["YAML nested explicit sensitive key", `credentials:\n- - ? password\n    : SYNTHETIC_CONTEXT_SECRET\n`, "CONFIG_SECRET_PRESENTATION_REFUSAL"],
  ["properties hash inside a continued sensitive value", `password=first\\\n#middle\\\nSYNTHETIC_CONTEXT_SECRET\n`, "CONFIG_SECRET_VALUE_REDACTION"],
  ["properties bang inside a continued sensitive value", `password=first\\\n!middle\\\nSYNTHETIC_CONTEXT_SECRET\n`, "CONFIG_SECRET_VALUE_REDACTION"],
];

for (const [name, source, transform] of contextualSensitiveCases) {
  test(`F002 ${name} closes the complete sensitive source range`, () => {
    const display = redactDisplayBytes(Buffer.from(source, "utf8"));
    assert.equal(display.transform, transform);
    assert.equal(display.bytes.toString("utf8").includes("SYNTHETIC_CONTEXT_SECRET"), false);
  });
}

test("F002 applies properties continuation only when a backslash is the terminal byte", () => {
  const secret = "SYNTHETIC_TRAILING_SPACE_SECRET";
  const source = `password=${secret}\\ \r\nname=orders\r\n`;
  const display = redactDisplayBytes(Buffer.from(source, "utf8")).bytes.toString("utf8");
  assert.equal(display.includes(secret), false);
  assert.equal(display.includes("name=orders"), true, "a non-terminal backslash cannot consume the next property");
});

test("F002 refuses an unmapped sensitive YAML key instead of returning original bytes", () => {
  const secret = "SYNTHETIC_EXPLICIT_YAML_SECRET";
  const display = redactDisplayBytes(Buffer.from(`? password\n: ${secret}\n`, "utf8"));
  assert.equal(display.redacted, true);
  assert.equal(display.transform, "CONFIG_SECRET_PRESENTATION_REFUSAL");
  assert.equal(display.bytes.toString("utf8").includes(secret), false);
});

const explicitSensitiveYamlCases = [
  ["double-quoted block explicit key", `? "password"\n: SYNTHETIC_EXPLICIT_PASSWORD\n`],
  ["single-quoted block explicit key", `? 'password'\n: SYNTHETIC_EXPLICIT_PASSWORD\n`],
  ["nested quoted block explicit key", `- ? "password"\n  : SYNTHETIC_EXPLICIT_PASSWORD\n`],
  ["escaped block explicit key", `? "pass\\u0077ord"\n: SYNTHETIC_EXPLICIT_PASSWORD\n`],
  ["multiline block explicit key", `?\n  password\n: SYNTHETIC_EXPLICIT_PASSWORD\n`],
  ["multiline flow explicit key", `creds: { ? password\n: SYNTHETIC_EXPLICIT_PASSWORD }\n`],
  ["bare multiline flow explicit key", `creds: { ?\n  password\n: SYNTHETIC_EXPLICIT_PASSWORD }\n`],
];

for (const [name, source] of explicitSensitiveYamlCases) {
  test(`F002 refuses a recognized ${name} instead of leaking its value`, () => {
    const display = redactDisplayBytes(Buffer.from(source, "utf8"));
    assert.equal(display.transform, "CONFIG_SECRET_PRESENTATION_REFUSAL");
    assert.equal(display.bytes.toString("utf8").includes("SYNTHETIC_EXPLICIT_PASSWORD"), false);
  });
}

test("F002 keeps a non-sensitive quoted explicit YAML key readable", () => {
  const source = `? "name"\n: orders\n`;
  const display = redactDisplayBytes(Buffer.from(source, "utf8"));
  assert.equal(display.redacted, false);
  assert.deepEqual(display.bytes, Buffer.from(source, "utf8"));
});

test("F002 refuses a sensitive explicit YAML key after a comment-only key line", () => {
  const source = `? # semantic key follows\n  password\n: SYNTHETIC_EXPLICIT_PASSWORD\n`;
  const display = redactDisplayBytes(Buffer.from(source, "utf8"));
  assert.equal(display.transform, "CONFIG_SECRET_PRESENTATION_REFUSAL");
  assert.equal(display.bytes.toString("utf8").includes("SYNTHETIC_EXPLICIT_PASSWORD"), false);
});

const emptySensitiveSiblingCases = [
  ["the next sequence item", `- password:\n- name: orders\n`],
  ["a compact-mapping sibling", `- password:\n  name: orders\n`],
  ["the next sequence item after a comment-only empty value", `- password:\n  # intentionally empty\n- name: orders\n`],
];

for (const [name, source] of emptySensitiveSiblingCases) {
  test(`F002 preserves ${name} after an empty YAML password`, () => {
    const display = redactDisplayBytes(Buffer.from(source, "utf8"));
    assert.equal(display.redacted, false);
    assert.deepEqual(display.bytes, Buffer.from(source, "utf8"));
  });
}

test("F002 redacts recognized YAML secrets on the real F001-to-F002 READ-only material path", async (t) => {
  const secret = "SYNTHETIC_F001_F002_SECRET";
  const content = `app: orders\n"password": ${secret}_QUOTED\ncredentials:\n  - password: ${secret}_SEQUENCE\ninline: {password: ${secret}_FLOW}\nindentless:\n  password:\n  - ${secret}_INDENTLESS\nflow_pair: [password: ${secret}_FLOW_PAIR]\nexplicit:\n  - ? password\n    : ${secret}_EXPLICIT\nescaped:\n  "pass\\x77ord" : ${secret}_HEX_SPACE\nmultiline:\n  password: |\n    ${secret}_BLOCK\n`;
  const { source, result } = await readWorkerSealedMaterial(t, { content, entryPath: "application.yaml", operationId: "material-redaction-run" });
  assert.equal(result.originalDigest, source.digest, "the raw frozen source digest remains intact");
  assert.equal(result.redacted, true);
  assert.equal(result.bytes.toString("utf8").includes(secret), false, "a READ-only member must never receive a recognized YAML secret");
  assert.deepEqual(source.bytes, Buffer.from(content, "utf8"), "redaction changes only the presentation copy");
});

test("F002 redacts contextual YAML password values on the real F001-to-F002 READ-only path", async (t) => {
  const secret = "SYNTHETIC_CONTEXT_READ_YAML";
  const content = `app: orders\ncommented:\n  password: # rotation values\n  - ${secret}_COMMENT\nbare:\n  password:\n  -\n    ${secret}_BARE\n`;
  const { source, result } = await readWorkerSealedMaterial(t, { content, entryPath: "application.yaml", operationId: "material-context-yaml" });
  assert.equal(result.redacted, true);
  assert.equal(result.bytes.toString("utf8").includes(secret), false);
  assert.equal(result.originalDigest, source.digest);
  assert.deepEqual(source.bytes, Buffer.from(content, "utf8"));
});

test("F002 redacts continued properties password values on the real F001-to-F002 READ-only path", async (t) => {
  const secret = "SYNTHETIC_CONTEXT_READ_PROPERTIES";
  const content = `app=orders\ndb.password=first\\\n#middle\\\n${secret}_HASH\napi.password=first\\\n!middle\\\n${secret}_BANG\n`;
  const { source, result } = await readWorkerSealedMaterial(t, { content, entryPath: "application.properties", operationId: "material-context-properties" });
  assert.equal(result.redacted, true);
  assert.equal(result.bytes.toString("utf8").includes(secret), false);
  assert.equal(result.originalDigest, source.digest);
  assert.deepEqual(source.bytes, Buffer.from(content, "utf8"));
});

test("F002 refuses a quoted explicit password on the real F001-to-F002 READ-only path", async (t) => {
  const secret = "SYNTHETIC_EXPLICIT_READ_QUOTED";
  const content = `? "password"\n: ${secret}\n`;
  const { source, result } = await readWorkerSealedMaterial(t, { content, entryPath: "application.yaml", operationId: "material-explicit-quoted" });
  assert.equal(result.transform, "CONFIG_SECRET_PRESENTATION_REFUSAL");
  assert.equal(result.bytes.toString("utf8").includes(secret), false);
  assert.equal(result.originalDigest, source.digest);
  assert.deepEqual(source.bytes, Buffer.from(content, "utf8"));
});

test("F002 refuses a multiline flow explicit password on the real F001-to-F002 READ-only path", async (t) => {
  const secret = "SYNTHETIC_EXPLICIT_READ_FLOW";
  const content = `creds: { ? password\n: ${secret} }\n`;
  const { source, result } = await readWorkerSealedMaterial(t, { content, entryPath: "application.yaml", operationId: "material-explicit-flow" });
  assert.equal(result.transform, "CONFIG_SECRET_PRESENTATION_REFUSAL");
  assert.equal(result.bytes.toString("utf8").includes(secret), false);
  assert.equal(result.originalDigest, source.digest);
  assert.deepEqual(source.bytes, Buffer.from(content, "utf8"));
});

test("F002 preserves an empty password's benign sibling on the real F001-to-F002 READ-only path", async (t) => {
  const content = `- password:\n- name: orders\n`;
  const { source, result } = await readWorkerSealedMaterial(t, { content, entryPath: "application.yaml", operationId: "material-empty-password-sibling" });
  assert.equal(result.redacted, false);
  assert.deepEqual(result.bytes, Buffer.from(content, "utf8"));
  assert.equal(result.originalDigest, source.digest);
  assert.deepEqual(source.bytes, Buffer.from(content, "utf8"));
});

const lexicalSensitiveCases = [
  ["apostrophe in a comment before a flow explicit key", `# don't log credentials\ncredentials: { ? password: SYNTHETIC_LEXICAL_SECRET }\n`],
  ["double quote in a comment before a flow explicit key", `# an unmatched \" is a comment, not a scalar\ncredentials: { ? password: SYNTHETIC_LEXICAL_SECRET }\n`],
  ["escaped line break inside a semantic explicit key", `? \"pass\\\n  word\"\n: SYNTHETIC_LEXICAL_SECRET\n`],
  ["apostrophe in a block scalar before a flow explicit key", `message: |\n  Don't print credentials.\ncredentials: { ? password: SYNTHETIC_LEXICAL_SECRET }\n`],
  ["standard string tag on a semantic explicit key", `? !!str password\n: SYNTHETIC_LEXICAL_SECRET\n`],
  ["anchor property on a semantic explicit key", `? &key password\n: SYNTHETIC_LEXICAL_SECRET\n`],
];

test("F002 known YAML scalar data bypasses properties syntax on the real READ-only path", async t => {
  const content = "password=literal documentation\n";
  const { result } = await readWorkerSealedMaterial(t, { content, entryPath: "readme.yaml", operationId: "material-scalar-format" });
  assert.equal(result.redacted, false);
  assert.deepEqual(result.bytes, Buffer.from(content));
});

test("F002 ordinary document bytes are not reinterpreted as configuration on the real READ-only path", async t => {
  const content = "# Heading\n\nA paragraph: without configuration.\n\n```yaml\npassword=example\n```\n";
  const { result } = await readWorkerSealedMaterial(t, { content, entryPath: "README.md", operationId: "material-document-format" });
  assert.equal(result.redacted, false);
  assert.deepEqual(result.bytes, Buffer.from(content));
});

test("F002 known YAML encoding errors refuse presentation under an opaque admitted parent", async t => {
  const content = Buffer.from([0xff, ...Buffer.from("password: SYNTHETIC_ROLE_SECRET")]);
  const { result } = await readWorkerSealedMaterial(t, { content, entryPath: Buffer.from([0xfe, 47, ...Buffer.from("config.YML")]),
    directoryPaths: [Buffer.from([0xfe])], operationId: "material-yaml-format-encoding" });
  assert.equal(result.transform, "CONFIG_SECRET_PRESENTATION_REFUSAL");
  assert.equal(result.bytes.includes("SYNTHETIC_ROLE_SECRET"), false);
});

test("F002 JSON display retains fixed physical source lines on the real READ-only path", async t => {
  const content = '{\r\n  "password": "SYNTHETIC_ROLE_SECRET",\r\n  "name": "orders"\r\n}\r\n';
  const { result } = await readWorkerSealedMaterial(t, { content, entryPath: "settings.JSON", operationId: "material-json-format-lines" });
  assert.equal(result.transform, "CONFIG_SECRET_VALUE_REDACTION");
  assert.equal(result.bytes.includes("SYNTHETIC_ROLE_SECRET"), false);
  assert.equal(result.bytes.toString().split("\r\n").length, content.split("\r\n").length);
});
for (const [name, content] of lexicalSensitiveCases) {
  test(`F002 lexical context refuses ${name}`, () => {
    const original = Buffer.from(content, "utf8");
    const result = redactDisplayBytes(original);
    assert.equal(result.transform, "CONFIG_SECRET_PRESENTATION_REFUSAL");
    assert.equal(result.bytes.includes(Buffer.from("SYNTHETIC_LEXICAL_SECRET")), false);
    assert.deepEqual(original, Buffer.from(content, "utf8"));
  });
}

const lexicalBenignCases = [
  ["explicit-looking data inside a literal scalar", `note: |\n  ? password\n  : example text\nname: orders\n`],
  ["property-looking data inside a literal scalar", `note: |\n  password=example text\nname: orders\n`],
  ["explicit-looking data inside a quoted scalar", `note: '{ ? password: example text }'\nname: orders\n`],
  ["sensitive-looking text in comments", `# ? password: example\nname: orders\n`],
];
for (const [name, content] of lexicalBenignCases) {
  test(`F002 lexical context preserves ${name}`, () => {
    const result = redactDisplayBytes(Buffer.from(content, "utf8"));
    assert.equal(result.redacted, false);
    assert.deepEqual(result.bytes, Buffer.from(content, "utf8"));
  });
}

for (const [index, [name, content]] of lexicalSensitiveCases.entries()) {
  test(`F002 lexical context refuses ${name} on the real READ-only material chain`, async (t) => {
    const { result } = await readWorkerSealedMaterial(t, { content, entryPath: "application.yaml", operationId: `material-lexical-${index}` });
    assert.equal(result.transform, "CONFIG_SECRET_PRESENTATION_REFUSAL");
    assert.equal(result.bytes.includes(Buffer.from("SYNTHETIC_LEXICAL_SECRET")), false);
  });
}

test("F002 lexical context preserves literal documentation on the real READ-only material chain", async (t) => {
  const content = `description: |\n  ? password\n  : documentation only\nname: orders\n`;
  const { result } = await readWorkerSealedMaterial(t, { content, entryPath: "application.yaml", operationId: "material-lexical-benign" });
  assert.equal(result.redacted, false);
  assert.deepEqual(result.bytes, Buffer.from(content, "utf8"));
});
