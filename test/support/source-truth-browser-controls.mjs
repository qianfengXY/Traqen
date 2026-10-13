// User-facing controls shared by isolated acceptance journeys. No test-only
// execution control or fabricated navigation/authorization enters the product.
import assert from "node:assert/strict";
// HTML normalizes :00 seconds away. Playwright fill requires that same
// canonical value, otherwise it throws before dispatching the input event.
export const datetimeLocalValue = date => new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 19).replace(/:00$/, "");
export async function startSource(page, station) {
  const next = page.getByRole("button", { name: "继续配置范围", exact: true });
  if (await next.isVisible()) { await next.click(); await station(2); }
  else await station(2); // A selected baseline enters range configuration.
  await page.getByRole("button", { name: "确认范围并运行预检", exact: true }).click();
}
export async function openSourceVersion(page, id) {
  const back = page.getByRole("button", { name: "返回来源总览", exact: true });
  if (await back.isVisible()) await back.click();
  await page.getByRole("tab", { name: "版本", exact: true }).click();
  const rows = page.locator("#source-version-history .st-history-row");
  await (id ? rows.filter({ hasText: id.slice(0, 12) }) : rows.first()).click();
  await page.locator(".st-version-view").getByRole("heading", { name: id ? `来源包已冻结 · ${id.slice(0, 12)}…` : /^来源包已冻结 · / }).waitFor();
}
export async function acceptSourceGaps(page, reason, expiresAt = new Date(Date.now() + 3600000)) {
  const region = page.getByRole("region", { name: "逐项核对与接受限制", exact: true });
  const rows = region.locator("article");
  await rows.first().waitFor();
  const count = await rows.count();
  assert.ok(count > 0 && count <= 100, "test acceptance page is bounded");
  const local = datetimeLocalValue(expiresAt);
  for (let i = 0; i < count; i++) {
    const row = rows.nth(i), reasonField = row.getByRole("textbox", { name: "接受理由", exact: true });
    const decision = row.locator("details");
    if (await decision.count()) {
      if (await decision.getAttribute("open") === null) await decision.locator("summary").click();
      await reasonField.waitFor();
      await reasonField.fill(reason);
      await row.getByLabel("有效期至（浏览器本地时间）", { exact: true }).fill(local);
      await row.getByRole("button", { name: "接受此限制", exact: true }).click();
      await row.getByText("已接受 · 缺失事实保留", { exact: true }).waitFor();
    }
  }
}
