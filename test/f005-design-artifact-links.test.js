import assert from "node:assert/strict";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const assets = fileURLToPath(new URL("../docs/design-reviews/F005/assets/", import.meta.url));

test("F005 published HTML has no missing local navigation or image targets", async () => {
  const files = (await readdir(assets)).filter((name) => name.endsWith(".html"));
  assert.ok(files.length > 0, "expected published HTML artifacts");
  const missing = [];
  let checked = 0;
  for (const file of files) {
    const html = await readFile(path.join(assets, file), "utf8");
    // Include literal links in client-rendered templates as well as static markup.
    // Same-page fragments, external URLs and interpolated routes are not local files.
    for (const [, href] of html.matchAll(/\b(?:href|src)=["']([^"']+)["']/g)) {
      if (/^(?:#|[a-z][a-z\d+.-]*:|\/\/)/i.test(href) || href.includes("${")) continue;
      const target = decodeURIComponent(href.split(/[?#]/)[0]);
      if (!target) continue;
      checked += 1;
      const present = await stat(path.resolve(assets, target)).then((entry) => entry.isFile()).catch(() => false);
      if (!present) missing.push(`${file} → ${href}`);
    }
  }
  assert.ok(checked > 0, "expected at least one local link");
  assert.deepEqual(missing, [], "all published HTML links must also work when opened directly");
});
