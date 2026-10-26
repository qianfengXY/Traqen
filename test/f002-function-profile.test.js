import assert from "node:assert/strict";
import test from "node:test";
import { boundedF002Profile, createF002Runtime, technicalF002Profile } from "../src/deterministic-facts/runtime.js";
import { F002Repository } from "../src/deterministic-facts/repository.js";
import { F002QueryService } from "../src/deterministic-facts/queries.js";
import { SourceAdmissionService } from "../src/source-truth/admission-service.js";
import { createProfileId, createProfileConfigDigest } from "../src/deterministic-facts/identity.js";
import { owner, sourceDatabase } from "./support/source-truth-database.js";

test("F002 upgrade recommends the fixed profile without mutating or removing the retained original profile", async t => {
  const { db, repository: source } = await sourceDatabase(t);
  const repository = new F002Repository(db, { authorize: (actor, workspace, tx, maintain) => source.authorize(actor, workspace, maintain, tx) });
  const retained = structuredClone(technicalF002Profile());
  delete retained.extractionLimits.functionBindings;
  delete retained.extractionLimits.functionInitialization;
  retained.configDigest = createProfileConfigDigest(retained); retained.id = createProfileId(retained);
  await repository.registerProfile(retained);
  const priorProof = structuredClone(technicalF002Profile()); delete priorProof.extractionLimits.functionInitialization;
  priorProof.configDigest = createProfileConfigDigest(priorProof); priorProof.id = createProfileId(priorProof);
  await repository.registerProfile(priorProof);
  const runtime = await createF002Runtime({ sourceRuntime: { pool: db, services: { repository: source, admission: new SourceAdmissionService(source, {}) },
    configuration: { members: [{ ...owner, tokenDigest: "a".repeat(64) }], origins: [] } }, cursorSecret: "function-profile-upgrade-owned" });
  t.after(() => runtime.close());
  const profiles = await runtime.services.queries.profiles(owner, "workspace");
  assert.equal(profiles.find(profile => profile.id === retained.id).recommended, false);
  assert.equal(profiles.find(profile => profile.id === priorProof.id).recommended, false);
  const recommended = profiles.filter(profile => profile.recommended && profile.extractionLimits?.automaticPublication === "closed-scope-v1");
  assert.deepEqual(recommended.map(profile => profile.id), [technicalF002Profile().id]);
  assert.deepEqual(await runtime.services.repository.getProfile(owner, "workspace", retained.id), retained, "history is not rewritten to demote the UI recommendation");
  assert.deepEqual(await runtime.services.repository.getProfile(owner, "workspace", priorProof.id), priorProof);
});

test("F002 profile recommendations cannot be inherited from persisted payload metadata", async t => {
  const { db, repository: source } = await sourceDatabase(t);
  const repository = new F002Repository(db, { authorize: (actor, workspace, tx, maintain) => source.authorize(actor, workspace, maintain, tx) });
  const technical = technicalF002Profile(), bounded = boundedF002Profile();
  await repository.registerProfile(technical);
  await repository.registerProfile(bounded);
  const variants = [];
  for (const [index, value] of ["closed-scope-v2", "closed-scope-v1 ", "TRUE", true, 1, null].entries()) {
    const profile = structuredClone(technical);
    profile.version = `recommendation-near-miss-${index}`;
    profile.extractionLimits.automaticPublication = value;
    profile.configDigest = createProfileConfigDigest(profile); profile.id = createProfileId(profile);
    await repository.registerProfile(profile); variants.push(profile);
  }
  const stored = (await db.query("SELECT id,payload,startable FROM f002_profile ORDER BY id")).rows;
  for (const preferredProfileId of [technical.id, bounded.id, variants[0].id, null]) {
    const queries = new F002QueryService(repository, { cursorSecret: "recommendation-current-projection", preferredProfileId });
    const profiles = await queries.profiles(owner, "workspace");
    for (const profile of profiles) {
      const original = stored.find(row => row.id === profile.id);
      assert.equal(profile.startable, original.startable, "recommendation must not change current start permission");
      if (preferredProfileId && profile.extractionLimits.automaticPublication === "closed-scope-v1") {
        assert.equal(profile.recommended, profile.id === preferredProfileId);
      } else {
        assert.equal(Object.hasOwn(profile, "recommended"), false, "noneligible or unconfigured navigation must not expose payload.recommended");
      }
    }
  }
  assert.deepEqual((await db.query("SELECT id,payload,startable FROM f002_profile ORDER BY id")).rows, stored,
    "projection reads must never rewrite retained profile payloads, identities or startability");
});
