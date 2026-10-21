import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";

function pngSize(buffer) {
  assert.deepEqual(buffer.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  assert.equal(buffer.toString("ascii", 12, 16), "IHDR");
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

// Native browser zoom changes CSS pixels without changing the physical surface.
// Capture that surface without Playwright's CSS-sized legacy-CDP clip. This is
// a viewport image, NOT a full-page image or a replacement for keyboard checks.
export async function captureNativeViewport({ page, cdp, file, dimensions }) {
  const snapshot = async () => ({ dom: await dimensions(page), layout: await cdp.send("Page.getLayoutMetrics"), window: await cdp.send("Browser.getWindowForTarget") });
  const before = await snapshot(), { dom, layout } = before;
  for (const value of [dom.width, dom.height, dom.dpr]) assert.ok(Number.isFinite(value) && value > 0, "finite native viewport dimensions required");
  assert.equal(dom.pinch, 1); assert.equal(dom.applicationScale, 1);
  assert.equal(layout.cssVisualViewport.clientWidth, dom.width);
  assert.equal(layout.cssVisualViewport.clientHeight, dom.height);
  const response = await cdp.send("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false });
  const png = Buffer.from(response.data, "base64"), pixels = pngSize(png), after = await snapshot();
  assert.deepEqual(after, before, "native capture must not change viewport, layout, scroll, zoom or window");
  assert.deepEqual(pixels, { width: Math.round(dom.width * dom.dpr), height: Math.round(dom.height * dom.dpr) }, "whole native viewport pixels required; clipped strips are not evidence");
  await writeFile(file, png, { flag: "wx" });
  return { method: "cdp-no-clip-native-viewport", geometryVerified: true, file, pixels, before, after };
}
