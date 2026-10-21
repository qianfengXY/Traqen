import assert from "node:assert/strict";
import path from "node:path";

function rgba(value) {
  const match = /^rgba?\(([^)]+)\)$/.exec(value);
  assert.ok(match, `unsupported computed color ${value}`);
  const channels = match[1].split(/,\s*/).map(Number);
  assert.ok([3, 4].includes(channels.length) && channels.every(Number.isFinite));
  assert.ok(channels.slice(0, 3).every(channel => channel >= 0 && channel <= 255));
  const alpha = channels[3] ?? 1;
  assert.ok(alpha >= 0 && alpha <= 1);
  return [...channels.slice(0, 3), alpha];
}
const over = (front, back) => front.slice(0, 3).map((value, index) => value * front[3] + back[index] * (1 - front[3]));
const luminance = rgb => rgb.map(channel => channel / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4)
  .reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
export function buttonTextContrast(row) {
  assert.equal(row.rendered, true, "contrast requires painted text, not a closed disclosure's skipped style");
  assert.ok(row.backgrounds.length > 0 && row.opacity.every(value => value === 1), "diagnostic requires opaque compositing groups");
  assert.ok(row.images.every(value => value === "none"), "do not infer contrast through an unmeasured image");
  const background = row.backgrounds.toReversed().reduce((back, color) => over(rgba(color), back), [255, 255, 255]);
  const foreground = over(rgba(row.color), background), values = [luminance(foreground), luminance(background)].sort((a, b) => a - b);
  return (values[1] + .05) / (values[0] + .05);
}

export async function settleWorkbenchTheme(page, theme, diagnostics = []) {
  await page.waitForFunction(theme => document.documentElement.dataset.theme === theme, theme);
  const receipt = await page.locator(".f002-workbench .button").evaluateAll(async nodes => {
    for (const node of nodes) getComputedStyle(node).backgroundColor;
    const snapshot = () => document.getAnimations().map(animation => {
      const target = animation.effect?.target, timing = animation.effect?.getComputedTiming();
      return { type: animation.constructor.name, property: animation.transitionProperty ?? null, name: animation.animationName ?? null,
        state: animation.playState, pending: animation.pending, currentTime: animation.currentTime, startTime: animation.startTime,
        target: target ? { tag: target.tagName, class: target.className, text: target.textContent?.trim().slice(0, 80), rendered: target.checkVisibility() } : null,
        iterations: timing ? String(timing.iterations) : null, endTime: timing ? String(timing.endTime) : null };
    });
    const paint = () => nodes.filter(node => node.checkVisibility()).map(node => {
      const layers = [];
      for (let current = node; current; current = current.parentElement) {
        const style = getComputedStyle(current);
        layers.push([style.color, style.backgroundColor, style.borderColor, style.opacity, style.backgroundImage]);
      }
      return { text: node.textContent?.trim(), layers };
    });
    const before = snapshot();
    let timer, frame, frames = 0, stableFrames = 0, previousPaint = null, afterPaint = [];
    try {
      const settled = await new Promise(resolve => {
        timer = setTimeout(() => resolve(false), 5000);
        const tick = () => {
          frames++;
          afterPaint = paint();
          // Historical finished promises can outlive the animation's document
          // membership. Observe current activity on every real frame instead.
          const active = snapshot().some(animation => animation.pending || ["running", "paused"].includes(animation.state));
          const currentPaint = JSON.stringify(afterPaint);
          stableFrames = !active && afterPaint.length > 0 ? (currentPaint === previousPaint ? stableFrames + 1 : 1) : 0;
          previousPaint = active ? null : currentPaint;
          if (stableFrames >= 2) resolve(true);
          else frame = requestAnimationFrame(tick);
        };
        frame = requestAnimationFrame(tick);
      });
      return { settled, before, after: snapshot(), frames, stableFrames, afterPaint };
    } finally { clearTimeout(timer); cancelAnimationFrame(frame); }
  });
  diagnostics.push({ theme, ...receipt });
  assert.equal(receipt.settled, true, "theme animation wait did not settle within its diagnostic bound; inspect recorded animations");
}

export async function verifyThemeContrast({ page, metadata, directory, report }) {
  const fixed = page.url();
  const proof = report.themeContrast = { conditions: [], posted: [], temporaryProbe: false, accepted: false };
  page.on("request", request => {
    const pathname = new URL(request.url()).pathname;
    if (pathname.startsWith("/v1/workspaces/workspace/deterministic-facts") && !["GET", "OPTIONS"].includes(request.method())) proof.posted.push({ method: request.method(), pathname });
  });
  const memberPanel = page.locator("details.f002-auth");
  if (!await memberPanel.evaluate(node => node.open)) await memberPanel.locator(":scope > summary").click();
  await memberPanel.getByRole("button", { name: "验证并连接", exact: true }).waitFor({ state: "visible" });
  for (const theme of ["light", "dark"]) {
    await page.getByRole("combobox", { name: "全局主题配色", exact: true }).selectOption(theme);
    await settleWorkbenchTheme(page, theme, report.themeSettles ??= []);
    const rows = await page.locator(".f002-workbench .button:not(:disabled)").evaluateAll(nodes => nodes.filter(node => node.checkVisibility()).map(node => {
      const style = getComputedStyle(node), ancestors = [];
      for (let current = node; current; current = current.parentElement) ancestors.push(getComputedStyle(current));
      return { rendered: node.checkVisibility(), text: node.textContent.trim(), classes: node.className, color: style.color, background: style.backgroundColor,
        panel: style.getPropertyValue("--panel").trim(), ink: style.getPropertyValue("--ink").trim(),
        backgrounds: ancestors.map(item => item.backgroundColor), opacity: ancestors.map(item => Number(item.opacity)), images: ancestors.map(item => item.backgroundImage) };
    }));
    assert.ok(rows.length >= 3, "measure actual enabled workbench actions, not a synthetic control");
    assert.ok(rows.some(row => row.text === "验证并连接"), "the member action must be measured after actually opening its disclosure");
    proof.conditions.push({ theme, rows: rows.map(row => ({ ...row, contrast: buttonTextContrast(row) })) });
    assert.equal(page.url(), fixed);
    await page.screenshot({ path: path.join(directory, `button-contrast-${theme}.png`), fullPage: true });
  }
  proof.fixture = await metadata();
  assert.equal(proof.fixture.sourceStable, true); assert.equal(proof.fixture.additionalSourceStable, true);
  assert.equal(proof.fixture.startRunCount, 0); assert.deepEqual(proof.posted, []);
  const failures = proof.conditions.flatMap(condition => condition.rows.filter(row => row.contrast < 4.5).map(row => ({ theme: condition.theme, text: row.text, contrast: row.contrast })));
  assert.deepEqual(failures, [], "enabled ordinary action text must retain at least 4.5:1 contrast");
  proof.accepted = true;
  report.results.push({ case: "two-theme-actual-enabled-workbench-button-text-contrast-without-mutation", passed: true });
}
