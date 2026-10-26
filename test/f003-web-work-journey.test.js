import assert from "node:assert/strict";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { isolatedPostgres } from "./support/source-truth-postgres.js";
import { webAuthorityFixture } from "./support/f003-web-authority-fixture.js";
import { syntheticPassword } from "./support/f002-f003-server-fixture.js";
import { BusinessKnowledgeClient } from "../web/app/business-knowledge/client.ts";
import { setSessionProof, setReviewRole } from "../web/app/auth-client.ts";
import { syntheticQuestion } from "./support/f003-work-ui-model.js";
test(
  "Web work client follows real Cookie HTTP/native source, explicit sessions, derived QA, feedback, continuation, adoption and independent governance",
  { timeout: 180000 },
  async (t) => {
    const cluster = process.env.F001_TEST_PG_BIN ? await isolatedPostgres(t) : null;
    const f = await webAuthorityFixture(t, {
      database: cluster ? () => cluster.createDatabase() : undefined,
      workModelResponse: syntheticQuestion,
    });
    f.model.release();
    await f.runtime.knowledge.start();
    const deadline = new Date(Date.now() + 120000).toISOString();
    const input = {
      operationId: "work-ui-root",
      question: "synthetic fixed order context",
      reference: f.reference,
      expectedProfileId: f.profile.id,
      technicalVersionId: null,
      scope: { componentIds: [f.componentId] },
      budget: { maxReadBytes: 20000, maxModelCalls: 12, deadline },
      supplementBudget: {
        maxMaterials: 10,
        maxBytes: 20000,
        maxRuleApplications: 100,
        maximumAttempts: 2,
        deadline,
      },
    };
    const run = (await f.post("owner", `${f.base}/investigations`, input)).investigation;
    async function complete(id) {
      let latest;
      for (let i = 0; i < 300; i++) {
        latest = (await f.request("owner", `${f.base}/investigations/${id}`)).body.investigation;
        if (["COMPLETED", "FAILED"].includes(latest.state)) break;
        await delay(30);
      }
      assert.equal(latest.state, "COMPLETED", JSON.stringify(latest));
      return latest;
    }
    await complete(run.id);
    const publication = await f.publishMechanism(run.id),
      revision = publication.publication.graphRevisionId;
    let who = "owner";
    const calls = [];
    t.mock.method(globalThis, "fetch", async (url, init = {}) => {
      const path = new URL(url).pathname + new URL(url).search;
      calls.push({
        path,
        method: init.method,
        headers: init.headers,
        input: init.body ? JSON.parse(init.body) : null,
      });
      const result = await f.request(
        who,
        path,
        init.method ?? "GET",
        init.body ? JSON.parse(init.body) : undefined,
      );
      return new Response(JSON.stringify(result.body), {
        status: result.status,
        headers: { "content-type": "application/json" },
      });
    });
    setSessionProof("synthetic-client-proof");
    setReviewRole("business-owner");
    t.after(() => {
      setSessionProof("");
      setReviewRole("");
    });
    const client = new BusinessKnowledgeClient(f.runtime.origin, "workspace"),
      work = client.work();
    await assert.rejects(
      work.create(revision, {
        operationId: "blocked-work",
        expectedGraphDigest: publication.publication.graphDigest,
        title: "default must be blocked",
      }),
      (e) =>
        e.code === "F003_SESSION_WRITE_BLOCKED" &&
        e.missing.includes("F003_QUALITY_POLICY_UNCONFIRMED"),
    );
    // Actual trusted signature checks and admission stay active. Only owned test
    // quality/recovery/model ports are synthetic, never a browser unlock field.
    const admitted = await f.publishMechanism(run.id, { retainForWork: true }),
      rid = admitted.publication.graphRevisionId;
    const raw = await client.readPublished(rid),
      key = raw.graph.candidates[0].key;
    const admin = await f.runtime.identity.login({ login: "admin", password: syntheticPassword });
    await f.runtime.identity.grant(admin.token, "workspace", {
      accountId: f.accounts.reader.id,
      roles: ["READ"],
    });
    who = "reader";
    const beforeRead = calls.length;
    assert.equal((await client.readPublished(rid)).publication.graphRevisionId, rid);
    await client.currentPublication();
    await client.publishedVersions();
    assert.ok(calls.slice(beforeRead).every((c) => !c.path.includes("/investigations")));
    assert.equal(
      (await f.request("reader", `${f.base}/investigations/${run.id}`)).status,
      403,
      "published read never silently delegates the private investigation",
    );
    who = "owner";
    const create = {
      operationId: "one-work-session",
      expectedGraphDigest: raw.graph.digest,
      title: "exact published work session",
    };
    const saved = await work.create(rid, create),
      sid = saved.session.id;
    assert.equal((await work.create(rid, create)).session.id, sid);
    const beforeAsk = f.model.calls.length,
      questionInput = {
        operationId: "one-question",
        expectedSessionVersion: 1,
        expectedProfileId: f.profile.id,
        question: "What is unknown?",
        objectKeys: [key],
        budget: { maxReadBytes: 8192, maxModelCalls: 5, deadline },
      };
    const queued = await work.ask(sid, questionInput);
    assert.equal(queued.answer, null);
    let q;
    for (let i = 0; i < 300; i++) {
      q = await work.question(sid, queued.request.id);
      if (["COMPLETED", "FAILED"].includes(q.run.state)) break;
      await delay(30);
    }
    assert.equal(q.run.state, "COMPLETED", JSON.stringify(q.run));
    assert.equal(q.answer.authority, "DERIVED_ANALYSIS_NOT_BUSINESS_AUTHORITY");
    assert.ok(q.answer.segments.every((s) => s.stance === "UNKNOWN"));
    const charged = q.run.usage.modelCalls,
      modelCalls = f.model.calls.length;
    assert.ok(modelCalls > beforeAsk);
    for (let i = 0; i < 3; i++)
      assert.equal((await work.question(sid, q.request.id)).run.usage.modelCalls, charged);
    assert.equal(
      f.model.calls.length,
      modelCalls,
      "offline reads never POST a question or re-run models",
    );
    let session = (await work.session(sid)).session;
    await work.feedback(sid, {
      operationId: "one-feedback",
      expectedSessionVersion: session.version,
      graphDigest: raw.graph.digest,
      objectKey: key,
      answerId: q.answer.id,
      kind: "CORRECTION",
      message: "explicit correction, never approval",
    });
    session = (await work.session(sid)).session;
    const next = {
        reference: f.reference,
        scope: { componentIds: [f.componentId] },
        technicalVersionId: null,
      },
      changes = await work.preview(sid, next);
    const continued = await work.continue(sid, {
      ...next,
      operationId: "one-continuation",
      expectedSessionVersion: session.version,
      expectedChangeSetDigest: changes.changeSetDigest,
      expectedProfileId: f.profile.id,
      question: "new explicit investigation",
      budget: input.budget,
      supplementBudget: input.supplementBudget,
    });
    assert.equal(continued.session.binding.graphRevisionId, null);
    assert.notEqual(continued.session.id, sid);
    await complete(continued.run.id);
    const publishedNext = await f.publishMechanism(continued.run.id, { retainForWork: true });
    await work.adopt(continued.session.id, {
      operationId: "one-adoption",
      expectedSessionVersion: 1,
      graphRevisionId: publishedNext.publication.graphRevisionId,
      expectedGraphDigest: publishedNext.publication.graphDigest,
      adoptedVersionIds: [],
    });
    assert.equal(
      (await work.session(continued.session.id)).session.binding.graphRevisionId,
      publishedNext.publication.graphRevisionId,
    );
    assert.equal((await work.session(sid)).session.binding.graphRevisionId, rid);
    assert.equal((await work.question(sid, q.request.id)).answer.id, q.answer.id);
    const governance = client.governance();
    await governance.feature({
      id: "web-human-feature",
      version: 1,
      name: "Explicit single object",
    });
    await governance.scope({
      id: "web-human-scope",
      version: 1,
      scope: { description: "one fixed rule" },
    });
    await governance.claim({
      id: "web-human-claim",
      version: 1,
      featureId: "web-human-feature",
      type: "NORMATIVE_REQUIREMENT",
      statement: "single human proposed rule",
      sourceType: "HUMAN",
      evidenceSupport: "INCOMPLETE",
      scopeId: "web-human-scope",
      scopeVersion: 1,
    });
    const baseline = await governance.baseline("web-human-feature");
    assert.equal(baseline.claims[0].claim.id, "web-human-claim");
    const caseInput = {
      id: "web-human-case",
      claimId: "web-human-claim",
      claimVersion: 1,
      scopeId: "web-human-scope",
      scopeVersion: 1,
      risk: "LOW",
      approvalMode: "SINGLE",
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
      proposedDecision: {
        id: "web-human-decision",
        type: "CONFIRMED",
        content: "explicit scoped proposal",
        evidenceRefs: [`F003:${rid}:${key}`],
        validUntil: null,
      },
    };
    await governance.propose(caseInput);
    await assert.rejects(
      governance.event(caseInput.id, {
        id: "self-approve",
        action: "APPROVE",
        rationale: "must not accept proposer self approval",
      }),
    );
    await f.runtime.identity.grant(admin.token, "workspace", {
      accountId: f.accounts.reader.id,
      roles: ["READ", "business-owner"],
    });
    who = "reader";
    const reviewed = await governance.event(caseInput.id, {
      id: "independent-approve",
      action: "APPROVE",
      rationale: "independent account explicit approval",
    });
    assert.ok(reviewed.events.some((e) => e.actorId === "reader"));
    who = "owner";
    assert.equal(
      (
        await client.authorityBindings(rid, key, {
          graphDigest: raw.graph.digest,
          sourceBundleId: raw.graph.sourceBundleId,
        })
      ).bindingSet,
      null,
      "human review does not auto-map any graph",
    );
    assert.ok(
      calls
        .filter((c) => c.method === "POST")
        .every(
          (c) =>
            new Headers(c.headers).has("x-traqen-csrf") &&
            !new Headers(c.headers).has("authorization"),
        ),
    );
    await f.revoke();
    await assert.rejects(work.session(sid), (e) => e.status === 403);
    console.log(
      JSON.stringify({
        scope: "REAL_F008_NATIVE_HTTP_WORK_CLIENT_SYNTHETIC_MODEL_QUALITY_RECOVERY_ONLY",
        questions: 1,
        feedback: 1,
        continuations: 1,
        adoptions: 1,
        independentHumanCase: 1,
        modelQuality: false,
        protectedMedia: false,
      }),
    );
  },
);
