import assert from "node:assert/strict";
import test from "node:test";
import { browserOrigin } from "./support/source-truth-browser-origin.js";

test("browser fixture accepts a dedicated local Web port, never an external or runtime target", () => {
  assert.equal(browserOrigin("http://127.0.0.1:3190/"), "http://127.0.0.1:3190");
  for (const value of ["https://traq.nas.cpolar.cn", "http://example.com:3190", "http://127.0.0.1:3004", "http://127.0.0.1:3100", "http://localhost:3197", "http://user@localhost:3190", "http://localhost:3190/api", "http://localhost:3190/?token=x"]) {
    assert.throws(() => browserOrigin(value), /dedicated loopback Web origin/);
  }
});
