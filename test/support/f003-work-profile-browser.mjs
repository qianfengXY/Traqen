import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { isolatedPostgres } from "./source-truth-postgres.js";
import { webAuthorityFixture } from "./f003-web-authority-fixture.js";
import { syntheticQuestion } from "./f003-work-ui-model.js";
import { syntheticPassword } from "./f002-f003-server-fixture.js";
import { fileURLToPath, pathToFileURL } from "node:url";
const [modulePath, executablePath] = process.argv.slice(2);
if (!modulePath || !executablePath)
  throw Error("Provide explicit owned Playwright module and browser");
const { chromium } = await import(pathToFileURL(modulePath).href);
const root = fileURLToPath(new URL("../../", import.meta.url)).replace(/\/$/, ""),
  callbacks = [],
  t = { after: (fn) => callbacks.push(fn) };
const env = Object.fromEntries(
  ["PATH", "HOME", "TMPDIR", "LANG"].flatMap((k) =>
    process.env[k] === undefined ? [] : [[k, process.env[k]]],
  ),
);
const probe = createServer();
await new Promise((r) => probe.listen(0, "127.0.0.1", r));
const port = probe.address().port;
await new Promise((r) => probe.close(r));
const origin = `http://127.0.0.1:${port}`;
let front, browser;
const stop = setTimeout(() => {
  front?.kill("SIGTERM");
  void browser?.close();
}, 100000);
try {
  const pg = await isolatedPostgres(t),
    f = await webAuthorityFixture(t, {
      database: () => pg.createDatabase(),
      webOrigin: origin,
      workModelResponse: syntheticQuestion,
    });
  f.model.release();
  await f.runtime.knowledge.start();
  const deadline = new Date(Date.now() + 600000).toISOString(),
    run = (
      await f.post("owner", `${f.base}/investigations`, {
        operationId: "profile-probe",
        question: "Synthetic profile refusal recovery",
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
    state = (await f.request("owner", `${f.base}/investigations/${run.id}`)).body.investigation;
    if (["COMPLETED", "FAILED"].includes(state.state)) break;
    await delay(30);
  }
  assert.equal(state.state, "COMPLETED");
  const p = (await f.publishMechanism(run.id, { retainForWork: true })).publication,
    s = (
      await f.post("owner", `${f.base}/versions/${p.graphRevisionId}/work-sessions`, {
        operationId: "profile-probe-session",
        expectedGraphDigest: p.graphDigest,
        title: "Profile recovery probe",
      })
    ).session;
  front = spawn(
    process.execPath,
    [
      `${root}/web/node_modules/vinext/dist/cli.js`,
      "dev",
      "--hostname",
      "127.0.0.1",
      "--port",
      String(port),
    ],
    {
      cwd: `${root}/web`,
      env: {
        ...env,
        TRAQEN_API_PROXY_TARGET: f.runtime.origin,
        NEXT_PUBLIC_TRAQEN_API_BASE: "/api",
      },
      stdio: "ignore",
    },
  );
  for (let i = 0; i < 300; i++) {
    try {
      if ((await fetch(origin, { signal: AbortSignal.timeout(500) })).ok) break;
    } catch {}
    await delay(100);
  }
  browser = await chromium.launch({ executablePath, headless: true, env });
  const page = await browser.newPage();
  page.setDefaultTimeout(20000);
  await page.goto(origin);
  await page.getByLabel("账号", { exact: true }).fill("owner");
  await page.getByLabel("密码", { exact: true }).fill(syntheticPassword);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.getByLabel("切换工作区", { exact: true }).selectOption("workspace");
  await page.goto(`${origin}/?page=graph&workspace=workspace&knowledge=sessions&sessionId=${s.id}`);
  const form = page.getByRole("region", { name: "新增独立问题", exact: true }),
    field = form.getByRole("textbox", { name: "独立问题", exact: true });
  await field.fill("Retain my independent question after a definite profile refusal");
  await form.getByLabel(/明确使用此发布图谱/).check();
  await form.getByLabel(/确认固定生效团队/).check();
  let attempts = 0;
  const calls = f.model.calls.length;
  await page.route("**/work-sessions/*/questions", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    attempts++;
    await route.fulfill({
      status: 409,
      contentType: "application/json",
      body: JSON.stringify({
        error: {
          code: "F003_PROFILE_CONFLICT",
          message: "Controlled pre-admission refusal: active profile changed",
        },
      }),
    });
  });
  await form.getByRole("button", { name: "提交一个新问题", exact: true }).click();
  await form.getByText("F003_PROFILE_CONFLICT", { exact: true }).waitFor();
  assert.equal(attempts, 1);
  assert.equal(f.model.calls.length, calls);
  assert.equal(
    (await f.request("owner", `${f.base}/work-sessions/${s.id}`)).body.records.length,
    0,
  );
  assert.equal(
    await form.getByText(/原问题操作键/).count(),
    0,
    "a definite pre-admission profile refusal must not strand an unknown accepted operation",
  );
  assert.equal(
    await field.inputValue(),
    "Retain my independent question after a definite profile refusal",
  );
  await form.getByRole("button", { name: "重新读取当前生效团队", exact: true }).click();
  assert.equal(attempts, 1);
  assert.equal(f.model.calls.length, calls);
  console.log(
    JSON.stringify({
      status: "PASSED",
      scope:
        "CONTROLLED_PRE_ADMISSION_409_TRANSPORT_FAULT_ON_REAL_NATIVE_COOKIE_UI_NOT_REAL_PROFILE_MUTATION",
      attempts,
      modelCallsUnchanged: true,
      retainedDraft: true,
    }),
  );
} finally {
  clearTimeout(stop);
  await browser?.close().catch(() => {});
  if (front && front.exitCode === null) {
    front.kill("SIGTERM");
    await Promise.race([new Promise((r) => front.once("exit", r)), delay(3000)]);
  }
  for (const fn of callbacks.reverse()) await Promise.resolve().then(fn);
}
