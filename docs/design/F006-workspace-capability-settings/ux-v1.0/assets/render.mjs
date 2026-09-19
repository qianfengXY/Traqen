/**
 * Render and verify the F006 fixture-only UX prototype with an existing Chrome binary.
 *
 * Usage:
 *   node render.mjs /absolute/path/to/Chrome
 *
 * The script starts only a loopback static server and a disposable headless Chrome profile.
 * It never starts Traqen, contacts an API, loads credentials, or writes product data.
 */
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { dirname, resolve, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { once } from "node:events";

const chromePath = process.argv[2];
assert(chromePath, "Usage: node render.mjs /absolute/path/to/Chrome");
const here = dirname(fileURLToPath(import.meta.url));
const source = resolve(here, "prototype.html");
const previews = resolve(here, "previews");
await mkdir(previews, { recursive: true });
const html = await readFile(source);
const sourceSha256 = createHash("sha256").update(html).digest("hex");
const report = {
  version: "1.0",
  kind: "author-fixture-render-and-interaction-validation",
  fixtureOnly: true,
  recordedAt: new Date().toISOString(),
  sourceHTMLSha256: sourceSha256,
  screens: [],
  checks: [],
  smallWindowChecks: [],
  pageErrors: [],
  limitations: [
    "This is an isolated HTML/CSS/JS fixture, not a product frontend or backend acceptance run.",
    "No API, CLI, credential, MCP connector, user workspace, or production data is loaded.",
    "Viewport screenshots validate the designed desktop layouts; they do not certify physical-display behavior or full assistive-technology conformance.",
    "Simulated write events validate only fixture control flow and scope sentinels; they are not service-side persistence evidence.",
  ],
};

const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
async function freePort() {
  const server = createServer();
  await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  const { port } = server.address();
  await new Promise((resolveClose) => server.close(resolveClose));
  return port;
}

const staticServer = createServer(async (request, response) => {
  const path = new URL(request.url, "http://fixture.local").pathname;
  if (path === "/favicon.ico") { response.writeHead(204); response.end(); return; }
  if (path !== "/prototype.html") { response.writeHead(404); response.end("Not found"); return; }
  response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
  response.end(html);
});
await new Promise((resolveListen) => staticServer.listen(0, "127.0.0.1", resolveListen));
const staticPort = staticServer.address().port;
const origin = `http://127.0.0.1:${staticPort}`;

class Cdp {
  constructor(socket) {
    this.socket = socket;
    this.sequence = 0;
    this.waiting = new Map();
    this.events = [];
    socket.addEventListener("message", ({ data }) => {
      const message = JSON.parse(data);
      if (message.id) {
        const waiter = this.waiting.get(message.id);
        if (!waiter) return;
        this.waiting.delete(message.id);
        if (message.error) waiter.reject(new Error(`${message.error.message} (${message.error.code})`));
        else waiter.resolve(message.result);
      } else this.events.push(message);
    });
  }
  call(method, params = {}) {
    const id = ++this.sequence;
    this.socket.send(JSON.stringify({ id, method, params }));
    return new Promise((resolveCall, reject) => this.waiting.set(id, { resolve: resolveCall, reject }));
  }
  async evaluate(expression) {
    const result = await this.call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || "Runtime evaluation failed");
    return result.result.value;
  }
  close() { this.socket.close(); }
}

async function connectCdp(debugPort) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
      const page = targets.find((target) => target.type === "page");
      if (!page) throw new Error("No page target");
      const socket = new WebSocket(page.webSocketDebuggerUrl);
      await new Promise((resolveOpen, reject) => {
        socket.addEventListener("open", resolveOpen, { once: true });
        socket.addEventListener("error", reject, { once: true });
      });
      return new Cdp(socket);
    } catch {
      await sleep(80);
    }
  }
  throw new Error("Timed out waiting for Chrome DevTools");
}

const profile = await mkdtemp(resolve(tmpdir(), "traqen-f006-ux-"));
const debugPort = await freePort();
const chrome = spawn(chromePath, [
  "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", "--hide-scrollbars",
  "--remote-allow-origins=*", `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`, "about:blank",
], { stdio: ["ignore", "ignore", "pipe"] });
let chromeStderr = "";
chrome.stderr.on("data", (chunk) => { chromeStderr += chunk.toString(); });

let cdp;
try {
  cdp = await connectCdp(debugPort);
  await cdp.call("Page.enable");
  await cdp.call("Runtime.enable");
  await cdp.call("Log.enable");

  async function settle() {
    await sleep(120);
    await cdp.evaluate("document.fonts.ready.then(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))");
  }
  async function setViewport(width, height) {
    await cdp.call("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false, screenWidth: width, screenHeight: height });
  }
  async function clearFixtureStorage() {
    await cdp.call("Storage.clearDataForOrigin", { origin, storageTypes: "all" });
  }
  async function go(scene, theme, width, height, clear = true) {
    await setViewport(width, height);
    if (clear) await clearFixtureStorage();
    await cdp.call("Page.navigate", { url: `${origin}/prototype.html?render=${randomUUID()}#${scene}` });
    await settle();
    await cdp.evaluate(`window.__f006UX.applyTheme(${JSON.stringify(theme)})`);
    await cdp.evaluate("sessionStorage.removeItem('traqen-f006-ux-scroll'); scrollTo(0, 0)");
    await settle();
  }
  async function capture(name, scene, theme, width, height) {
    const layout = await cdp.evaluate(`(() => {
      const boxes = [...document.querySelectorAll('button,input,select,.panel')].map((element) => {
        const rect = element.getBoundingClientRect();
        return { tag: element.tagName, left: rect.left, right: rect.right, width: rect.width };
      });
      return {
        scene: window.__f006UX.state.scene,
        theme: document.documentElement.dataset.theme,
        desktopLayout: window.__f006UX.state.desktopLayout,
        stage: (() => { const rect = document.querySelector('[data-testid=logical-stage]').getBoundingClientRect(); return { left: rect.left, top: rect.top, width: rect.width, height: rect.height }; })(),
        h1Count: document.querySelectorAll('h1').length,
        pageOverflow: document.documentElement.scrollWidth > innerWidth,
        outOfViewportX: boxes.filter((box) => box.left < -1 || box.right > innerWidth + 1),
        scrollY,
        title: document.querySelector('h1')?.textContent,
      };
    })()`);
    assert.equal(layout.scene, scene, `${name}: expected fixture scene`);
    assert.equal(layout.theme, theme, `${name}: expected theme`);
    assert.equal(layout.h1Count, 1, `${name}: exactly one page h1`);
    assert.equal(layout.pageOverflow, false, `${name}: page-level horizontal overflow`);
    assert.equal(layout.outOfViewportX.length, 0, `${name}: controls or panels overflow horizontally`);
    assert.equal(layout.scrollY, 0, `${name}: screenshot starts at the top of its page`);
    const expectsDesktopScale = width >= 1440 && height >= 900;
    const expectedScale = expectsDesktopScale ? Math.min(width / 1440, height / 900) : 1;
    assert.equal(layout.desktopLayout.mode, expectsDesktopScale ? "desktop" : "accessibility", `${name}: expected desktop or accessibility layout mode`);
    assert.ok(Math.abs(layout.desktopLayout.scale - expectedScale) < .000001, `${name}: expected uniform desktop scale`);
    assert.ok(Math.abs(layout.stage.width - (expectsDesktopScale ? 1440 * expectedScale : width)) < 1, `${name}: stage width matches its layout mode`);
    const capture = await cdp.call("Page.captureScreenshot", { format: "png", captureBeyondViewport: false, fromSurface: true });
    const output = resolve(previews, `${name}.png`);
    const bytes = Buffer.from(capture.data, "base64");
    await writeFile(output, bytes);
    report.screens.push({ file: `previews/${basename(output)}`, scene, theme, width, height, title: layout.title, logicalCanvas: layout.desktopLayout.canvas, scale: layout.desktopLayout.scale, layoutMode: layout.desktopLayout.mode, margin: layout.desktopLayout.margin, browserZoom: layout.desktopLayout.browserZoom, deviceScaleFactor: layout.desktopLayout.deviceScaleFactor, sha256: createHash("sha256").update(bytes).digest("hex") });
  }
  async function snapshot(name, scene, theme, width, height) {
    await go(scene, theme, width, height);
    await capture(name, scene, theme, width, height);
  }
  async function snapshotLifecycleDialog(name, theme) {
    await go("lifecycle", theme, 1440, 900);
    await cdp.evaluate("document.querySelector('#open-lifecycle').click()");
    await settle();
    assert.equal(await cdp.evaluate("document.querySelector('#lifecycle-dialog').open"), true, `${name}: lifecycle confirmation must be open`);
    await capture(name, "lifecycle", theme, 1440, 900);
    await cdp.evaluate("document.querySelector('#lifecycle-dialog').close()");
  }
  async function snapshotLegacyAuthorization() {
    await go("capabilities", "light", 1440, 900);
    await cdp.evaluate("document.querySelector('[data-action=open-legacy-issue]').click()");
    await settle();
    assert.equal(await cdp.evaluate("window.__f006UX.state.scene"), "team");
    assert.equal(await cdp.evaluate("Boolean(document.querySelector('[data-testid=legacy-authorization]'))"), true);
    await capture("08-legacy-authorization-light", "team", "light", 1440, 900);
  }

  const shots = [
    ["01-empty-light", "empty", "light", 1440, 900],
    ["02-accounts-light", "accounts", "light", 1440, 900],
    ["02-accounts-dark", "accounts", "dark", 1440, 900],
    ["03-models-dark", "models", "dark", 1440, 900],
    ["03-models-light", "models", "light", 1440, 900],
    ["03-skills-dark", "skills", "dark", 1440, 900],
    ["03-skills-light", "skills", "light", 1440, 900],
    ["04-team-laptop-light", "team", "light", 1440, 900],
    ["05-team-laptop-dark", "team", "dark", 1440, 900],
    ["06-team-display-light", "team", "light", 2560, 1440],
    ["07-team-display-dark", "team", "dark", 2560, 1440],
    ["08-capabilities-light", "capabilities", "light", 1440, 900],
    ["09-conflict-light", "conflict", "light", 1440, 900],
    ["10-conflict-dark", "conflict", "dark", 1440, 900],
    ["13-mcp-dark", "mcp", "dark", 1440, 900],
    ["13-mcp-light", "mcp", "light", 1440, 900],
    ["14-versions-light", "versions", "light", 1440, 900],
    ["15-f003-dark", "f003", "dark", 1440, 900],
    ["16-team-compact-light", "team", "light", 1280, 800],
    ["17-team-external-dark", "team", "dark", 1920, 1080],
  ];
  for (const args of shots) await snapshot(...args);
  await snapshotLegacyAuthorization();
  await snapshotLifecycleDialog("11-lifecycle-confirm-light", "light");
  await snapshotLifecycleDialog("12-lifecycle-confirm-dark", "dark");
  report.checks.push("All S01–S10 fixture scenes rendered with one h1 and no page/control horizontal overflow; error forms, conflict recovery, lifecycle dialog, and MCP paused states each include recorded porcelain and graphite evidence.");
  report.checks.push("S04 uses one 1440×900 logical canvas: 1440×900 renders at 1×, 1920×1080 at 1.2× with 96px side margins, and 2560×1440 at 1.6× with 128px side margins; ordinary 1400×860 and 1280×800 windows retain the 1× floor as accessibility-space checks rather than a second desktop design.");

  // F005 AppShell alignment and state honesty: fixture controls stay outside the product shell;
  // cards and their inspector checkboxes read from the same skill configuration.
  await go("team", "light", 1440, 900);
  const shellResult = await cdp.evaluate(`(() => {
    const cardIds = [...document.querySelectorAll('[data-agent]')].map((card) => card.dataset.agent);
    const skillCounts = {};
    for (const id of cardIds) {
      document.querySelector('[data-agent="' + id + '"]').click();
      skillCounts[id] = {
        card: Number(document.querySelector('[data-agent="' + id + '"]').dataset.skillCount),
        checked: document.querySelectorAll('.grant-list input:checked').length,
      };
    }
    const toolbar = document.querySelector('[data-testid=product-toolbar]')?.textContent || '';
    const sidebar = document.querySelector('.side')?.textContent || '';
    const productShell = document.querySelector('.shell')?.textContent || '';
    return {
      toolbar,
      sidebar,
      productShell,
      skillCounts,
      fixtureOutsideShell: !document.querySelector('[data-testid=fixture-tools]')?.closest('.shell'),
      workspaceSettingsNav: Boolean(document.querySelector('[data-testid=workspace-settings-nav]')),
      draftSavedVisible: Boolean(document.querySelector('[data-testid=draft-saved]')?.offsetParent),
    };
  })()`);
  assert.equal(shellResult.fixtureOutsideShell, true);
  assert.equal(shellResult.workspaceSettingsNav, true);
  assert.equal(shellResult.draftSavedVisible, true);
  assert.match(shellResult.sidebar, /最近查看/);
  assert.match(shellResult.sidebar, /帮助与快捷键/);
  assert.match(shellResult.sidebar, /Sky/);
  assert.doesNotMatch(shellResult.toolbar, /设计演示数据|不连接 API|F006/);
  assert.doesNotMatch(shellResult.productShell, /设计演示数据|隔离 fixture|隔离环境/);
  for (const [id, counts] of Object.entries(shellResult.skillCounts)) {
    assert.equal(counts.checked, counts.card, `${id}: displayed Skill count must match checked explicit grants`);
  }
  report.checks.push("F005-aligned AppShell exposes icon navigation, recent views, help and account footer; fixture controls remain outside the shell, Workspace subnavigation and visible saved-draft status remain inside, and each Agent's Skill count matches its explicit checked grants.");

  // One logical desktop canvas: normal desktop screenshots must normalize to the same layout and pointer targets.
  async function geometryFor(width, height) {
    await go("team", "light", width, height);
    return cdp.evaluate(`(() => {
      const stage = document.querySelector('[data-testid=logical-stage]').getBoundingClientRect();
      const scale = window.__f006UX.state.desktopLayout.scale;
      const normalize = (selector) => { const rect = document.querySelector(selector).getBoundingClientRect(); return { left: (rect.left - stage.left) / scale, top: (rect.top - stage.top) / scale, width: rect.width / scale, height: rect.height / scale }; };
      return { layout: window.__f006UX.state.desktopLayout, stage: { left: stage.left, width: stage.width, height: stage.height }, text: document.querySelector('.shell').textContent, normalized: { sidebar: normalize('.side'), child2: normalize('[data-testid=agent-child-2]'), apply: normalize('[data-testid=apply-config]') } };
    })()`);
  }
  const masterGeometry = await geometryFor(1440, 900);
  for (const [width, height, scale, margin] of [[1920, 1080, 1.2, 96], [2560, 1440, 1.6, 128]]) {
    const candidate = await geometryFor(width, height);
    assert.equal(candidate.layout.mode, "desktop");
    assert.ok(Math.abs(candidate.layout.scale - scale) < .000001);
    assert.ok(Math.abs(candidate.stage.left - margin) < 1);
    assert.equal(candidate.text, masterGeometry.text);
    for (const key of Object.keys(masterGeometry.normalized)) {
      for (const measure of ["left", "top", "width", "height"]) assert.ok(Math.abs(candidate.normalized[key][measure] - masterGeometry.normalized[key][measure]) < 1, `${width} ${key} ${measure}: normalized layout differs from master canvas`);
    }
  }
  const child2Point = await cdp.evaluate(`(() => { const rect = document.querySelector('[data-testid=agent-child-2]').getBoundingClientRect(); return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, hit: document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)?.closest('[data-agent]')?.dataset.agent }; })()`);
  assert.equal(child2Point.hit, "child-2");
  await cdp.call("Input.dispatchMouseEvent", { type: "mousePressed", x: child2Point.x, y: child2Point.y, button: "left", clickCount: 1 });
  await cdp.call("Input.dispatchMouseEvent", { type: "mouseReleased", x: child2Point.x, y: child2Point.y, button: "left", clickCount: 1 });
  await settle();
  assert.equal(await cdp.evaluate("window.__f006UX.state.selected"), "child-2");
  await go("models", "light", 2560, 1440);
  const skillPoint = await cdp.evaluate(`(() => { const button = document.querySelector('[data-scene=skills]'); const rect = button.getBoundingClientRect(); return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, hit: document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)?.closest('[data-scene]')?.dataset.scene }; })()`);
  assert.equal(skillPoint.hit, "skills");
  await cdp.call("Input.dispatchMouseEvent", { type: "mousePressed", x: skillPoint.x, y: skillPoint.y, button: "left", clickCount: 1 });
  await cdp.call("Input.dispatchMouseEvent", { type: "mouseReleased", x: skillPoint.x, y: skillPoint.y, button: "left", clickCount: 1 });
  await settle();
  assert.equal(await cdp.evaluate("window.__f006UX.state.scene"), "skills");
  await go("lifecycle", "light", 2560, 1440);
  const dialogPoint = await cdp.evaluate(`(() => { const button = document.querySelector('#open-lifecycle'); const rect = button.getBoundingClientRect(); return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, hit: document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)?.id }; })()`);
  assert.equal(dialogPoint.hit, "open-lifecycle");
  await cdp.call("Input.dispatchMouseEvent", { type: "mousePressed", x: dialogPoint.x, y: dialogPoint.y, button: "left", clickCount: 1 });
  await cdp.call("Input.dispatchMouseEvent", { type: "mouseReleased", x: dialogPoint.x, y: dialogPoint.y, button: "left", clickCount: 1 });
  await settle();
  const dialogScale = await cdp.evaluate("({open:document.querySelector('#lifecycle-dialog').open, width:document.querySelector('#lifecycle-dialog').getBoundingClientRect().width, focus:document.activeElement.id})");
  assert.equal(dialogScale.open, true);
  assert.ok(Math.abs(dialogScale.width - 520 * 1.6) < 3, "dialog scales with the desktop canvas");
  assert.equal(dialogScale.focus, "confirm-name");
  await cdp.evaluate("document.querySelector('#lifecycle-dialog').close()");
  for (const [width, height] of [[1400, 860], [1280, 800]]) {
    await go("team", "light", width, height);
    const accessibilitySpace = await cdp.evaluate(`(() => ({
      layout: window.__f006UX.state.desktopLayout,
      font: getComputedStyle(document.querySelector('.agent-card')).fontSize,
      applyDisabled: document.querySelector('[data-testid=apply-config]').disabled,
      pageOverflow: document.documentElement.scrollWidth > innerWidth,
      offscreenControls: [...document.querySelectorAll('button,input,select,.panel')].filter((element) => {
        const rect = element.getBoundingClientRect();
        return rect.left < -1 || rect.right > innerWidth + 1;
      }).length,
      documentScrollHeight: document.documentElement.scrollHeight,
    }))()`);
    assert.equal(accessibilitySpace.layout.mode, "accessibility", `${width}×${height}: small-window layout mode`);
    assert.equal(accessibilitySpace.layout.scale, 1, `${width}×${height}: scale must not fall below 1`);
    assert.equal(accessibilitySpace.font, "13px", `${width}×${height}: readable Agent-card text`);
    assert.equal(accessibilitySpace.applyDisabled, false, `${width}×${height}: primary action stays available`);
    assert.equal(accessibilitySpace.pageOverflow, false, `${width}×${height}: no horizontal page overflow`);
    assert.equal(accessibilitySpace.offscreenControls, 0, `${width}×${height}: no horizontally clipped controls`);
    assert.ok(accessibilitySpace.documentScrollHeight > height, `${width}×${height}: overflow remains reachable by document scrolling`);
    report.smallWindowChecks.push({ viewport: { width, height }, ...accessibilitySpace });
  }
  report.checks.push("The 1440×900 logical canvas normalizes identically at 1920×1080 (1.2×) and 2560×1440 (1.6×), including content, relative layout, pointer hit targets, focus, navigation and dialog scale; ordinary 1400×860 and 1280×800 windows retain the 1× floor, readable 13px controls, available primary action, no horizontal clipping, and reachable document scrolling.");

  // Global configuration pages share real product navigation; model and Skill do not collapse into one work surface.
  for (const scene of ["accounts", "models", "skills", "mcp"]) {
    await go(scene, "light", 1440, 900);
    const globalNav = await cdp.evaluate(`(() => ({
      labels: [...document.querySelectorAll('[data-testid=global-settings-nav] button')].map((button) => button.textContent.trim()),
      active: document.querySelector('[data-testid=global-settings-nav] button[aria-current=page]')?.dataset.scene,
      shell: document.querySelector('.shell')?.textContent || '',
    }))()`);
    assert.deepEqual(globalNav.labels, ["账号", "模型", "Skill", "MCP · 已暂停"]);
    assert.equal(globalNav.active, scene);
    assert.doesNotMatch(globalNav.shell, /设计演示数据|隔离 fixture/);
  }
  report.checks.push("Accounts, models, Skill, and paused MCP use one in-shell global secondary navigation; models and Skill are independently addressable product pages.");

  await go("empty", "light", 1440, 900);
  const emptyResult = await cdp.evaluate(`(() => ({
    placeholders: ['main', 'child-1'].every((id) => Boolean(document.querySelector('[data-testid="empty-' + id + '"]'))),
    apply: [...document.querySelectorAll('button')].some((button) => button.textContent.includes('应用配置')),
  }))()`);
  assert.equal(emptyResult.placeholders, true);
  assert.equal(emptyResult.apply, false);
  report.checks.push("The empty state remains in the Agent-team configuration surface with real Main and Child 1 placeholders, zero implicit model or Skill grants, and no available Apply action.");

  await go("team", "light", 1440, 900);
  const readyTeam = await cdp.evaluate(`(() => ({
    allReady: [...document.querySelectorAll('[data-agent]')].every((card) => card.textContent.includes('就绪')),
    applyEnabled: !document.querySelector('[data-testid=apply-config]').disabled,
  }))()`);
  assert.deepEqual(readyTeam, { allReady: true, applyEnabled: true });
  report.checks.push("The normal S04 fixture keeps every displayed Agent ready when Apply is enabled; unavailable legacy authorization is isolated to its own actionable Child 1 state.");

  // Theme, selection, and refresh recovery — presentation actions are not business writes.
  await go("team", "light", 1440, 900);
  await cdp.evaluate("document.querySelector('[data-testid=agent-child-2]').click()");
  await settle();
  const writesBeforeTheme = await cdp.evaluate("window.__f006UX.getWriteCount()");
  await cdp.evaluate("document.querySelector('[data-theme-choice=dark]').click()");
  const preservedAfterTheme = await cdp.evaluate("({theme:document.documentElement.dataset.theme, selected:window.__f006UX.state.selected, writes:window.__f006UX.getWriteCount()})");
  assert.deepEqual(preservedAfterTheme, { theme: "dark", selected: "child-2", writes: writesBeforeTheme });
  await cdp.call("Page.reload", { ignoreCache: true });
  await settle();
  const preservedAfterRefresh = await cdp.evaluate("({theme:document.documentElement.dataset.theme, selected:window.__f006UX.state.selected})");
  assert.deepEqual(preservedAfterRefresh, { theme: "dark", selected: "child-2" });
  report.checks.push("Theme toggle and refresh preserve the selected Child; theme presentation records zero business writes.");

  // Scope sentinel: Child 2's edit changes only Child 2 and leaves Main / another Workspace untouched.
  await cdp.evaluate("document.querySelector('#agent-model').value='gpt-5.6-sol · medium'; document.querySelector('#agent-model').dispatchEvent(new Event('change',{bubbles:true}))");
  await settle();
  const scopeResult = await cdp.evaluate("({child2:window.__f006UX.state.child2Model, sentinels:window.__f006UX.sentinels, writes:window.__f006UX.getBusinessLog()})");
  assert.equal(scopeResult.child2, "gpt-5.6-sol");
  assert.equal(scopeResult.sentinels.mainModel, "gpt-5.6-sol");
  assert.equal(scopeResult.sentinels.otherWorkspace, "billing-workspace-unchanged");
  assert.equal(scopeResult.writes.length, 1);
  report.checks.push("Changing Child 2 creates one fixture draft write and leaves the Main and another-Workspace sentinels unchanged.");

  // M2 409 recovery: M3 does not write during conflict; retry confirms M2 then writes M3 once; Apply stays blocked.
  await go("conflict", "light", 1440, 900);
  const conflictProduct = await cdp.evaluate("document.querySelector('.shell').textContent");
  assert.doesNotMatch(conflictProduct, /M2|M3|PUT|模拟事件日志/);
  const conflictInitial = await cdp.evaluate("({writes:window.__f006UX.getBusinessLog(), apply:document.querySelector('[data-testid=conflict-apply]').disabled})");
  assert.equal(conflictInitial.writes.length, 1);
  assert.match(conflictInitial.writes[0].detail, /M2.*409/);
  assert.equal(conflictInitial.apply, true);
  await cdp.evaluate("const input=document.querySelector('#m3-note'); input.value='M3 后续说明'; input.dispatchEvent(new Event('input',{bubbles:true}))");
  assert.equal(await cdp.evaluate("window.__f006UX.getWriteCount()"), 1);
  await cdp.evaluate("document.querySelector('[data-testid=conflict-retry]').click()");
  await settle();
  const conflictRecovered = await cdp.evaluate("window.__f006UX.getBusinessLog()");
  assert.equal(conflictRecovered.length, 3);
  assert.match(conflictRecovered[1].detail, /M2.*200/);
  assert.match(conflictRecovered[2].detail, /M3.*一次/);
  assert.equal(conflictRecovered.filter((event) => event.type === "activation").length, 0);
  report.checks.push("Fixture M2 409 → M3 local edit → retry produces exactly M2(409), M2(200), M3(200): no conflict-period extra PUT and no activation request.");

  await go("versions", "light", 1440, 900);
  const versionsResult = await cdp.evaluate(`(() => ({
    applyText: [...document.querySelectorAll('button')].some((button) => button.textContent.includes('应用配置')),
    teamLinks: document.querySelectorAll('[data-scene=team]').length,
    activeChild2: [...document.querySelectorAll('.key-value')].find((row) => row.textContent.includes('Child 2'))?.textContent,
    draftChild2: document.querySelector('.versions aside')?.textContent,
  }))()`);
  assert.equal(versionsResult.applyText, false);
  assert.ok(versionsResult.teamLinks >= 2);
  assert.match(versionsResult.activeChild2, /gpt-5\.6-sol.*1 项 Skill/);
  assert.match(versionsResult.draftChild2, /gpt-5\.6-sol → gpt-5\.6-terra/);
  assert.match(versionsResult.draftChild2, /合计 2 项 Skill/);
  report.checks.push("The active-version view is read-only with no Apply action; its Child 2 baseline and the later model/Skill draft delta are explicitly paired with a return-to-team editing path.");

  // Lifecycle cancel and focus return do not write a business change.
  await go("lifecycle", "dark", 1440, 900);
  await cdp.evaluate("window.__f006UX.resetLogs(); document.querySelector('#open-lifecycle').click()");
  await cdp.evaluate("document.querySelector('#dialog-cancel').click()");
  await sleep(20);
  const cancelResult = await cdp.evaluate("({writes:window.__f006UX.getWriteCount(), open:document.querySelector('#lifecycle-dialog').open, focus:document.activeElement.id})");
  assert.deepEqual(cancelResult, { writes: 0, open: false, focus: "open-lifecycle" });
  report.checks.push("Lifecycle cancel closes the named dialog, restores focus to its invoker, and records zero fixture business writes.");

  // Keyboard focus is available on native controls; Escape closes a dialog rather than trapping focus.
  await cdp.evaluate("document.querySelector('#open-lifecycle').focus()");
  assert.equal(await cdp.evaluate("document.activeElement.id"), "open-lifecycle");
  await cdp.evaluate("document.querySelector('#open-lifecycle').click()");
  await sleep(20);
  assert.equal(await cdp.evaluate("document.querySelector('#lifecycle-dialog').open"), true);
  await cdp.call("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await cdp.call("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await sleep(20);
  assert.equal(await cdp.evaluate("document.querySelector('#lifecycle-dialog').open"), false);
  report.checks.push("Native buttons, inputs, selects, and dialogs expose keyboard focus; keyboard Escape closes the impact dialog without a focus trap.");

  report.pageErrors = cdp.events
    .filter((event) => event.method === "Log.entryAdded" && event.params.entry.level === "error")
    .map((event) => event.params.entry.text);
  assert.equal(report.pageErrors.length, 0, `browser console errors: ${report.pageErrors.join(" | ")}`);
  report.browser = await cdp.evaluate("navigator.userAgent");
  await writeFile(resolve(here, "verification.json"), `${JSON.stringify(report, null, 2)}\n`);
  const sums = [`${sourceSha256}  prototype.html`, ...report.screens.map((screen) => `${screen.sha256}  ${screen.file}`)].join("\n") + "\n";
  await writeFile(resolve(here, "SHA256SUMS"), sums);
  console.log(JSON.stringify({ result: "PASS", screens: report.screens.length, checks: report.checks.length, pageErrors: report.pageErrors.length }));
} finally {
  cdp?.close();
  if (chrome.exitCode === null) {
    chrome.kill("SIGTERM");
    await Promise.race([once(chrome, "exit"), sleep(1500)]);
  }
  staticServer.closeAllConnections();
  await new Promise((resolveClose) => staticServer.close(resolveClose));
  await rm(profile, { recursive: true, force: true, maxRetries: 4, retryDelay: 120 });
  if (chromeStderr.includes("FATAL")) console.error(chromeStderr);
}
