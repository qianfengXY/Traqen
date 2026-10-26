import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createServer } from "node:net";
import { isolatedPostgres } from "./source-truth-postgres.js";
import { webAuthorityFixture } from "./f003-web-authority-fixture.js";
import { syntheticQuestion } from "./f003-work-ui-model.js";
import { syntheticPassword } from "./f002-f003-server-fixture.js";

const [modulePath, executablePath] = process.argv.slice(2);
const mode = process.argv[4] ?? "routing";
assert.ok(path.isAbsolute(modulePath ?? "") && path.isAbsolute(executablePath ?? ""));
const root = fileURLToPath(new URL("../../", import.meta.url));
const directory = await mkdtemp(path.join(tmpdir(), "traqen-f003-question-routing-browser-"));
const env = Object.fromEntries(
  ["PATH", "HOME", "TMPDIR", "LANG", "LC_ALL", "LC_CTYPE", "SHELL"].flatMap((k) =>
    process.env[k] === undefined ? [] : [[k, process.env[k]]],
  ),
);
const socket = createServer();
await new Promise((r) => socket.listen(0, "127.0.0.1", r));
const port = socket.address().port;
await new Promise((r) => socket.close(r));
const origin = `http://127.0.0.1:${port}`,
  cleanups = [],
  logs = [];
const report = {
  scope: "ACTUAL_COOKIE_NATIVE_HTTP_SAVED_QA_ROUTING_SYNTHETIC_MODEL_QUALITY_ONLY",
  status: "RUNNING",
  checks: [],
  errors: [],
  writes: [],
  screenshots: [],
};
let f, front, browser, page;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const timer = setTimeout(() => {
  report.errors.push("Bounded browser deadline");
  front?.kill("SIGTERM");
  void browser?.close();
}, 240000);
async function shot(name) {
  await page.screenshot({ path: path.join(directory, name), fullPage: true });
  report.screenshots.push(name);
}
async function done(id) {
  let run;
  for (let i = 0; i < 400; i++) {
    run = (await f.request("owner", `${f.base}/investigations/${id}`)).body.investigation;
    if (["COMPLETED", "FAILED"].includes(run.state)) break;
    await sleep(40);
  }
  assert.equal(run.state, "COMPLETED", JSON.stringify(run));
  return run;
}
async function login(name) {
  await page.goto(origin);
  await page.getByLabel("账号", { exact: true }).fill(name);
  await page.getByLabel("密码", { exact: true }).fill(syntheticPassword);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.getByLabel("切换工作区", { exact: true }).selectOption("workspace");
  await page
    .getByRole("navigation", { name: "主导航", exact: true })
    .getByRole("link", { name: "业务图谱", exact: true })
    .click();
}
const deep = (id) =>
  `${origin}/?page=graph&workspace=workspace&runId=${encodeURIComponent(id)}&view=BUSINESS`;
try {
  const cluster = await isolatedPostgres({ after: (cb) => cleanups.push(cb) });
  f = await webAuthorityFixture(
    { after: (cb) => cleanups.push(cb) },
    {
      database: () => cluster.createDatabase(),
      webOrigin: origin,
      workModelResponse: syntheticQuestion,
    },
  );
  f.model.release();
  await f.runtime.knowledge.start();
  const deadline = new Date(Date.now() + 600000).toISOString();
  const business = (
    await f.post("owner", `${f.base}/investigations`, {
      operationId: "routing-business",
      question: "Routing normal business investigation",
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
  await done(business.id);
  const pub = await f.publishMechanism(business.id, { retainForWork: true });
  const session = (
    await f.post("owner", `${f.base}/versions/${pub.publication.graphRevisionId}/work-sessions`, {
      operationId: "routing-session",
      expectedGraphDigest: pub.publication.graphDigest,
      title: "Routing persistent session",
    })
  ).session;
  const question = (
    await f.post("owner", `${f.base}/work-sessions/${session.id}/questions`, {
      operationId: "routing-question",
      expectedSessionVersion: 1,
      expectedProfileId: f.profile.id,
      question: "Routing saved derived question",
      objectKeys: null,
      budget: { maxReadBytes: 16384, maxModelCalls: 5, deadline },
    })
  ).request;
  const qa = await done(question.id);
  assert.equal(qa.purpose, "GRAPH_QUESTION");
  assert.equal(qa.questionContext.sessionId, session.id);
  assert.equal(qa.id, question.id);
  report.contract = {
    businessId: business.id,
    questionId: question.id,
    sessionId: session.id,
    purpose: qa.purpose,
    questionContext: qa.questionContext,
  };
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
        ...env,
        TRAQEN_API_PROXY_TARGET: f.runtime.origin,
        NEXT_PUBLIC_TRAQEN_API_BASE: "/api",
        WRANGLER_LOG_PATH: path.join(directory, "wrangler.log"),
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  front.stdout.on("data", (b) => logs.push(b.toString()));
  front.stderr.on("data", (b) => logs.push(b.toString()));
  const start = Date.now();
  while (true) {
    try {
      if ((await fetch(origin, { signal: AbortSignal.timeout(1000) })).ok) break;
    } catch {}
    assert.ok(front.exitCode === null && Date.now() - start < 60000, "Owned frontend startup");
    await sleep(100);
  }
  const { chromium } = await import(pathToFileURL(modulePath).href);
  browser = await chromium.launch({ executablePath, headless: true, env });
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(20000);
  page.on("pageerror", (e) => report.errors.push(e.message));
  const reads = [];
  page.on("request", (r) => {
    if (r.url().includes("/business-knowledge/")) {
      if (r.method() === "GET") reads.push(new URL(r.url()).pathname);
      else
        report.writes.push({
          path: new URL(r.url()).pathname,
          method: r.method(),
        });
    }
  });
  await login("owner");
  if (mode === "busy") {
    await page.goto(
      `${origin}/?page=graph&workspace=workspace&knowledge=sessions&sessionId=${session.id}&questionId=${question.id}`,
    );
    const form = page.getByRole("region", {
      name: "新增独立问题",
      exact: true,
    });
    await form
      .getByRole("textbox", { name: "独立问题", exact: true })
      .fill("Normal accepted question must release busy");
    await form.getByLabel(/明确使用此发布图谱/).check();
    await form.getByLabel(/确认固定生效团队/).check();
    const received = page.waitForResponse(
      (r) =>
        r.request().method() === "POST" &&
        new URL(r.url()).pathname.endsWith(`/work-sessions/${session.id}/questions`),
    );
    await form.getByRole("button", { name: "提交一个新问题", exact: true }).click();
    assert.equal((await received).status(), 201);
    await page.getByText("派生答案 · 非业务权威", { exact: true }).waitFor();
    await sleep(100);
    assert.equal(
      await form.getByRole("textbox", { name: "独立问题", exact: true }).isEnabled(),
      true,
      "A successful same-component navigation must release its own busy state",
    );
    report.checks.push("normal-question-success-releases-form-busy-after-own-route-change");
    let accept, release;
    const admitted = new Promise((r) => (accept = r)),
      gate = new Promise((r) => (release = r));
    await page.route("**/work-sessions/*/questions", async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      const response = await route.fetch();
      assert.equal(response.status(), 201);
      accept(await response.json());
      await gate;
      await route.fulfill({ response });
    });
    await form
      .getByRole("textbox", { name: "独立问题", exact: true })
      .fill("Late accepted question retains exact recovery");
    await form.getByRole("button", { name: "提交一个新问题", exact: true }).click();
    const late = await admitted;
    await page.getByLabel("精确问题 ID", { exact: true }).fill(question.id);
    await page.getByRole("button", { name: "离线回读已保存的问题", exact: true }).click();
    release();
    await sleep(200);
    await page.unroute("**/work-sessions/*/questions");
    assert.equal(new URL(page.url()).searchParams.get("questionId"), question.id);
    const recover = form.getByRole("button", {
      name: "查询原问题受理",
      exact: true,
    });
    await recover.waitFor();
    assert.equal(
      await recover.isEnabled(),
      true,
      "Late old operation must not strand recovery busy",
    );
    await recover.click();
    for (
      let i = 0;
      i < 50 && new URL(page.url()).searchParams.get("questionId") !== late.request.id;
      i++
    )
      await sleep(100);
    assert.equal(new URL(page.url()).searchParams.get("questionId"), late.request.id);
    assert.equal(report.writes.filter((w) => w.path.endsWith("/questions")).length, 2);
    report.checks.push(
      "late-same-session201-keeps-newer-question-and-explicit-GET-recovery-no-duplicate",
    );
  } else if (mode === "recovery") {
    const decoy = (
      await f.post("owner", `${f.base}/versions/${pub.publication.graphRevisionId}/work-sessions`, {
        operationId: "unrelated-session-op",
        expectedGraphDigest: pub.publication.graphDigest,
        title: "Unrelated accepted session",
      })
    ).session;
    const parent = (await f.request("owner", `${f.base}/work-sessions/${session.id}`)).body.session;
    const next = {
      reference: f.reference,
      scope: { componentIds: [f.componentId] },
      technicalVersionId: null,
    };
    const changes = (
      await f.request(
        "owner",
        `${f.base}/work-sessions/${session.id}/continuation-preview`,
        "POST",
        next,
      )
    ).body;
    const actual = (
      await f.post("owner", `${f.base}/work-sessions/${session.id}/continue`, {
        ...next,
        operationId: "expected-original-continuation",
        expectedSessionVersion: parent.version,
        expectedChangeSetDigest: changes.changeSetDigest,
        expectedProfileId: f.profile.id,
        question: "Actual original continuation",
        budget: { maxReadBytes: 20000, maxModelCalls: 12, deadline },
        supplementBudget: {
          maxMaterials: 10,
          maxBytes: 20000,
          maxRuleApplications: 100,
          maximumAttempts: 2,
          deadline,
        },
      })
    ).session;
    await done(actual.investigationId);
    const calls = f.model.calls.length;
    const journal = `traqen.work.${encodeURIComponent(f.accounts.owner.id)}.workspace.${encodeURIComponent("continue:" + session.id)}`;
    await page.evaluate(
      ({ key, id }) =>
        localStorage.setItem(
          key,
          JSON.stringify({
            schemaVersion: 1,
            operationId: "expected-original-continuation",
            resultId: id,
          }),
        ),
      { key: journal, id: decoy.id },
    );
    await page.goto(
      `${origin}/?page=graph&workspace=workspace&knowledge=sessions&sessionId=${session.id}`,
    );
    await page.getByText("步骤1–2：选择新材料并查看变化，再明确接续", { exact: true }).click();
    const read = page.waitForResponse(
      (r) =>
        r.request().method() === "GET" &&
        new URL(r.url()).pathname.endsWith(`/work-sessions/${decoy.id}`),
    );
    void read.catch(() => {});
    await page.getByRole("button", { name: "只读找回原接续", exact: true }).click();
    assert.equal((await read).status(), 200);
    await sleep(300);
    assert.equal(
      new URL(page.url()).searchParams.get("sessionId"),
      session.id,
      "A resultId is not proof of the original continuation operation",
    );
    assert.ok(
      await page.evaluate((key) => localStorage.getItem(key), journal),
      "Invalid receipt must retain original coordinate",
    );
    report.checks.push(
      "foreign-operation-result-coordinate-rejected-without-navigation-or-clearing",
    );
    const visitParent = async () => {
      await page.goto(
        `${origin}/?page=graph&workspace=workspace&knowledge=sessions&sessionId=${session.id}`,
      );
      await page.getByText("步骤1–2：选择新材料并查看变化，再明确接续", { exact: true }).click();
    };
    const setCoordinate = async (id) =>
      page.evaluate(
        ({ key, id }) =>
          localStorage.setItem(
            key,
            JSON.stringify({
              schemaVersion: 1,
              operationId: "expected-original-continuation",
              ...(id ? { resultId: id } : {}),
            }),
          ),
        { key: journal, id },
      );
    const childPattern = `**/work-sessions/${actual.id}?*`;
    await setCoordinate(actual.id);
    await page.route(childPattern, async (route) => {
      const response = await route.fetch(),
        body = await response.json();
      body.session.origin.sessionId = decoy.id;
      await route.fulfill({ response, json: body });
    });
    await visitParent();
    await page.getByRole("button", { name: "只读找回原接续", exact: true }).click();
    await page
      .getByText("响应与固定会话、问题或来源版本不符，未更新当前内容。", {
        exact: true,
      })
      .waitFor();
    assert.equal(new URL(page.url()).searchParams.get("sessionId"), session.id);
    assert.ok(await page.evaluate((key) => localStorage.getItem(key), journal));
    await page.unroute(childPattern);
    await page
      .getByRole("button", { name: "只读找回原接续", exact: true })
      .scrollIntoViewIfNeeded();
    await shot("wrong-continuation-rejected-1440.png");
    report.checks.push(
      "controlled-wrong-parent-on-real-readable-child-is-rejected-and-coordinate-retained",
    );
    await visitParent();
    await page.getByRole("button", { name: "只读找回原接续", exact: true }).click();
    await page.waitForURL((u) => u.searchParams.get("sessionId") === actual.id);
    assert.equal(await page.evaluate((key) => localStorage.getItem(key), journal), null);
    report.checks.push("exact-operation-parent-and-origin-binding-recovers-through-GET-only");
    await setCoordinate(undefined);
    await visitParent();
    await page.getByRole("button", { name: "只读找回原接续", exact: true }).click();
    await page.waitForURL((u) => u.searchParams.get("sessionId") === actual.id);
    report.checks.push(
      "lost201-without-resultId-uses-original-parent-events-and-the-same-validator",
    );
    await setCoordinate(actual.id);
    let release, received;
    const gate = new Promise((r) => (release = r)),
      held = new Promise((r) => (received = r));
    await page.route(childPattern, async (route) => {
      const response = await route.fetch();
      received();
      await gate;
      await route.fulfill({ response }).catch(() => {});
    });
    await visitParent();
    await page.getByRole("button", { name: "只读找回原接续", exact: true }).click();
    await held;
    await page.getByRole("button", { name: "已发布知识", exact: true }).click();
    release();
    await sleep(300);
    await page.unroute(childPattern);
    assert.equal(new URL(page.url()).searchParams.get("knowledge"), "published");
    assert.ok(await page.evaluate((key) => localStorage.getItem(key), journal));
    report.checks.push("late-exact-recovery-does-not-navigate-or-consume-a-newer-view");
    await visitParent();
    await f.revoke();
    await page.getByRole("button", { name: "只读找回原接续", exact: true }).click();
    await page.getByText("当前无权读取", { exact: true }).waitFor();
    assert.ok(await page.evaluate((key) => localStorage.getItem(key), journal));
    report.checks.push("actual-current-ACL-denial-clears-view-and-keeps-unresolved-coordinate");
    assert.equal(f.model.calls.length, calls);
    assert.deepEqual(report.writes, []);
  } else {
    await page.getByRole("button", { name: "我的调查", exact: true }).click();
    const row = page
      .getByRole("complementary", { name: "业务调查清单" })
      .getByRole("button")
      .filter({ hasText: question.question });
    await row.waitFor();
    const label = await row.innerText();
    assert.ok(label.includes("问答"), "QA discovery must identify question purpose: " + label);
    assert.ok(!label.includes("分析已保存"), "QA is not a saved business graph");
    await row.scrollIntoViewIfNeeded();
    await shot("typed-private-run-list-1440.png");
    await row.click();
    await page.getByText("派生答案 · 非业务权威", { exact: true }).waitFor();
    assert.equal(new URL(page.url()).searchParams.get("sessionId"), session.id);
    assert.equal(new URL(page.url()).searchParams.get("questionId"), question.id);
    report.checks.push(
      "ordinary-private-list-labels-saved-QA-and-opens-exact-owned-session-question",
    );
    await page.goto(deep(question.id));
    await page.getByText("这是图谱问答运行，不是业务调查", { exact: true }).waitFor();
    await shot("question-run-type-bridge-1440.png");
    assert.equal(await page.getByText("技术补证与明确采用", { exact: true }).count(), 0);
    assert.equal(await page.getByText("尚无保存的分析图谱", { exact: true }).count(), 0);
    const from = reads.length;
    await page.getByRole("button", { name: "打开所属会话的精确问题", exact: true }).click();
    await page.getByText("派生答案 · 非业务权威", { exact: true }).waitFor();
    assert.ok(
      reads
        .slice(from)
        .some((p) => p.endsWith(`/work-sessions/${session.id}/questions/${question.id}`)),
    );
    await shot("question-exact-session-1440.png");
    report.checks.push(
      "QA-run-deep-link-is-explicit-type-bridge-without-business-adoption-controls",
    );
    await page.goto(deep(business.id));
    await page.getByText("已保存分析", { exact: true }).waitFor();
    await page.getByText("技术补证与明确采用", { exact: true }).waitFor();
    report.checks.push(
      "existing-undeclared-purpose-business-investigation-retains-real-saved-graph",
    );
    const target = `**/business-knowledge/investigations/${question.id}`;
    await page.route(target, async (route) => {
      const response = await route.fetch(),
        body = await response.json();
      body.investigation.purpose = "FUTURE_KIND";
      await route.fulfill({ response, json: body });
    });
    await page.goto(deep(question.id));
    await page.getByText("运行类型未识别，未作为业务调查展示", { exact: true }).waitFor();
    assert.equal(await page.getByText("技术补证与明确采用", { exact: true }).count(), 0);
    await page.unroute(target);
    report.checks.push("unknown-purpose-is-explicit-not-a-business-analysis-or-guessed-latest");
    await page.route(target, async (route) => {
      const response = await route.fetch(),
        body = await response.json();
      body.investigation.questionContext.sourceInput.sourceBundleSnapshotId = "f".repeat(64);
      await route.fulfill({ response, json: body });
    });
    await page.goto(deep(question.id));
    await page.getByText("这是图谱问答运行，不是业务调查", { exact: true }).waitFor();
    assert.equal(
      await page.getByRole("button", { name: "打开所属会话的精确问题", exact: true }).count(),
      0,
    );
    await page.unroute(target);
    report.checks.push("contradictory-question-binding-cannot-construct-a-session-link");
    const context = await browser.newContext();
    const reader = await context.newPage();
    page = reader;
    const readerReads = [];
    reader.on("request", (r) => {
      if (r.url().includes("/business-knowledge/") && r.method() === "GET")
        readerReads.push(new URL(r.url()).pathname);
    });
    await login("reader");
    await page.goto(deep(question.id));
    await page.getByText("当前无权读取", { exact: true }).waitFor();
    assert.equal(
      await page.getByRole("button", { name: "打开所属会话的精确问题", exact: true }).count(),
      0,
    );
    assert.equal(readerReads.filter((p) => p.includes("/questions/")).length, 0);
    report.checks.push("foreign-private-QA-denial-does-not-auto-delegate-or-read-a-session");
    assert.deepEqual(report.writes, []);
  }
  assert.deepEqual(report.errors, []);
  report.status = "PASSED";
} catch (error) {
  report.errors.push(error.stack ?? String(error));
  report.status = "FAILED";
  if (page) await shot("failure.png").catch(() => {});
  process.exitCode = 1;
} finally {
  clearTimeout(timer);
  await browser?.close().catch(() => {});
  if (front && front.exitCode === null) {
    front.kill("SIGTERM");
    await Promise.race([new Promise((r) => front.once("exit", r)), sleep(3000)]);
    if (front.exitCode === null) front.kill("SIGKILL");
  }
  for (const cb of cleanups.reverse()) await cb();
  await writeFile(path.join(directory, "frontend.log"), logs.join(""));
  report.parentPath = directory + "/";
  report.childPath = "summary.json";
  await writeFile(path.join(directory, "summary.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
}
