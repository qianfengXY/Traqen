// Owned, expiring acceptance entry. Nothing here is deployment configuration.
// Reasoning, quality and recovery are explicit test doubles, never real proofs.
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { isolatedPostgres } from "./source-truth-postgres.js";
import { webAuthorityFixture } from "./f003-web-authority-fixture.js";
import { syntheticQuestion } from "./f003-work-ui-model.js";
import { syntheticPassword } from "./f002-f003-server-fixture.js";
const port = Number(process.argv[2] ?? 6287),
  mechanism = process.argv[3] === "--mechanism-work";
if (
  !Number.isSafeInteger(port) ||
  port < 1024 ||
  port > 65535 ||
  [3003, 3004, 3100, 3188, 6398, 6399].includes(port) ||
  process.argv.length > 4
)
  throw Error("Choose an owned unreserved port and optional --mechanism-work");
const root = fileURLToPath(new URL("../../", import.meta.url)),
  origin = `http://127.0.0.1:${port}`,
  callbacks = [],
  t = { after: (cb) => callbacks.push(cb) };
const environment = Object.fromEntries(
  ["PATH", "HOME", "TMPDIR", "LANG", "LC_ALL", "LC_CTYPE", "SHELL"].flatMap((k) =>
    process.env[k] === undefined ? [] : [[k, process.env[k]]],
  ),
);
let front,
  stopping = false,
  ready = false,
  requested = false;
async function close() {
  if (stopping) return;
  stopping = true;
  clearTimeout(expiry);
  if (front && front.exitCode === null) {
    front.kill("SIGTERM");
    await Promise.race([new Promise((r) => front.once("exit", r)), delay(3000)]);
    if (front.exitCode === null) front.kill("SIGKILL");
  }
  for (const cb of callbacks.reverse()) await cb();
}
function stop() {
  requested = true;
  if (ready)
    void close().catch((e) => {
      console.error(e.message);
      process.exitCode = 1;
    });
}
for (const s of ["SIGINT", "SIGTERM"]) process.once(s, stop);
const expiry = setTimeout(stop, 7200000);
try {
  const cluster = await isolatedPostgres(t),
    f = await webAuthorityFixture(t, {
      database: () => cluster.createDatabase(),
      webOrigin: origin,
      workModelResponse: syntheticQuestion,
    });
  f.model.release();
  await f.runtime.knowledge.start();
  const deadline = new Date(Date.now() + 600000).toISOString(),
    run = (
      await f.post("owner", `${f.base}/investigations`, {
        operationId: "isolated-work-preview",
        question: "合成机制：固定订单状态依据（不是实际业务质量）",
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
      })
    ).investigation;
  let state;
  for (let i = 0; i < 300; i++) {
    if (requested) throw Error("Stopped during owned startup");
    state = (await f.request("owner", `${f.base}/investigations/${run.id}`)).body.investigation;
    if (["COMPLETED", "FAILED"].includes(state.state)) break;
    await delay(50);
  }
  if (state.state !== "COMPLETED") throw Error("Owned seed investigation failed");
  const pubs = f.business.publications,
    original = {
      authority: pubs.authority,
      qualityPolicy: pubs.qualityPolicy,
      backup: pubs.backup,
      implementationResolver: pubs.implementationResolver,
    };
  const published = await f.publishMechanism(run.id, { retainForWork: true }),
    revision = published.publication.graphRevisionId;
  const session = (
    await f.post("owner", `${f.base}/versions/${revision}/work-sessions`, {
      operationId: "isolated-work-session",
      expectedGraphDigest: published.publication.graphDigest,
      title: "合成工作会话 · 派生答案非业务权威",
    })
  ).session;
  const q = (
    await f.post("owner", `${f.base}/work-sessions/${session.id}/questions`, {
      operationId: "isolated-work-question",
      expectedSessionVersion: 1,
      expectedProfileId: f.profile.id,
      question: "固定版本还有哪些未知？",
      objectKeys: null,
      budget: { maxReadBytes: 16384, maxModelCalls: 5, deadline },
    })
  ).request;
  let answer;
  for (let i = 0; i < 300; i++) {
    answer = (await f.request("owner", `${f.base}/work-sessions/${session.id}/questions/${q.id}`))
      .body;
    if (["COMPLETED", "FAILED"].includes(answer.run.state)) break;
    await delay(50);
  }
  if (answer.run.state !== "COMPLETED") throw Error("Owned seed question failed");
  if (!mechanism) Object.assign(pubs, original);
  const admin = await f.runtime.identity.login({ login: "admin", password: syntheticPassword });
  await f.runtime.identity.grant(admin.token, "workspace", {
    accountId: f.accounts.reader.id,
    roles: ["READ"],
  });
  if (requested) throw Error("Stopped during owned startup");
  front = spawn(
    process.execPath,
    [
      fileURLToPath(new URL("../../web/node_modules/vinext/dist/cli.js", import.meta.url)),
      "dev",
      "--hostname",
      "127.0.0.1",
      "--port",
      String(port),
    ],
    {
      cwd: root + "web",
      env: {
        ...environment,
        TRAQEN_API_PROXY_TARGET: f.runtime.origin,
        NEXT_PUBLIC_TRAQEN_API_BASE: "/api",
      },
      stdio: ["ignore", "inherit", "inherit"],
    },
  );
  front.once("error", (e) => {
    console.error(e.message);
    process.exitCode = 1;
    void close();
  });
  front.once("exit", () => {
    if (!stopping) {
      process.exitCode = 1;
      void close();
    }
  });
  ready = true;
  console.log(
    JSON.stringify({
      scope: "SYNTHETIC_MECHANISMS_ONLY_NOT_REAL_MODEL_QUALITY_RECOVERY_OR_PRODUCTION",
      origin,
      mechanismWritePorts: mechanism,
      defaultWritesBlocked: !mechanism,
      credentials: { owner: "owner", readOnly: "reader", password: syntheticPassword },
      graphRevisionId: revision,
      sessionId: session.id,
      questionId: q.id,
      expiresInSeconds: 7200,
      instructions:
        "Login, select Workspace, open 业务图谱 → 已发布知识 or 工作会话与问答. Reopen exact session/question IDs; GET does not call a model. Default new writes remain blocked. Only this CLI test fixture optional --mechanism-work retains synthetic server-only admission ports for mechanical author acceptance; no HTTP or browser unlock exists. Reader can discover published knowledge without private investigation delegation.",
    }),
  );
} catch (e) {
  await close();
  throw e;
}
