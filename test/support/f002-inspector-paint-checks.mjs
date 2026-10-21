import assert from "node:assert/strict";

// Measure the real restored scroll container; never change its styles or scroll.
export async function verifyInspectorHeaderPaint(page, report) {
  const state = report.inspectorPaint = await page.locator(".f002-detail").evaluate(panel => {
    const header = panel.querySelector(":scope > header"), box = panel.getBoundingClientRect(), h = header.getBoundingClientRect();
    const style = getComputedStyle(panel), headerStyle = getComputedStyle(header);
    const scrollport = { left: box.left + panel.clientLeft, top: box.top + panel.clientTop, right: box.right - panel.clientLeft };
    const hits = [], leaking = [];
    if (h.top > scrollport.top) {
      const walker = document.createTreeWalker(panel, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const text = walker.currentNode;
        if (header.contains(text) || !text.textContent.trim()) continue;
        const range = document.createRange(); range.selectNodeContents(text);
        for (const rect of range.getClientRects()) {
          const left = Math.max(rect.left, scrollport.left), right = Math.min(rect.right, scrollport.right);
          const top = Math.max(rect.top, scrollport.top), bottom = Math.min(rect.bottom, h.top);
          if (right <= left || bottom <= top) continue;
          const hit = document.elementFromPoint((left + right) / 2, (top + bottom) / 2);
          leaking.push({ text: text.textContent.trim().slice(0, 160), rect: { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom }, hit: hit?.tagName ?? null, hitIsHeader: Boolean(hit && header.contains(hit)) });
        }
      }
      for (const fraction of [.25, .5, .75]) {
        const hit = document.elementFromPoint(scrollport.left + (scrollport.right - scrollport.left) * fraction, (scrollport.top + h.top) / 2);
        hits.push({ tag: hit?.tagName ?? null, text: hit?.textContent?.trim().slice(0, 160) ?? "", isHeader: Boolean(hit && header.contains(hit)) });
      }
    }
    return { scrollTop: panel.scrollTop, paddingTop: style.paddingTop, viewport: { width: innerWidth, height: innerHeight }, scrollport, header: { top: h.top, bottom: h.bottom, left: h.left, right: h.right, position: headerStyle.position, insetTop: headerStyle.top, background: headerStyle.backgroundColor }, gap: h.top - scrollport.top, leaking, hits };
  });
  assert.equal(state.header.position, "sticky");
  assert.ok(state.scrollTop > 0, "paint acceptance requires the actual independently scrolled Inspector");
  assert.ok(state.gap <= 0, "sticky Inspector header must cover the scrollport start; body paint cannot escape above it");
  assert.deepEqual(state.leaking, [], "no body text may paint in a gap above the Inspector header");
}
