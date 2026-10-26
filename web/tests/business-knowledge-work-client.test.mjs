import assert from "node:assert/strict";
import test from "node:test";
import { BusinessKnowledgeClient } from "../app/business-knowledge/client.ts";
import { setSessionProof } from "../app/auth-client.ts";
const ws = "workspace",
  revision = "revision-one",
  digest = "a".repeat(64),
  source = "b".repeat(64);
const binding = {
  graphRevisionId: revision,
  graphDigest: digest,
  sourceInput: { sourceBundleSnapshotId: source, receiptId: "receipt" },
  adoptedVersionIds: [],
};
const session = {
  id: "session",
  workspaceId: ws,
  actorId: "owner",
  operationId: "same-operation",
  title: "saved context",
  version: 2,
  binding,
  events: [],
  eventsTruncated: false,
};
const envelope = (body) =>
  new Response(JSON.stringify({ schemaVersion: 1, workspaceId: ws, ...body }), {
    headers: { "content-type": "application/json" },
  });
test("work reads preserve explicit session, page cursors and event versions without any POST", async (t) => {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, init) => {
    calls.push({ url, init });
    return envelope(
      url.includes("/events?")
        ? { sessionId: "session", events: [], currentVersion: 2, nextAfterVersion: null }
        : { session, records: [], recordsTruncated: true, nextCursor: "next-page" },
    );
  });
  const work = new BusinessKnowledgeClient("https://example.test", ws).work();
  assert.equal((await work.session("session", "old-page")).nextCursor, "next-page");
  await work.events("session", 1);
  assert.equal(new URL(calls[0].url).searchParams.get("cursor"), "old-page");
  assert.equal(new URL(calls[1].url).searchParams.get("afterVersion"), "1");
  assert.ok(calls.every((c) => c.init.method === "GET"));
});
test("received SESSION_WRITE_BLOCKED exposes only safe missing codes through the single bounded body consumer", async (t) => {
  t.mock.method(
    globalThis,
    "fetch",
    async () =>
      new Response(
        JSON.stringify({
          error: {
            code: "F003_SESSION_WRITE_BLOCKED",
            message: "blocked",
            details: {
              missing: [
                { code: "F003_QUALITY_POLICY_UNCONFIRMED", path: "/private/hidden" },
                "unsafe text",
                { code: "F003_RECOVERY_EVIDENCE_MISSING" },
              ],
              stderr: "secret",
            },
          },
        }),
        { status: 409, headers: { "content-type": "application/json" } },
      ),
  );
  await assert.rejects(
    new BusinessKnowledgeClient("https://example.test", ws)
      .work()
      .create(revision, {
        operationId: "operation",
        expectedGraphDigest: digest,
        title: "explicit",
      }),
    (e) => {
      assert.deepEqual(e.missing, [
        "F003_QUALITY_POLICY_UNCONFIRMED",
        "F003_RECOVERY_EVIDENCE_MISSING",
      ]);
      assert.ok(!JSON.stringify(e).includes("/private/hidden"));
      return e.status === 409;
    },
  );
});
test("wrong-session, wrong-source and contradictory paginated results are refused without selecting latest", async (t) => {
  const work = new BusinessKnowledgeClient("https://example.test", ws).work();
  for (const patch of [
    { session: { ...session, id: "other" } },
    { session: { ...session, workspaceId: "other" } },
    { recordsTruncated: false, nextCursor: "still-more" },
    { session: { ...session, binding: { ...binding, graphDigest: null } } },
  ]) {
    t.mock.method(globalThis, "fetch", async () =>
      envelope({ session, records: [], recordsTruncated: false, nextCursor: null, ...patch }),
    );
    await assert.rejects(work.session("session"), { code: "F003_RESPONSE_INVALID" });
  }
});
test("questions pin the whole admitted binding and derived answer; response swaps and fabricated authority fail", async (t) => {
  const work = new BusinessKnowledgeClient("https://example.test", ws).work(),
    qb = { ...binding, sessionId: "session", objectKeys: ["rule"] };
  const request = {
    id: "question",
    workspaceId: ws,
    sessionId: "session",
    operationId: "op",
    requestDigest: digest,
    question: "why",
    binding: qb,
    profileId: "profile",
    budget: { maxReadBytes: 8192, maxModelCalls: 5, deadline: "2099-01-01T00:00:00Z" },
  };
  const run = {
    id: "question",
    workspaceId: ws,
    purpose: "GRAPH_QUESTION",
    questionContext: qb,
    profile: { id: "profile" },
    sourceInput: binding.sourceInput,
    adoptedVersionIds: [],
    revision: 1,
    generation: 0,
    state: "QUEUED",
    budget: request.budget,
    usage: { modelCalls: 0 },
  };
  const valid = { request, run, answer: null };
  t.mock.method(globalThis, "fetch", async () => envelope(valid));
  assert.equal((await work.question("session", "question")).answer, null);
  for (const body of [
    { ...valid, request: { ...request, sessionId: "other" } },
    { ...valid, run: { ...run, generation: -1 } },
    { ...valid, run: { ...run, questionContext: { ...qb, graphDigest: "c".repeat(64) } } },
    { ...valid, run: { ...run, sourceInput: { ...run.sourceInput, receiptId: "foreign" } } },
    { ...valid, answer: { id: "answer", authority: "HUMAN_CONFIRMED" } },
  ]) {
    t.mock.method(globalThis, "fetch", async () => envelope(body));
    await assert.rejects(work.question("session", "question"), { code: "F003_RESPONSE_INVALID" });
  }
});
test("work creation sends one original operation and CSRF, no bearer, local quality or automatic retry", async (t) => {
  const calls = [];
  setSessionProof("csrf");
  t.after(() => setSessionProof(""));
  t.mock.method(globalThis, "fetch", async (url, init) => {
    calls.push({ url, init });
    return envelope({ session: { ...session, version: 1 }, replayed: false });
  });
  const work = new BusinessKnowledgeClient("https://example.test", ws).work(),
    input = { operationId: "same-operation", expectedGraphDigest: digest, title: "explicit" };
  await work.create(revision, input);
  assert.deepEqual(JSON.parse(calls[0].init.body), input);
  assert.equal(new Headers(calls[0].init.headers).get("x-traqen-csrf"), "csrf");
  assert.equal(new Headers(calls[0].init.headers).has("authorization"), false);
  t.mock.method(globalThis, "fetch", async () =>
    envelope({ session: { ...session, operationId: "foreign-operation" }, replayed: false }),
  );
  await assert.rejects(work.create(revision, input), { code: "F003_RESPONSE_INVALID" });
  t.mock.method(globalThis, "fetch", async () => {
    calls.push("lost");
    throw Error("lost");
  });
  await assert.rejects(work.create(revision, input));
  assert.equal(calls.filter((c) => c === "lost").length, 1);
});
test("a new question cannot accept a different admitted graph and adoption must acknowledge the original operation", async (t) => {
  const work = new BusinessKnowledgeClient("https://example.test", ws).work(),
    qb = { ...binding, sessionId: "session", objectKeys: ["rule"] };
  const input = {
    operationId: "op",
    expectedSessionVersion: 2,
    expectedProfileId: "profile",
    question: "why",
    objectKeys: ["rule"],
    budget: { maxReadBytes: 8192, maxModelCalls: 5, deadline: "2099-01-01T00:00:00Z" },
  };
  const request = {
    id: "question",
    workspaceId: ws,
    sessionId: "session",
    operationId: "op",
    requestDigest: digest,
    question: "why",
    binding: qb,
    profileId: "profile",
    budget: input.budget,
  };
  const run = {
    id: "question",
    workspaceId: ws,
    purpose: "GRAPH_QUESTION",
    questionContext: qb,
    profile: { id: "profile" },
    sourceInput: binding.sourceInput,
    adoptedVersionIds: [],
    revision: 1,
    generation: 0,
    state: "QUEUED",
    budget: request.budget,
    usage: { modelCalls: 0 },
  };
  t.mock.method(globalThis, "fetch", async () =>
    envelope({ request, run, answer: null, replayed: false }),
  );
  await assert.rejects(
    work.ask("session", input, { ...binding, graphRevisionId: "another-revision" }),
    { code: "F003_RESPONSE_INVALID" },
  );
  assert.equal((await work.ask("session", input, binding)).request.id, "question");
  const adopt = {
    operationId: "adopt-op",
    expectedSessionVersion: 2,
    graphRevisionId: revision,
    expectedGraphDigest: digest,
    adoptedVersionIds: [],
  };
  const event = {
    id: "event",
    workspaceId: ws,
    sessionId: "session",
    version: 3,
    type: "GRAPH_EXPLICITLY_ADOPTED",
    operationId: "foreign-op",
    binding,
  };
  t.mock.method(globalThis, "fetch", async () => envelope({ event, replayed: false }));
  await assert.rejects(work.adopt("session", adopt), { code: "F003_RESPONSE_INVALID" });
  t.mock.method(globalThis, "fetch", async () =>
    envelope({ event: { ...event, operationId: "adopt-op" }, replayed: false }),
  );
  assert.equal((await work.adopt("session", adopt)).event.id, "event");
});
