import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createServer } from "node:net";
import { isolatedPostgres } from "./source-truth-postgres.js";
import { webAuthorityFixture } from "./f003-web-authority-fixture.js";
import { syntheticQuestion } from "./f003-work-ui-model.js";
import { syntheticPassword } from "./f002-f003-server-fixture.js";
const [modulePath, executablePath] = process.argv.slice(2);
assert.ok(path.isAbsolute(modulePath ?? "") && path.isAbsolute(executablePath ?? ""));
const root = fileURLToPath(new URL("../../", import.meta.url)),
  directory = await mkdtemp(path.join(tmpdir(), "traqen-f003-work-browser-"));
const environment = Object.fromEntries(
  ["PATH", "HOME", "TMPDIR", "LANG", "LC_ALL", "LC_CTYPE", "SHELL"].flatMap((k) =>
    process.env[k] === undefined ? [] : [[k, process.env[k]]],
  ),
);
const probe = createServer();
await new Promise((r) => probe.listen(0, "127.0.0.1", r));
const port = probe.address().port;
await new Promise((r) => probe.close(r));
const web = `http://127.0.0.1:${port}`,
  cleanups = [],
  t = { after: (cb) => cleanups.push(cb) },
  logs = [];
const report = {
  scope: "REAL_COOKIE_NATIVE_HTTP_WEB_SYNTHETIC_REASONING_QUALITY_RECOVERY_ONLY",
  status: "RUNNING",
  checks: [],
  errors: [],
  writes: [],
  screenshots: [],
};
let fixture, front, browser, page;
const timer = setTimeout(() => {
  report.errors.push("Bounded browser deadline");
  front?.kill("SIGTERM");
  void browser?.close();
}, 360000);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = async (name) => {
  await page.screenshot({ path: path.join(directory, name), fullPage: true });
  report.screenshots.push(name);
};
function responseWhen(p, predicate) {
  const promise = p.waitForResponse(predicate);
  void promise.catch(() => {});
  return promise;
}
// Capture the unmodified actual HTTP body before a newer page releases the
// browser protocol's response resource. This neither resends nor fabricates it.
async function observePost(pattern) {
  let resolve, reject;
  const received = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  void received.catch(() => {});
  await page.route(pattern, async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    try {
      const response = await route.fetch(),
        status = response.status(),
        body = await response.json();
      await route.fulfill({ response });
      resolve({ status, body });
    } catch (error) {
      reject(error);
      await route.abort().catch(() => {});
    } finally {
      await page.unroute(pattern);
    }
  });
  return { received };
}
async function complete(id) {
  let r;
  for (let i = 0; i < 300; i++) {
    r = (await fixture.request("owner", `${fixture.base}/investigations/${id}`)).body.investigation;
    if (["COMPLETED", "FAILED"].includes(r.state)) break;
    await sleep(40);
  }
  assert.equal(r.state, "COMPLETED", JSON.stringify(r));
}
async function login(p, name) {
  await p.goto(web);
  await p.getByLabel("账号", { exact: true }).fill(name);
  await p.getByLabel("密码", { exact: true }).fill(syntheticPassword);
  await p.getByRole("button", { name: "登录", exact: true }).click();
  await p.getByLabel("切换工作区", { exact: true }).selectOption("workspace");
  await p
    .getByRole("navigation", { name: "主导航", exact: true })
    .getByRole("link", { name: "业务图谱", exact: true })
    .click();
}
async function visit(p, values) {
  const u = new URL(p.url());
  for (const k of [
    "runId",
    "view",
    "objectId",
    "revision",
    "knowledge",
    "sessionId",
    "questionId",
    "publishedRevision",
    "publishedObject",
  ])
    u.searchParams.delete(k);
  for (const [k, v] of Object.entries(values)) u.searchParams.set(k, v);
  await p.goto(u.href);
}
async function heldPost(pattern) {
  let release, admit;
  const gate = new Promise((r) => (release = r)),
    accepted = new Promise((r) => (admit = r));
  await page.route(pattern, async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    const response = await route.fetch();
    assert.equal(response.status(), 201, await response.text());
    admit(await response.json());
    await gate;
    await route.fulfill({ response }).catch(() => {});
  });
  return {
    accepted,
    release: async () => {
      release();
      await page.unroute(pattern);
    },
  };
}
async function heldRead(pattern, fail = false) {
  let release, admit;
  const gate = new Promise((r) => (release = r)),
    received = new Promise((r) => (admit = r));
  await page.route(pattern, async (route) => {
    const response = await route.fetch();
    assert.equal(response.status(), 200);
    admit();
    await gate;
    await route
      .fulfill(
        fail
          ? {
              status: 503,
              contentType: "application/json",
              body: JSON.stringify({
                error: {
                  code: "F003_CONTROLLED_READ_FAILURE",
                  message: "controlled delayed read failure",
                },
              }),
            }
          : { response },
      )
      .catch(() => {});
  });
  return {
    received,
    release: async () => {
      release();
      await page.unroute(pattern);
    },
  };
}
try {
  const cluster = await isolatedPostgres(t);
  fixture = await webAuthorityFixture(t, {
    database: () => cluster.createDatabase(),
    webOrigin: web,
    workModelResponse: syntheticQuestion,
  });
  fixture.model.release();
  await fixture.runtime.knowledge.start();
  const deadline = new Date(Date.now() + 600000).toISOString(),
    start = {
      operationId: "work-browser-root",
      question: "Synthetic browser source",
      reference: fixture.reference,
      expectedProfileId: fixture.profile.id,
      technicalVersionId: null,
      scope: { componentIds: [fixture.componentId] },
      budget: { maxReadBytes: 20000, maxModelCalls: 12, deadline },
      supplementBudget: {
        maxMaterials: 10,
        maxBytes: 20000,
        maxRuleApplications: 100,
        maximumAttempts: 2,
        deadline,
      },
    };
  const run = (await fixture.post("owner", `${fixture.base}/investigations`, start)).investigation;
  await complete(run.id);
  const blocked = await fixture.publishMechanism(run.id);
  front = spawn(
    process.execPath,
    [
      path.join(root, "web/node_modules/vinext/dist/cli.js"),
      "dev",
      "--hostname",
      "127.0.0.1",
      "--port",
      String(port),
    ],
    {
      cwd: path.join(root, "web"),
      env: {
        ...environment,
        TRAQEN_API_PROXY_TARGET: fixture.runtime.origin,
        NEXT_PUBLIC_TRAQEN_API_BASE: "/api",
        WRANGLER_LOG_PATH: path.join(directory, "wrangler.log"),
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  front.stdout.on("data", (b) => logs.push(b.toString()));
  front.stderr.on("data", (b) => logs.push(b.toString()));
  const started = Date.now();
  while (true) {
    try {
      if ((await fetch(web, { signal: AbortSignal.timeout(1000) })).ok) break;
    } catch {}
    assert.ok(front.exitCode === null && Date.now() - started < 45000);
    await sleep(100);
  }
  const { chromium } = await import(pathToFileURL(modulePath).href);
  browser = await chromium.launch({ executablePath, headless: true, env: environment });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  page = await context.newPage();
  page.setDefaultTimeout(25000);
  page.on("pageerror", (e) => report.errors.push(e.message));
  page.on("request", (r) => {
    const p = new URL(r.url()).pathname;
    if (r.method() !== "GET" && (p.includes("/business-knowledge/") || p.includes("/projects/")))
      report.writes.push({
        path: p,
        method: r.method(),
        csrf: !!r.headers()["x-traqen-csrf"],
        bearer: !!r.headers().authorization,
      });
  });
  await login(page, "owner");
  const board = page.getByTestId("business-knowledge-workbench");
  await page
    .getByRole("navigation", { name: "主导航", exact: true })
    .getByRole("link", { name: "工作区概览", exact: true })
    .click();
  const headLink = page.getByRole("link", { name: "打开精确发布知识", exact: true });
  await headLink.waitFor();
  assert.ok(!(await page.locator("body").innerText()).includes("CurrentGraphHead\nundefined"));
  await page.getByText("BUSINESS_KNOWLEDGE · r1", { exact: false }).waitFor();
  await shot("published-head-overview-1440.png");
  await headLink.click();
  assert.equal(
    new URL(page.url()).searchParams.get("publishedRevision"),
    blocked.publication.graphRevisionId,
  );
  report.checks.push(
    "ordinary-overview-displays-real-F003-kind-and-links-the-exact-published-head-not-legacy-mode",
  );
  await board.getByRole("button", { name: "已发布知识", exact: true }).click();
  await board.getByRole("button", { name: "打开当前头的精确发布版本", exact: true }).click();
  await board.getByRole("region", { name: "精确已发布图谱" }).waitFor();
  await board.getByLabel("会话标题", { exact: true }).fill("default blocked session");
  await board.getByRole("button", { name: "显式创建此版本的工作会话", exact: true }).click();
  await board.getByText("F003_SESSION_WRITE_BLOCKED", { exact: true }).waitFor();
  await board.getByText("F003_QUALITY_POLICY_UNCONFIRMED", { exact: true }).waitFor();
  report.checks.push("default-real-session-write-blocked-with-server-missing-no-local-unlock");
  const admitted = await fixture.publishMechanism(run.id, { retainForWork: true }),
    revision = admitted.publication.graphRevisionId;
  await visit(page, { knowledge: "published", publishedRevision: revision });
  await board.getByLabel("会话标题", { exact: true }).fill("Browser durable session");
  const delayed = await heldPost("**/versions/*/work-sessions");
  await board.getByRole("button", { name: "显式创建此版本的工作会话", exact: true }).click();
  const created = await delayed.accepted,
    sid = created.session.id;
  report.session = sid;
  await board.getByRole("button", { name: "工作会话与问答", exact: true }).click();
  await delayed.release();
  await sleep(250);
  assert.equal(new URL(page.url()).searchParams.get("sessionId"), null);
  await visit(page, { knowledge: "published", publishedRevision: revision });
  await board.getByRole("button", { name: "读取原次会话", exact: true }).click();
  await board.getByRole("heading", { name: "Browser durable session", exact: true }).waitFor();
  assert.equal(report.writes.filter((w) => w.path.endsWith("/work-sessions")).length, 2);
  report.checks.push(
    "late-real-create-201-does-not-navigate-and-explicit-coordinate-recovery-no-duplicate",
  );
  const form = board.getByRole("region", { name: "新增独立问题" });
  await form.getByRole("textbox", { name: "独立问题", exact: true }).fill("Persistent independent question");
  await form.getByLabel(/明确使用此发布图谱/).check();
  await form.getByLabel(/确认固定生效团队/).check();
  const lateQuestion = await heldPost("**/work-sessions/*/questions");
  await form.getByRole("button", { name: "提交一个新问题", exact: true }).click();
  const asked = await lateQuestion.accepted,
    qid = asked.request.id;
  report.question = qid;
  await board.getByRole("button", { name: "已发布知识", exact: true }).click();
  await lateQuestion.release();
  await sleep(250);
  assert.equal(new URL(page.url()).searchParams.get("questionId"), null);
  await visit(page, { knowledge: "sessions", sessionId: sid });
  await board.getByRole("button", { name: "查询原问题受理", exact: true }).click();
  await board.getByRole("heading", { name: "派生答案 · 非业务权威", exact: true }).waitFor();
  await board.getByText("UNKNOWN · 保留未知", { exact: true }).waitFor();
  await board.getByText(/答案核查合同：2/).waitFor();
  report.checks.push(
    "late-question-201-read-only-recovery-exact-v2-derived-answer-unknown-and-no-double-charge",
  );
  const calls = fixture.model.calls.length,
    writes = report.writes.length;
  await page.reload();
  await board.getByRole("heading", { name: "派生答案 · 非业务权威", exact: true }).waitFor();
  assert.equal(fixture.model.calls.length, calls);
  assert.equal(report.writes.length, writes);
  await board.getByRole("region", { name: "派生答案", exact: true }).scrollIntoViewIfNeeded();
  await shot("saved-answer-1440.png");
  report.checks.push("offline-reopen-retains-answer-source-and-budget-without-model-post");
  await form
    .getByRole("textbox", { name: "独立问题", exact: true })
    .fill("Keep this unsent question through another saved record");
  const beforeDraft = (await fixture.request("owner", `${fixture.base}/work-sessions/${sid}`)).body
    .session;
  const draftAnswer = (
    await fixture.request("owner", `${fixture.base}/work-sessions/${sid}/questions/${qid}`)
  ).body.answer;
  await fixture.post("owner", `${fixture.base}/work-sessions/${sid}/feedback`, {
    operationId: "concurrent-draft-record",
    expectedSessionVersion: beforeDraft.version,
    graphDigest: beforeDraft.binding.graphDigest,
    objectKey: null,
    answerId: draftAnswer.id,
    kind: "REVIEW_REQUEST",
    message: "An independent saved record must not erase a newer unsent question",
  });
  await board
    .getByText(`会话 ${sid} · CAS版本 ${beforeDraft.version + 1}`, { exact: true })
    .waitFor();
  assert.equal(
    await form.getByRole("textbox", { name: "独立问题", exact: true }).inputValue(),
    "Keep this unsent question through another saved record",
  );
  report.checks.push("immutable-record-refresh-retains-unsent-question-and-does-not-post-it");
  for (const fail of [false, true]) {
    const delayedRead = await heldRead(`**/work-sessions/${sid}/questions/${qid}`, fail);
    await visit(page, { knowledge: "sessions", sessionId: sid, questionId: qid });
    await delayedRead.received;
    await board.getByRole("button", { name: "已发布知识", exact: true }).click();
    await delayedRead.release();
    await board.getByRole("heading", { name: "已发布知识", exact: true }).waitFor();
    await sleep(250);
    assert.equal(new URL(page.url()).searchParams.get("knowledge"), "published");
    assert.equal(
      await board.getByRole("heading", { name: "派生答案 · 非业务权威", exact: true }).count(),
      0,
    );
  }
  report.checks.push(
    "late-actual-question-GET-and-controlled-503-never-replace-new-publication-view",
  );
  await visit(page, { knowledge: "sessions", sessionId: sid, questionId: qid });
  await board.getByRole("heading", { name: "派生答案 · 非业务权威", exact: true }).waitFor();
  await board.getByLabel("说明", { exact: true }).fill("Explicit correction, not approval");
  const feedback = responseWhen(
    page,
    (r) => r.request().method() === "POST" && new URL(r.url()).pathname.endsWith("/feedback"),
  );
  await board.getByRole("button", { name: "登记反馈，不批准", exact: true }).click();
  assert.equal((await feedback).status(), 201);
  await board.getByText(/反馈已登记/).waitFor();
  report.checks.push("explicit-answer-feedback-only-correction-not-decision");
  // Full records/events paginate real immutable writes, not a fake list response.
  const q = (
    await fixture.request("owner", `${fixture.base}/work-sessions/${sid}/questions/${qid}`)
  ).body;
  for (let i = 0; i < 50; i++) {
    const s = (await fixture.request("owner", `${fixture.base}/work-sessions/${sid}`)).body.session;
    await fixture.post("owner", `${fixture.base}/work-sessions/${sid}/feedback`, {
      operationId: `pagination-${i}`,
      expectedSessionVersion: s.version,
      graphDigest: s.binding.graphDigest,
      objectKey: null,
      answerId: q.answer.id,
      kind: "REVIEW_REQUEST",
      message: `Pagination retained ${i}`,
    });
  }
  await page.reload();
  await board.getByRole("button", { name: "下一页记录", exact: true }).click();
  await board.getByRole("heading", { name: /持久问题与反馈 · 第2页/ }).waitFor();
  await board.getByText("完整会话事件分页（不隐藏旧版本）", { exact: true }).click();
  await board.getByRole("button", { name: "下一页事件", exact: true }).click();
  report.checks.push("actual-record-and-event-cursor-pagination-retains-old-records");
  // Hold the model to make control states observable; never rewrite a CAS.
  fixture.model.hold();
  await visit(page, { knowledge: "sessions", sessionId: sid });
  await form.getByRole("textbox", { name: "独立问题", exact: true }).fill("Controlled independent question");
  await form.getByLabel(/明确使用此发布图谱/).check();
  await form.getByLabel(/确认固定生效团队/).check();
  const accepted = await observePost("**/work-sessions/*/questions");
  await form.getByRole("button", { name: "提交一个新问题", exact: true }).click();
  const controlledResponse = await accepted.received;
  assert.equal(controlledResponse.status, 201);
  const controlled = controlledResponse.body.request.id;
  for (const [action, label] of [
    ["pause", "暂停此问题"],
    ["resume", "恢复此问题"],
  ]) {
    await sleep(2300);
    const response = responseWhen(
      page,
      (r) =>
        r.request().method() === "POST" &&
        new URL(r.url()).pathname.endsWith(`/${controlled}/${action}`),
    );
    await board.getByRole("button", { name: label, exact: true }).click();
    assert.equal((await response).status(), 200);
  }
  await sleep(2300);
  const resumed = (
    await fixture.request("owner", `${fixture.base}/work-sessions/${sid}/questions/${controlled}`)
  ).body;
  if (resumed.run.state === "FAILED") {
    assert.equal(resumed.run.lastFailure.code, "F003_QA_CALL_OUTCOME_UNKNOWN");
    await board.getByText(/原模型调用已经开始/).waitFor();
    report.checks.push("started-call-outcome-unknown-is-not-automatically-reissued-or-refunded");
  }
  await visit(page, { knowledge: "sessions", sessionId: sid });
  await form
    .getByRole("textbox", { name: "独立问题", exact: true })
    .fill("Explicit different question for safe cancellation");
  await form.getByLabel(/明确使用此发布图谱/).check();
  await form.getByLabel(/确认固定生效团队/).check();
  const cancelAdmit = await observePost("**/work-sessions/*/questions");
  await form.getByRole("button", { name: "提交一个新问题", exact: true }).click();
  const cancelResponse = await cancelAdmit.received;
  assert.equal(cancelResponse.status, 201);
  const cancelId = cancelResponse.body.request.id;
  await sleep(2300);
  const cancel = responseWhen(
    page,
    (r) =>
      r.request().method() === "POST" && new URL(r.url()).pathname.endsWith(`/${cancelId}/cancel`),
  );
  await board.getByRole("button", { name: "取消此问题", exact: true }).click();
  assert.equal((await cancel).status(), 200);
  fixture.model.release();
  report.checks.push("actual-question-pause-resume-cancel-preserve-server-cas-and-budget");
  await visit(page, { knowledge: "sessions", sessionId: sid });
  await board.getByText("步骤1–2：选择新材料并查看变化，再明确接续", { exact: true }).click();
  const next = board.getByRole("region", { name: "新材料与版本接续" });
  await next
    .getByRole("button", { name: new RegExp(fixture.reference.bundleId.slice(0, 8)) })
    .click();
  await next.locator("fieldset").first().locator("input[type=checkbox]").check();
  await next.getByRole("button", { name: "1. 读取服务端完整变更预览", exact: true }).click();
  await next.getByText(/changeSetDigest：/).waitFor();
  await next.getByLabel("新调查问题", { exact: true }).fill("Explicit new material continuation");
  await next.getByLabel(/明确固定当前团队/).check();
  const continuing = await observePost("**/work-sessions/*/continue");
  await next
    .getByRole("button", { name: "2. 按已查看摘要明确创建新会话／调查", exact: true })
    .click();
  const continueResponse = await continuing.received;
  assert.equal(continueResponse.status, 201);
  const continued = continueResponse.body;
  await board.getByText(/新调查尚未显式采用它的已发布图谱/).waitFor();
  await complete(continued.run.id);
  const published = await fixture.publishMechanism(continued.run.id, { retainForWork: true });
  await page.reload();
  await board
    .getByRole("combobox", { name: "选择确属新调查的发布修订", exact: true })
    .selectOption(published.publication.graphRevisionId);
  const adopting = responseWhen(
    page,
    (r) => r.request().method() === "POST" && new URL(r.url()).pathname.endsWith("/adopt-graph"),
  );
  await board
    .getByRole("button", { name: "3. 明确采用此新调查的精确已发布图谱", exact: true })
    .click();
  assert.equal((await adopting).status(), 201);
  await board.getByRole("region", { name: "新增独立问题" }).waitFor();
  assert.equal(
    (await fixture.request("owner", `${fixture.base}/work-sessions/${sid}/questions/${qid}`)).body
      .answer.id,
    q.answer.id,
  );
  report.checks.push(
    "server-changes-preview-explicit-new-session-and-exact-published-adoption-old-answer-preserved",
  );
  // Real single-Claim workflow, distinct proposal and independent review.
  const original = (await fixture.request("owner", `${fixture.base}/versions/${revision}`)).body,
    key = original.graph.candidates[0].key;
  await visit(page, { knowledge: "published", publishedRevision: revision, publishedObject: key });
  const human = board.getByRole("region", { name: "单条对象人工复核" });
  await human.waitFor();
  for (const [label, value] of [
    ["featureId", "browser-feature"],
    ["claimId", "browser-claim"],
    ["scopeId", "browser-scope"],
  ])
    await human.getByLabel(label, { exact: true }).fill(value);
  await human
    .getByText("明确创建单条Feature / scope / Claim（如已有则不创建）", { exact: true })
    .click();
  await human.getByLabel("Feature名称", { exact: true }).fill("One browser human claim");
  for (const [label, suffix] of [
    ["保存明确Feature版本", "/features"],
    ["保存明确scope版本", "/claim-scopes"],
    ["保存这一条待复核Claim", "/claims"],
  ]) {
    const response = responseWhen(
      page,
      (r) => r.request().method() === "POST" && new URL(r.url()).pathname.endsWith(suffix),
    );
    await human.getByRole("button", { name: label, exact: true }).click();
    assert.equal((await response).status(), 201);
  }
  await human.getByRole("button", { name: "读取并核对这条Claim的现有版本", exact: true }).click();
  await human.getByText(/当前服务端Feature\/Claim\/scope版本已核对/).waitFor();
  await human
    .getByRole("combobox", { name: "本次明确审核角色", exact: true })
    .selectOption("business-owner");
  await human.getByRole("combobox", { name: "风险", exact: true }).selectOption("LOW");
  await human.getByRole("combobox", { name: "审批模式", exact: true }).selectOption("SINGLE");
  await human
    .getByLabel("提案理由与适用条件", { exact: true })
    .fill("Independent explicit single rule, no whole-graph confirmation");
  const proposed = await observePost("**/projects/*/decision-review-cases");
  await human.getByRole("button", { name: "明确提出此Claim的决定复核", exact: true }).click();
  const proposalResponse = await proposed.received;
  assert.equal(proposalResponse.status, 201);
  const caseId = proposalResponse.body.reviewCase.id;
  report.caseId = caseId;
  await human.getByRole("region", { name: "独立审批案例" }).waitFor();
  await human.getByLabel("明确理由", { exact: true }).fill("Proposer must not self approve");
  const self = responseWhen(
    page,
    (r) =>
      r.request().method() === "POST" && new URL(r.url()).pathname.endsWith(`/${caseId}/events`),
  );
  await human.getByRole("button", { name: "以当前独立账号提交审核动作", exact: true }).click();
  assert.ok((await self).status() >= 400);
  await board.getByRole("alert").waitFor();
  await shot("human-proposal-self-refused-1440.png");
  await visit(page, { knowledge: "published", publishedRevision: revision, publishedObject: key });
  await human.scrollIntoViewIfNeeded();
  await page.setViewportSize({ width: 900, height: 900 });
  await human.scrollIntoViewIfNeeded();
  await shot("human-review-900.png");
  await page.getByLabel("全局主题配色", { exact: true }).selectOption("dark");
  await shot("human-review-dark-900.png");
  const admin = await fixture.runtime.identity.login({
    login: "admin",
    password: syntheticPassword,
  });
  await fixture.runtime.identity.grant(admin.token, "workspace", {
    accountId: fixture.accounts.reader.id,
    roles: ["READ"],
  });
  const rc = await browser.newContext({ viewport: { width: 900, height: 900 } }),
    reader = await rc.newPage();
  reader.on("pageerror", (e) => report.errors.push(e.message));
  await login(reader, "reader");
  await visit(reader, { knowledge: "published", publishedRevision: revision });
  await reader.getByRole("region", { name: "精确已发布图谱" }).waitFor();
  assert.equal(
    (await fixture.request("reader", `${fixture.base}/investigations/${run.id}`)).status,
    403,
  );
  await reader.screenshot({
    path: path.join(directory, "read-only-publication-900.png"),
    fullPage: true,
  });
  report.screenshots.push("read-only-publication-900.png");
  report.checks.push(
    "new-read-member-discovers-exact-published-knowledge-without-private-delegation",
  );
  await fixture.runtime.identity.grant(admin.token, "workspace", {
    accountId: fixture.accounts.reader.id,
    roles: ["READ", "business-owner"],
  });
  await visit(reader, {
    knowledge: "published",
    publishedRevision: revision,
    publishedObject: key,
  });
  const rh = reader.getByRole("region", { name: "单条对象人工复核" });
  for (const [label, value] of [
    ["featureId", "browser-feature"],
    ["claimId", "browser-claim"],
    ["scopeId", "browser-scope"],
  ])
    await rh.getByLabel(label, { exact: true }).fill(value);
  await rh
    .getByRole("combobox", { name: "本次明确审核角色", exact: true })
    .selectOption("business-owner");
  await rh.getByLabel("原案例／另一审批人共享的精确ID", { exact: true }).fill(caseId);
  await rh.getByRole("button", { name: "只读找回该案例", exact: true }).click();
  await rh.getByLabel("明确理由", { exact: true }).fill("Independent actual F008 account approval");
  const approval = responseWhen(
    reader,
    (r) =>
      r.request().method() === "POST" && new URL(r.url()).pathname.endsWith(`/${caseId}/events`),
  );
  await rh.getByRole("button", { name: "以当前独立账号提交审核动作", exact: true }).click();
  assert.equal((await approval).status(), 201);
  const binding = (
    await fixture.request(
      "owner",
      `${fixture.base}/versions/${revision}/authority-bindings?objectKey=${encodeURIComponent(key)}`,
    )
  ).body;
  assert.equal(binding.bindingSet, null, "human approval never auto-maps graph");
  report.checks.push(
    "actionable-single-claim-proposal-self-refusal-independent-approval-no-automatic-mapping",
  );
  await visit(page, { knowledge: "published", publishedRevision: revision, publishedObject: key });
  await board.getByText("显式映射既有权威版本", { exact: true }).click();
  for (const [label, value] of [
    ["Feature ID", "browser-feature"],
    ["Claim ID", "browser-claim"],
    ["范围 ID", "browser-scope"],
  ])
    await board.getByLabel(label, { exact: true }).fill(value);
  await board
    .getByLabel("映射理由", { exact: true })
    .fill("Explicit version binding after independent human decision");
  await board.getByLabel(/已比较此发布版本/).check();
  const mapping = responseWhen(
    page,
    (r) =>
      r.request().method() === "POST" && new URL(r.url()).pathname.endsWith("/authority-bindings"),
  );
  await board.getByRole("button", { name: "保存版本映射", exact: true }).click();
  assert.equal((await mapping).status(), 201);
  report.checks.push("human-decision-followed-by-separate-explicit-object-version-mapping");
  await visit(page, { knowledge: "sessions", sessionId: sid, questionId: qid });
  await board.getByRole("heading", { name: "派生答案 · 非业务权威", exact: true }).waitFor();
  await fixture.revoke();
  await page.getByRole("alert").getByText("当前无权读取", { exact: true }).waitFor();
  assert.equal(await board.getByRole("region", { name: "派生答案" }).count(), 0);
  report.checks.push("actual-current-acl-revocation-clears-saved-answer-and-session");
  assert.ok(report.writes.every((w) => w.csrf && !w.bearer));
  report.status = report.errors.length ? "FAILED" : "PASSED";
} catch (e) {
  report.status = "FAILED";
  report.errors.push(e.stack ?? e.message);
  console.error(e.stack ?? e.message);
  if (page) {
    report.url = page.url();
    await writeFile(
      path.join(directory, "failure-dom.txt"),
      await page.locator("body").innerText(),
    );
    await shot("failure.png").catch(() => {});
  }
} finally {
  clearTimeout(timer);
  await browser?.close().catch(() => {});
  if (front && front.exitCode === null) {
    front.kill("SIGTERM");
    await new Promise((r) => {
      front.once("exit", r);
      setTimeout(r, 3000);
    });
  }
  for (const cleanup of cleanups.reverse())
    await Promise.resolve()
      .then(cleanup)
      .catch((e) => report.errors.push(`cleanup: ${e.message}`));
  await writeFile(path.join(directory, "frontend.log"), logs.join(""));
  await writeFile(path.join(directory, "summary.json"), JSON.stringify(report, null, 2));
}
process.stdout.write(
  JSON.stringify({ ...report, parentPath: `${directory}/`, childPath: "summary.json" }) + "\n",
);
if (report.status !== "PASSED" || report.errors.length) process.exitCode = 1;
