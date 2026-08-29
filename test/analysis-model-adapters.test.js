import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import test from "node:test";

import { AllowlistedCliModelAdapter, AnalysisModelConnectionError, AnalysisModelRegistry, OpenAICompatibleAnalysisModelAdapter, configuredAnalysisModels, probeCliOAuthStatus } from "../src/analysis/index.js";
import { issueScopedSecretGrants } from "../src/domain/index.js";

function cliSpawn(result, calls) {
  return (executable, args, options) => {
    calls.push({ executable, args, options });
    const child = new EventEmitter();
    child.pid = 99999999;
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => { child.killed = true; };
    queueMicrotask(() => {
      const resolved = typeof result === "function" ? result({ executable, args, options }) : result;
      if (resolved === null) return;
      if (resolved.stdout) child.stdout.write(resolved.stdout);
      if (resolved.stderr) child.stderr.write(resolved.stderr);
      child.stdout.end();
      child.stderr.end();
      child.emit("close", resolved.code ?? 0);
    });
    return child;
  };
}

function scopedModelContext(registry, profile, overrides = {}) {
  const context = {
    workspaceId: "W1",
    profileId: "EXECUTION-PROFILE-1",
    analysisRunId: "RUN-1",
    slotId: "MAIN",
    ...overrides,
  };
  const [grant] = issueScopedSecretGrants({
    id: context.profileId,
    workspaceId: context.workspaceId,
    mainAgent: { model: profile.currentRevisionId, skillNames: [], mcpNames: [] },
    childSlots: [],
    entries: [{ kind: "MODEL", logicalName: profile.currentRevisionId, credentialHandleIds: [profile.credentialHandleId] }],
  }, { analysisRunId: context.analysisRunId, expiresAt: "2099-01-01T00:00:00.000Z" });
  registry.registerIssuedSecretGrants([grant]);
  return {
    ...context,
    grant,
  };
}

test("allowlisted CLI models pass untrusted prompts as one argv value without a shell", async () => {
  const calls = [];
  const adapter = new AllowlistedCliModelAdapter({ id: "CLI-1", cliAdapter: "CODEX", model: "gpt", spawnImpl: cliSpawn({ stdout: '{}\n' }, calls) });
  const input = { statement: "$(touch /tmp/never) ; `uname` --danger" };
  assert.deepEqual(await adapter.planWorkspaceAnalysis(input), {});
  assert.equal(calls[0].executable, "codex");
  assert.equal(calls[0].options.shell, false);
  assert.equal(calls[0].args.at(-1), JSON.stringify({ task: "workspace-plan", input }));
  assert.equal(calls[0].args.filter((value) => value.includes("touch")).length, 1);
});

test("allowlisted CLI models reject executable path substitution", () => {
  assert.throws(() => new AllowlistedCliModelAdapter({
    id: "CLI-ESCAPE", cliAdapter: "CODEX", executablePath: "/tmp/not-allowlisted", spawnImpl: cliSpawn({ stdout: "{}" }, []),
  }), /must be the allowlisted executable codex/);
  assert.doesNotThrow(() => new AllowlistedCliModelAdapter({
    id: "CLI-EXACT", cliAdapter: "CODEX", executablePath: "codex", spawnImpl: cliSpawn({ stdout: "{}" }, []),
  }));
});

test("OAuth status recheck uses only an allowlisted read-only CLI command and never returns CLI output", async () => {
  const calls = [];
  const status = await probeCliOAuthStatus("CODEX", {
    spawnImpl: cliSpawn({ stdout: "Logged in using ChatGPT\n" }, calls),
  });

  assert.deepEqual(status, { oauthStatus: "AUTHENTICATED" });
  assert.deepEqual(calls[0].args, ["login", "status"]);
  assert.equal(calls[0].executable, "codex");
  assert.equal(calls[0].options.shell, false);
  assert.equal(JSON.stringify(status).includes("ChatGPT"), false);
});

test("OAuth status recheck interprets the supported CLI status envelopes without accepting API-key authentication", async () => {
  const cases = [
    { adapter: "CODEX", stdout: "Logged in using ChatGPT\n", expected: "AUTHENTICATED" },
    { adapter: "CODEX", stdout: "Logged in using API key\n", expected: "NOT_AUTHENTICATED" },
    { adapter: "CODEX", stdout: "Not logged in\n", expected: "NOT_AUTHENTICATED" },
    { adapter: "CLAUDE", stdout: '{"loggedIn":true,"authMethod":"claude.ai","apiProvider":"firstParty"}\n', expected: "AUTHENTICATED" },
    { adapter: "CLAUDE", stdout: '{"loggedIn":true,"authMethod":"apiKey","apiProvider":"firstParty"}\n', expected: "NOT_AUTHENTICATED" },
    { adapter: "CLAUDE", stdout: '{"loggedIn":false,"authMethod":"none","apiProvider":"firstParty"}\n', expected: "NOT_AUTHENTICATED" },
  ];
  for (const { adapter, stdout, expected } of cases) {
    const status = await probeCliOAuthStatus(adapter, { spawnImpl: cliSpawn({ stdout }, []) });
    assert.deepEqual(status, { oauthStatus: expected }, `${adapter} must classify its authoritative status output`);
  }
});

test("OAuth status recheck reports an absent CLI without attempting a login", async () => {
  const calls = [];
  const spawnImpl = (executable, args, options) => {
    calls.push({ executable, args, options });
    const child = new EventEmitter();
    child.pid = 99999999;
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => {};
    queueMicrotask(() => child.emit("error", Object.assign(new Error("not found"), { code: "ENOENT" })));
    return child;
  };

  for (const [adapter, executable, args] of [["CODEX", "codex", ["login", "status"]], ["CLAUDE", "claude", ["auth", "status"]]]) {
    const status = await probeCliOAuthStatus(adapter, { spawnImpl });
    assert.deepEqual(status, { oauthStatus: "CLI_UNAVAILABLE" });
    assert.equal(calls.at(-1).executable, executable);
    assert.deepEqual(calls.at(-1).args, args);
    assert.equal(calls.at(-1).options.shell, false);
  }
});

test("OAuth status recheck terminates a probe that does not close", async () => {
  const child = new EventEmitter();
  child.pid = 99999999;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = () => { child.killed = true; };

  const status = await probeCliOAuthStatus("CODEX", {
    spawnImpl: () => child,
    timeoutMs: 5,
  });

  assert.deepEqual(status, { oauthStatus: "UNKNOWN" });
  assert.equal(child.killed, true);
  child.emit("close", 0);
});

test("allowlisted CLI models enforce timeout and output bounds", async () => {
  const outputBounded = new AllowlistedCliModelAdapter({ id: "CLI-OUT", cliAdapter: "KIMI", maximumOutputBytes: 4, spawnImpl: cliSpawn({ stdout: "12345" }, []) });
  await assert.rejects(() => outputBounded.planWorkspaceAnalysis({}), /output limit/);
  const timed = new AllowlistedCliModelAdapter({ id: "CLI-TIME", cliAdapter: "GEMINI", timeoutMs: 5, spawnImpl: cliSpawn(null, []) });
  await assert.rejects(() => timed.verify(), /timed out/);
});

test("allowlisted CLI verification exercises authenticated model execution instead of only --version", async () => {
  const calls = [];
  const adapter = new AllowlistedCliModelAdapter({
    id: "CLI-VERIFY",
    cliAdapter: "CODEX",
    model: "gpt",
    spawnImpl: cliSpawn(({ args }) => {
      const request = JSON.parse(args.at(-1));
      return { stdout: `${JSON.stringify({ ready: true, challenge: request.input.challenge })}\n` };
    }, calls),
  });
  await adapter.verify();
  assert.notDeepEqual(calls[0].args, ["--version"]);
  assert.equal(calls[0].args.includes("gpt"), true);
  assert.match(calls[0].args.at(-1), /connection-verification/);

  const unauthenticated = new AllowlistedCliModelAdapter({
    id: "CLI-NOT-AUTHENTICATED",
    cliAdapter: "CODEX",
    spawnImpl: cliSpawn({ stdout: '{}\n' }, []),
  });
  await assert.rejects(() => unauthenticated.verify(), /verification challenge/);
});

test("account-bound CLI execution resolves an API-key reference only into the selected adapter environment", async () => {
  const calls = [];
  const adapter = new AllowlistedCliModelAdapter({
    id: "CLI-ACCOUNT-BOUND",
    cliAdapter: "CODEX",
    environmentResolver: async () => ({ OPENAI_API_KEY: "runtime-only-secret" }),
    spawnImpl: cliSpawn(({ args }) => {
      const request = JSON.parse(args.at(-1));
      return { stdout: `${JSON.stringify({ ready: true, challenge: request.input.challenge })}\n` };
    }, calls),
  });

  await adapter.verify();
  assert.equal(calls[0].options.env.OPENAI_API_KEY, "runtime-only-secret");
  assert.equal(JSON.stringify({ id: adapter.id, cliAdapter: adapter.cliAdapter }).includes("runtime-only-secret"), false);
});

test("account-bound OAuth CLI execution removes an ambient adapter API key", async () => {
  const calls = [];
  const previous = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "ambient-key-must-not-reach-oauth";
  try {
    const adapter = new AllowlistedCliModelAdapter({
      id: "CLI-OAUTH-ISOLATED",
      cliAdapter: "CODEX",
      environmentResolver: async () => ({ OPENAI_API_KEY: null }),
      spawnImpl: cliSpawn(({ args }) => {
        const request = JSON.parse(args.at(-1));
        return { stdout: `${JSON.stringify({ ready: true, challenge: request.input.challenge })}\n` };
      }, calls),
    });

    await adapter.verify();
    assert.equal(calls[0].options.env.OPENAI_API_KEY, undefined);
  } finally {
    if (previous === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previous;
  }
});

test("allowlisted CLI verification decodes each supported CLI's real JSON output envelope", async () => {
  const envelopes = {
    CODEX: (payload) => `${JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: payload } })}\n`,
    CLAUDE: (payload) => JSON.stringify({ type: "result", subtype: "success", result: payload }),
    GEMINI: (payload) => JSON.stringify({ response: payload, stats: {} }),
    KIMI: (payload) => payload,
  };
  for (const [cliAdapter, envelope] of Object.entries(envelopes)) {
    const adapter = new AllowlistedCliModelAdapter({
      id: `CLI-${cliAdapter}`,
      cliAdapter,
      spawnImpl: cliSpawn(({ args }) => {
        const request = JSON.parse(args.at(-1));
        const payload = JSON.stringify({ ready: true, challenge: request.input.challenge });
        return { stdout: envelope(payload) };
      }, []),
    });
    await adapter.verify();
  }
});

test("KIMI CLI uses its documented prompt flag instead of the unsupported print flag", async () => {
  const calls = [];
  const adapter = new AllowlistedCliModelAdapter({
    id: "CLI-KIMI",
    cliAdapter: "KIMI",
    model: "kimi-for-coding",
    spawnImpl: cliSpawn(({ args }) => {
      const promptIndex = args.indexOf("--prompt");
      const request = JSON.parse(promptIndex >= 0 ? args[promptIndex + 1] : args.at(-1));
      return { stdout: JSON.stringify({ ready: true, challenge: request.input.challenge }) };
    }, calls),
  });
  await adapter.verify();
  assert.equal(calls[0].args.includes("--print"), false);
  assert.equal(calls[0].args.includes("--prompt"), true);
  assert.deepEqual(calls[0].args.slice(0, 2), ["--model", "kimi-for-coding"]);
});

test("credentialed API model revisions require the matching scoped Run and Slot grant", async () => {
  const registry = new AnalysisModelRegistry({ fetchImpl: async () => Response.json({ choices: [{ message: { content: '{"ok":true}' } }] }) });
  const profile = registry.configure({ id: "SCOPED", endpoint: "https://models.example/v1", model: "scoped", apiKey: "secret" });
  await registry.verify("SCOPED");
  assert.match(profile.credentialHandleId, /^MODEL-CREDENTIAL-/);
  assert.notEqual(profile.credentialHandleId, "MODEL-CREDENTIAL-SCOPED", "a CredentialHandle must identify encrypted secret material, not be synthesized from the public profile id");
  assert.equal(registry.resolve(profile.currentRevisionId), null, "runtime cannot bypass a scoped grant");
  const context = scopedModelContext(registry, profile);
  assert.ok(registry.resolve(profile.currentRevisionId, context));
  assert.equal(registry.resolve(profile.currentRevisionId, { ...context, workspaceId: "W2" }), null);
  assert.equal(registry.resolve(profile.currentRevisionId, { ...context, grant: { ...context.grant, id: "FORGED-GRANT" } }), null,
    "runtime resolution must require the exact immutable grant minted by the scoped grant issuer");
});

test("analysis model registry rejects a grant forged solely from its public claims", async () => {
  const registry = new AnalysisModelRegistry({ fetchImpl: async () => Response.json({ choices: [{ message: { content: '{"ok":true}' } }] }) });
  const profile = registry.configure({ id: "FORGE", endpoint: "https://models.example/v1", model: "forge", apiKey: "secret" });
  await registry.verify("FORGE");
  const context = { workspaceId: "W1", profileId: "EXECUTION-PROFILE-1", analysisRunId: "RUN-1", slotId: "MAIN" };
  const [forged] = issueScopedSecretGrants({
    id: context.profileId,
    workspaceId: context.workspaceId,
    mainAgent: { model: profile.currentRevisionId, skillNames: [], mcpNames: [] },
    childSlots: [],
    entries: [{ kind: "MODEL", logicalName: profile.currentRevisionId, credentialHandleIds: [profile.credentialHandleId] }],
  }, { analysisRunId: context.analysisRunId, expiresAt: "2099-01-01T00:00:00.000Z" });
  assert.equal(
    registry.resolve(profile.currentRevisionId, { ...context, grant: forged }),
    null,
    "a grant that was never registered as server-issued must not resolve a credentialed model",
  );
});

test("runtime rejects legacy synthetic credential-handle aliases even when a grant is registered", async () => {
  const registry = new AnalysisModelRegistry({
    adapters: configuredAnalysisModels(JSON.stringify([{
      id: "private-model",
      endpoint: "https://models.example/v1",
      model: "private",
      apiKeyEnvironment: "PRIVATE_MODEL_KEY",
    }]), { PRIVATE_MODEL_KEY: "server-only-secret" }),
  });
  const profile = registry.list()[0];
  const context = {
    workspaceId: "W1",
    profileId: "PROFILE-1",
    analysisRunId: "RUN-1",
    slotId: "MAIN",
  };
  const legacyGrant = {
    id: "SERVER-ISSUED-LEGACY-ALIAS",
    ...context,
    capabilityKind: "MODEL",
    capabilityName: profile.currentRevisionId,
    credentialHandleId: "ENV-MODEL-CREDENTIAL-private-model",
    expiresAt: "2099-01-01T00:00:00.000Z",
  };
  registry.registerIssuedSecretGrants([legacyGrant]);
  assert.equal(
    registry.resolve(profile.currentRevisionId, { ...context, grant: legacyGrant }),
    null,
    "only the opaque CredentialHandle carried by the pinned execution profile may authorize a runtime model adapter",
  );
});

test("issued secret grants are revoked when their Run reaches a terminal lifecycle", async () => {
  const registry = new AnalysisModelRegistry({ fetchImpl: async () => Response.json({ choices: [{ message: { content: '{"ok":true}' } }] }) });
  const profile = registry.configure({ id: "REVOCABLE", endpoint: "https://models.example/v1", model: "revocable", apiKey: "secret" });
  await registry.verify("REVOCABLE");
  const context = scopedModelContext(registry, profile, { analysisRunId: "RUN-TERMINAL" });
  assert.ok(registry.resolve(profile.currentRevisionId, context));
  registry.revokeIssuedSecretGrants({ analysisRunId: "RUN-TERMINAL" });
  assert.equal(registry.resolve(profile.currentRevisionId, context), null);
});

test("model registry never lets caller-controlled revision ids overwrite pinned revisions", async () => {
  const registry = new AnalysisModelRegistry({ fetchImpl: async () => Response.json({ choices: [{ message: { content: '{"ok":true}' } }] }) });
  const first = registry.configure({ id: "M1", revisionId: "REV-SAME", endpoint: "https://models.example/v1", model: "one", apiKey: "secret" });
  await registry.verify("M1");
  const pinnedContext = scopedModelContext(registry, first);
  const pinned = registry.resolve(first.currentRevisionId, pinnedContext);
  const second = registry.configure({ id: "M1", revisionId: "REV-SAME", revision: 1, endpoint: "https://models.example/v1", model: "two", apiKey: "secret" });
  assert.notEqual(second.currentRevisionId, first.currentRevisionId);
  assert.equal(registry.resolve(first.currentRevisionId, pinnedContext), pinned);
  assert.equal(pinned.model, "one");
});

test("retiring profiles reject new direct analysis while pinned revision execution remains available", async () => {
  const registry = new AnalysisModelRegistry({ fetchImpl: async () => Response.json({ choices: [{ message: { content: '{"ok":true}' } }] }) });
  const profile = registry.configure({ id: "M1", endpoint: "https://models.example/v1", model: "one", apiKey: "secret" });
  await registry.verify("M1");
  const context = scopedModelContext(registry, profile);
  registry.remove("M1");
  await assert.rejects(() => registry.planWorkspaceAnalysis("M1", {}), /not active/);
  assert.ok(registry.resolve(profile.currentRevisionId, context));
  assert.equal(registry.remove("M1", { finalize: true }).lifecycle, "RETIRED");
  assert.ok(registry.resolve(profile.currentRevisionId, context), "retirement preserves the immutable pinned revision");
});

test("model replacement plans pin both model revisions before retiring the source", async () => {
  const registry = new AnalysisModelRegistry({ fetchImpl: async () => Response.json({ choices: [{ message: { content: '{"ok":true}' } }] }) });
  registry.configure({ id: "OLD", endpoint: "https://models.example/v1", model: "old", apiKey: "secret" });
  registry.configure({ id: "NEW", endpoint: "https://models.example/v1", model: "new", apiKey: "secret" });
  await registry.verify("OLD");
  await registry.verify("NEW");
  const plan = registry.createReplacementPlan({ sourceProfileId: "OLD", replacementProfileId: "NEW", references: [], changes: [] });
  assert.equal(plan.status, "READY");
  assert.equal(registry.beginReplacementPlan(plan, plan.version).status, "READY");
  assert.equal(registry.beginReplacementPlan(plan, plan.version).status, "READY", "a retry resumes an interrupted apply");
  const applied = { ...plan, status: "APPLIED", version: plan.version + 1 };
  assert.equal(registry.completeReplacementPlan(applied).status, "APPLIED");
  assert.equal(registry.beginReplacementPlan(applied, plan.version).status, "APPLIED", "a retry observes an already completed apply");
  assert.equal(registry.completeReplacementPlan(applied).status, "APPLIED");
  assert.equal(registry.list().find(({ id }) => id === "OLD").lifecycle, "RETIRING");
});

function workspaceCandidateEnvelope(overrides = {}) {
  const workUnit = {
    schemaVersion: "1.0.0",
    id: "WORK-UNIT-WORKSPACE-001",
    projectId: "PROJECT-WORKSPACE",
    snapshotManifestId: "SNAPSHOT-WORKSPACE-001",
    analysisRunId: "ANALYSIS-WORKSPACE-001",
    factIds: ["FACT-WORKSPACE-001", "FACT-WORKSPACE-002"],
    rootFactIds: ["FACT-WORKSPACE-001"],
  };
  return {
    workUnit,
    candidateBundle: {
      schemaVersion: "1.0.0",
      id: "CANDIDATE-BUNDLE-WORKSPACE-001",
      projectId: workUnit.projectId,
      snapshotManifestId: workUnit.snapshotManifestId,
      analysisRunId: workUnit.analysisRunId,
      workUnitId: workUnit.id,
      producedAt: "2026-07-25T10:00:00.000Z",
      candidates: [{
        id: "CANDIDATE-WORKSPACE-001",
        kind: "CANDIDATE_FEATURE",
        status: "PENDING_REVIEW",
        confidence: "LOW",
        confidenceCap: "HIGH",
        evidenceFactIds: ["FACT-WORKSPACE-001"],
        proposal: {
          name: "submitOrder",
          kind: "CODE_SYMBOL",
          method: null,
          modulePath: "src/orders",
          sourcePath: "src/orders/service.ts",
          description: "Discovered source capability.",
          code: "export function submitOrder() {}",
          evidence: {
            observations: [
              { extractor: "TYPESCRIPT_AST", basis: "exported function", sourcePath: "src/orders/service.ts", startLine: 1, excerpt: "export function submitOrder() {}" },
            ],
            corroborations: [],
            contradictions: [],
            diagnostics: [],
            completeness: "PARTIAL",
            confidenceCap: "HIGH",
          },
        },
        provenance: [{ producerType: "DETERMINISTIC", producerId: "TRAQEN_BROWSER_SCANNER", producerVersion: "4" }],
      }],
    },
    ...overrides,
  };
}

test("configured Analysis Agent models resolve secrets at call time without serializing them into input", async () => {
  const profiles = configuredAnalysisModels(JSON.stringify([{
    id: "private-model",
    endpoint: "https://models.example/v1/chat/completions",
    model: "semantic-source-model",
    apiKeyEnvironment: "PRIVATE_MODEL_KEY",
  }]), { PRIVATE_MODEL_KEY: "server-only-secret" });
  const adapter = profiles.get("private-model");
  let request;
  adapter.fetchImpl = async (_url, options) => {
    request = options;
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ candidateFeatures: [] }) } }] }), { status: 200, headers: { "content-type": "application/json" } });
  };
  const input = {
    workUnit: {
      schemaVersion: "1.0.0",
      id: "UNIT-1",
      projectId: "PROJECT-1",
      snapshotManifestId: "SNAPSHOT-1",
      analysisRunId: "RUN-1",
      factIds: ["FACT-1"],
      rootFactIds: ["FACT-1"],
    },
    workContext: { scopeKey: "orders", rootNodeId: "NODE-1", inputDigest: "DIGEST-1", estimatedTokens: 10 },
    deterministicCandidates: [],
    evidence: { nodes: [], edges: [] },
    context: { maxOutputTokens: 1_000 },
  };

  assert.deepEqual(await adapter.analyze(input), { candidateFeatures: [] });
  assert.equal(request.headers.authorization, "Bearer server-only-secret");
  assert.equal(JSON.stringify(input).includes("server-only-secret"), false);
  assert.equal(request.body.includes("server-only-secret"), false);
});

test("environment model CredentialHandles are opaque server-minted ids rather than profile-name derivatives", () => {
  const registry = new AnalysisModelRegistry({
    adapters: configuredAnalysisModels(JSON.stringify([{
      id: "private-model",
      endpoint: "https://models.example/v1/chat/completions",
      model: "semantic-source-model",
      apiKeyEnvironment: "PRIVATE_MODEL_KEY",
    }]), { PRIVATE_MODEL_KEY: "server-only-secret" }),
  });
  assert.match(registry.list()[0].credentialHandleId, /^ENV-MODEL-CREDENTIAL-[0-9a-f-]+$/i);
  assert.notEqual(registry.list()[0].credentialHandleId, "ENV-MODEL-CREDENTIAL-private-model");
});

test("Main model reconciliation returns its structured decisions instead of an accept-all projection", async () => {
  const expected = {
    candidateDecisions: [
      { candidateRef: "CHILD-A:0", disposition: "CONFLICT", rationale: "The claims disagree.", relatedCandidateRefs: ["CHILD-B:0"] },
      { candidateRef: "CHILD-B:0", disposition: "REJECT", rationale: "The evidence is weaker." },
    ],
    relations: [],
    gaps: [{ code: "SEMANTIC_CONFLICT", message: "Human review is required." }],
  };
  let request;
  const adapter = new OpenAICompatibleAnalysisModelAdapter({
    id: "main-model",
    endpoint: "https://models.example/v1/chat/completions",
    model: "main-reconciler",
    apiKeyResolver: () => "secret",
    fetchImpl: async (_url, options) => {
      request = JSON.parse(options.body);
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(expected) } }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });
  const output = await adapter.reconcile({
    workUnit: { id: "MAIN", projectId: "P", snapshotManifestId: "S", analysisRunId: "R", factIds: ["F"], rootFactIds: ["F"] },
    workContext: { scopeKey: "orders", rootNodeId: "F", inputDigest: "D", estimatedTokens: 10 },
    candidateOptions: [{ ref: "CHILD-A:0" }, { ref: "CHILD-B:0" }],
    contextCandidates: [],
    scopedArtifacts: [{ id: "A", relativePath: "src/orders.js" }],
    evidence: { facts: [{ id: "F" }], sourceSlices: [] },
    context: { maxOutputTokens: 1_000 },
  });
  assert.deepEqual(output, expected);
  assert.equal(request.messages[0].content.includes("ACCEPT, REJECT, CONFLICT, MERGE, or ALTERNATIVE"), true);
  assert.deepEqual(JSON.parse(request.messages[1].content).candidateOptions.map(({ ref }) => ref), ["CHILD-A:0", "CHILD-B:0"]);
});

test("Analysis Agent model endpoints require HTTPS except for loopback development", () => {
  assert.throws(() => new OpenAICompatibleAnalysisModelAdapter({ id: "unsafe", endpoint: "http://models.example/v1", model: "x" }), /must use HTTPS/);
  assert.doesNotThrow(() => new OpenAICompatibleAnalysisModelAdapter({ id: "local", endpoint: "http://127.0.0.1:11434/v1/chat/completions", model: "x" }));
});

test("stream profiles send stream true and merge OpenAI-compatible SSE deltas before validation", async () => {
  let request;
  const adapter = new OpenAICompatibleAnalysisModelAdapter({
    id: "stream-model",
    endpoint: "https://models.example/v1/chat/completions",
    model: "source-model",
    stream: true,
    apiKeyResolver: () => "secret",
    fetchImpl: async (_url, options) => {
      request = JSON.parse(options.body);
      const events = [
        `data: ${JSON.stringify({ choices: [{ delta: { content: "{\"ok\":" } }] })}`,
        `data: ${JSON.stringify({ choices: [{ delta: { content: "true}" } }] })}`,
        "data: [DONE]",
      ].join("\n\n");
      return new Response(events, { status: 200, headers: { "content-type": "text/event-stream" } });
    },
  });
  assert.equal((await adapter.verify()).ok, true);
  assert.equal(request.stream, true);
});

test("stream profiles accept Responses-style output_text delta events", async () => {
  const adapter = new OpenAICompatibleAnalysisModelAdapter({
    id: "responses-stream-model",
    endpoint: "https://models.example/v1/chat/completions",
    model: "source-model",
    stream: true,
    apiKeyResolver: () => "secret",
    fetchImpl: async () => new Response([
      `data: ${JSON.stringify({ type: "response.output_text.delta", delta: "{\"ok\":" })}`,
      `data: ${JSON.stringify({ type: "response.output_text.delta", delta: "true}" })}`,
      "data: [DONE]",
    ].join("\n\n"), { status: 200, headers: { "content-type": "text/event-stream" } }),
  });
  assert.equal((await adapter.verify()).ok, true);
});

test("stream profiles report output-token truncation instead of a generic incomplete JSON error", async () => {
  const adapter = new OpenAICompatibleAnalysisModelAdapter({
    id: "truncated-stream-model",
    endpoint: "https://models.example/v1/chat/completions",
    model: "source-model",
    stream: true,
    fetchImpl: async () => new Response([
      `data: ${JSON.stringify({ choices: [{ delta: { content: "{\"ok\":" } }] })}`,
      `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "length" }] })}`,
      "data: [DONE]",
    ].join("\n\n"), { status: 200, headers: { "content-type": "text/event-stream" } }),
  });
  await assert.rejects(() => adapter.verify(), /output was truncated \(length\)/);
});

test("Main Agent creates the configured evidence-bounded child assignments with a public streamed message", async () => {
  const telemetry = [];
  const plan = {
    agentMessage: "I will send one sealed batch to two independent Child slots and validate each result.",
    taskAssignments: [
      { agentId: "CHILD-1", objective: "Analyze the sealed batch independently", moduleScopes: ["orders", "billing", "api"] },
      { agentId: "CHILD-2", objective: "Analyze the sealed batch independently", moduleScopes: ["orders", "billing", "api"] },
    ],
  };
  const adapter = new OpenAICompatibleAnalysisModelAdapter({
    id: "main-agent-model",
    endpoint: "https://models.example/v1/chat/completions",
    model: "source-model",
    stream: true,
    fetchImpl: async () => new Response([
      `data: ${JSON.stringify({ choices: [{ delta: { content: JSON.stringify(plan) } }] })}`,
      `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })}`,
      "data: [DONE]",
    ].join("\n\n"), { status: 200, headers: { "content-type": "text/event-stream" } }),
  });
  const result = await adapter.planWorkspaceAnalysis({
    workspaceName: "Traqen",
    mode: "FULL",
    fileCount: 100,
    modules: [
      { name: "orders", fileCount: 10, sourceBytes: 12_000, languages: ["java"] },
      { name: "billing", fileCount: 10, sourceBytes: 16_000, languages: ["java", "xml"] },
      { name: "api", fileCount: 10, sourceBytes: 9_000, languages: ["ts"] },
    ],
  }, { onTelemetry: (event) => telemetry.push(event) });
  assert.equal(result.taskAssignments.length, 2);
  assert.equal(result.agentMessage, plan.agentMessage);
  assert.ok(telemetry.some((event) => event.type === "RESPONSE_PROGRESS" && event.assistantMessage === plan.agentMessage));
});

test("runtime model profiles keep API keys private, require verification, and enrich bounded Workspace candidates", async () => {
  const requests = [];
  const registry = new AnalysisModelRegistry({
    clock: () => new Date("2026-07-21T01:00:00.000Z"),
    fetchImpl: async (_url, options) => {
      requests.push(options);
      const input = JSON.parse(options.body);
      const verify = input.messages.at(-1).content.includes("exactly");
      const content = verify ? { ok: true } : {
        candidates: [{
          id: "CANDIDATE-WORKSPACE-001",
          displayName: "Submit order",
          description: "Submits an order through the discovered service method.",
          businessFeature: true,
          businessKey: "order.submit",
          businessModule: "Order management",
          businessSubmodule: "Order submission",
          domain: "Orders",
          group: "BUSINESS_CAPABILITY",
          confidence: "HIGH",
          rationale: "The method and source path identify an order submission capability.",
          evidenceFactIds: ["FACT-WORKSPACE-001"],
        }],
      };
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }] }), { status: 200 });
    },
  });

  const configured = registry.configure({
    id: "workspace-default",
    endpoint: "https://models.example/v1/chat/completions",
    model: "source-analysis-model",
    apiKey: "runtime-secret",
  });
  assert.equal(configured.ready, false);
  const firstRevisionId = configured.currentRevisionId;
  assert.equal(registry.resolve("workspace-default"), null);
  assert.equal(JSON.stringify(configured).includes("runtime-secret"), false);
  await assert.rejects(() => registry.enrichWorkspaceCandidates("workspace-default", workspaceCandidateEnvelope()), /must be verified/);

  const verified = await registry.verify("workspace-default");
  assert.equal(verified.ready, true);
  assert.equal(JSON.parse(requests[0].body).max_tokens, 512);
  const pinnedContext = scopedModelContext(registry, configured);
  assert.ok(registry.resolve("workspace-default", pinnedContext));
  const enriched = await registry.enrichWorkspaceCandidates("workspace-default", workspaceCandidateEnvelope());
  assert.equal(enriched.candidates[0].proposal.businessFeature, true);
  assert.equal(enriched.candidates[0].proposal.displayName, "Submit order");
  assert.deepEqual(enriched.candidates[0].evidenceFactIds, ["FACT-WORKSPACE-001"]);
  assert.equal(requests.every((request) => request.headers.authorization === "Bearer runtime-secret"), true);
  assert.equal(JSON.stringify(registry.list()).includes("runtime-secret"), false);

  const revised = registry.configure({
    id: "workspace-default",
    endpoint: "https://models-2.example/v1/chat/completions",
    model: "source-analysis-model-v2",
  });
  assert.notEqual(revised.currentRevisionId, firstRevisionId);
  assert.ok(registry.resolve(firstRevisionId, pinnedContext), "the verified pinned revision remains executable after editing the profile");
  assert.equal(registry.resolve("workspace-default"), null, "the new unverified revision does not inherit readiness");
  const retiring = registry.remove("workspace-default");
  assert.equal(retiring.lifecycle, "RETIRING");
  assert.ok(registry.resolve(firstRevisionId, pinnedContext), "retirement preserves an active Run's pinned historical revision");
});

test("Workspace model telemetry exposes the auditable request lifecycle and enforces evidence confidence caps", async () => {
  const telemetry = [];
  const adapter = new OpenAICompatibleAnalysisModelAdapter({
    id: "observable-model",
    endpoint: "https://models.example/v1/chat/completions",
    model: "source-model",
    stream: true,
    fetchImpl: async () => new Response([
      `data: ${JSON.stringify({ choices: [{ delta: { content: JSON.stringify({ candidates: [{ id: "CANDIDATE-WORKSPACE-001", displayName: "Candidate", description: "Observed candidate.", businessFeature: false, businessKey: "platform.runtime-support", businessModule: "Platform operations", businessSubmodule: "Runtime support", domain: "Technical", group: "PROJECT_OPERATION", confidence: "HIGH", rationale: "Single heuristic observation.", evidenceFactIds: ["FACT-WORKSPACE-001"] }] }) } }] })}`,
      "data: [DONE]",
    ].join("\n\n"), { status: 200, headers: { "content-type": "text/event-stream" } }),
  });
  const boundedInput = workspaceCandidateEnvelope();
  boundedInput.candidateBundle.candidates[0].confidenceCap = "LOW";
  boundedInput.candidateBundle.candidates[0].proposal.evidence.confidenceCap = "LOW";
  await assert.rejects(() => adapter.enrichWorkspaceCandidates(
    boundedInput,
    { onTelemetry: (event) => telemetry.push(event) },
  ), /invalid Workspace enrichment response/);
  assert.deepEqual(telemetry.slice(0, 3).map((event) => event.type), ["REQUEST_PREPARED", "HTTP_CONNECTED", "RESPONSE_PROGRESS"]);
  assert.ok(telemetry.some((event) => event.type === "STRUCTURED_RESPONSE_PARSED"));
  assert.ok(telemetry.some((event) => event.type === "OUTPUT_REJECTED"));
  assert.match(telemetry.find((event) => event.type === "RESPONSE_PROGRESS").outputPreview, /^\{"candidates"/);
  assert.equal(telemetry[0].promptPreview.includes("TYPESCRIPT_AST"), true);
  assert.equal(JSON.stringify(telemetry).includes("authorization"), false);
});

test("Workspace model output must cite Facts from its supplied WorkUnit", async () => {
  for (const evidenceFactIds of [undefined, ["FACT-OUTSIDE"]]) {
    const adapter = new OpenAICompatibleAnalysisModelAdapter({
      id: "bounded-model",
      endpoint: "https://models.example/v1/chat/completions",
      model: "source-model",
      fetchImpl: async () => new Response(JSON.stringify({
        choices: [{
          message: {
            content: JSON.stringify({
              candidates: [{
                id: "CANDIDATE-WORKSPACE-001",
                displayName: "Submit order",
                description: "Submits a customer order.",
                businessFeature: true,
                businessKey: "order.submit",
                businessModule: "Order management",
                businessSubmodule: "Order submission",
                domain: "Orders",
                group: "BUSINESS_CAPABILITY",
                confidence: "MEDIUM",
                rationale: "The bounded source Fact describes order submission.",
                ...(evidenceFactIds ? { evidenceFactIds } : {}),
              }],
            }),
          },
        }],
      }), { status: 200 }),
    });

    await assert.rejects(
      () => adapter.enrichWorkspaceCandidates(workspaceCandidateEnvelope()),
      /invalid Workspace enrichment response/,
    );
  }
});

test("model transport and structured output failures are reported as model availability errors", async () => {
  const failing = new OpenAICompatibleAnalysisModelAdapter({
    id: "failing-model",
    endpoint: "https://models.example/v1/chat/completions",
    model: "source-model",
    apiKeyResolver: () => "secret",
    fetchImpl: async () => new Response("upstream unavailable", { status: 503 }),
  });
  await assert.rejects(() => failing.verify(), AnalysisModelConnectionError);

  const malformed = new OpenAICompatibleAnalysisModelAdapter({
    id: "malformed-model",
    endpoint: "https://models.example/v1/chat/completions",
    model: "source-model",
    apiKeyResolver: () => "secret",
    fetchImpl: async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ ok: false }) } }] }), { status: 200 }),
  });
  await assert.rejects(() => malformed.verify(), AnalysisModelConnectionError);
});

test("model verification accepts compatible text arrays, reasoning prefixes, and Responses-style output text", async () => {
  const arrayContent = new OpenAICompatibleAnalysisModelAdapter({
    id: "array-content-model",
    endpoint: "https://models.example/v1/chat/completions",
    model: "source-model",
    apiKeyResolver: () => "secret",
    fetchImpl: async () => new Response(JSON.stringify({
      choices: [{ message: { content: [{ type: "output_text", text: { value: "<think>done</think>\n```json\n{\"ok\":true}\n```" } }] } }],
    }), { status: 200 }),
  });
  assert.equal((await arrayContent.verify()).ok, true);

  const responsesStyle = new OpenAICompatibleAnalysisModelAdapter({
    id: "responses-style-model",
    endpoint: "https://models.example/v1/chat/completions",
    model: "source-model",
    apiKeyResolver: () => "secret",
    fetchImpl: async () => new Response(JSON.stringify({ output_text: "Result: {\"ok\":true}" }), { status: 200 }),
  });
  assert.equal((await responsesStyle.verify()).ok, true);
});

test("invalid model structures report the unsupported response shape without echoing response content", async () => {
  const adapter = new OpenAICompatibleAnalysisModelAdapter({
    id: "unsupported-shape",
    endpoint: "https://models.example/v1/chat/completions",
    model: "source-model",
    apiKeyResolver: () => "secret",
    fetchImpl: async () => new Response(JSON.stringify({ result: { privateContent: "do-not-echo" } }), { status: 200 }),
  });
  await assert.rejects(
    () => adapter.verify(),
    (error) => error instanceof AnalysisModelConnectionError
      && /top-level fields: result/.test(error.message)
      && !error.message.includes("do-not-echo"),
  );
});
