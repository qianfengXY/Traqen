import assert from "node:assert/strict";
import test from "node:test";
import { browserOrigin } from "./support/source-truth-browser-origin.js";

test("browser fixture accepts a dedicated local Web port, never an external or runtime target", () => {
  assert.equal(browserOrigin("http://127.0.0.1:3190/"), "http://127.0.0.1:3190");
  assert.equal(browserOrigin("http://localhost:3190"), "http://localhost:3190");
  for (const value of ["https://traq.nas.cpolar.cn", "http://example.com:3190", "http://127.0.0.1:3004", "http://127.0.0.1:3100", "http://localhost:3197", "http://user@localhost:3190", "http://localhost:3190/api", "http://localhost:3190/?token=x"]) {
    assert.throws(() => browserOrigin(value), /dedicated loopback Web origin/);
  }
});

test("browser fixture fails closed without an explicit isolated origin", (t) => {
  const prior = process.env.F001_TEST_WEB_ORIGIN;
  t.after(() => { if (prior === undefined) delete process.env.F001_TEST_WEB_ORIGIN; else process.env.F001_TEST_WEB_ORIGIN = prior; });
  delete process.env.F001_TEST_WEB_ORIGIN;
  assert.throws(() => browserOrigin(), /dedicated loopback Web origin/);
});

test("browser fixture rejects deployment and arbitrary loopback ports", () => {
  for (const port of [3188, 3189, 3100, 5432, 3003, 3004, 3197, 6398, 6399, 80]) {
    assert.throws(() => browserOrigin(`http://127.0.0.1:${port}`), /dedicated loopback Web origin/, String(port));
  }
});
