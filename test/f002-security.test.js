import assert from "node:assert/strict";
import test from "node:test";

import { assertSafeMediaType, redactDisplayBytes } from "../src/deterministic-facts/policy.js";

test("F002 presentation policy refuses active documents and never makes a client-selected secret visible", () => {
  for (const mediaType of ["image/svg+xml", "text/html", "application/xml", "text/xml"]) {
    assert.throws(() => assertSafeMediaType(mediaType), { code: "F002_CONTENT_TYPE_RESTRICTED" });
  }
  const displayed = redactDisplayBytes(Buffer.from("token=correct-horse-battery-staple\nname=orders\n", "utf8"));
  assert.equal(displayed.bytes.toString("utf8").includes("correct-horse-battery-staple"), false);
  assert.equal(displayed.transform, "CONFIG_SECRET_VALUE_REDACTION");
});
