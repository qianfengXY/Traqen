// Public, synthetic source TEXT only. Never execute this fixture application.
export const acceptanceFilesA = Object.freeze({
  "README.md": "# Technical acceptance\n\n[Guide](docs/guide.md#details)\n[Implementation](src/orders.ts)\n[Unknown](missing.md)\n",
  "src/orders.ts": "export function submit(id: string) { const enabled = process.env.SUBMIT_ENABLED; if (enabled) return db.query('UPDATE orders SET status=$1 WHERE id=$2', [id]); return 10; }\n",
  "src/helper.js": "export function target() { return 1; }\nexport function caller() { return target(); }\n",
  "src/Loop.java": "class Loop { String item; void f(java.util.List<String> items) { for (String item : items) { use(item); } } }\n",
  "config/app.properties": "SUBMIT_ENABLED=true\nAPI_TOKEN=OWNED_FIXTURE_SECRET_NEVER_INDEX\n",
  "db/schema.sql": "CREATE TABLE IF NOT EXISTS orders (id TEXT, status TEXT);\n",
  "test/orders.test.ts": "import test from 'node:test'; import assert from 'node:assert/strict'; import { submit } from '../src/orders.js'; test('conditional submit', () => { assert.equal(submit('id'), null); });\n",
  "test/legacy.test.js": "import test from 'node:test'; import assert from 'node:assert/strict'; test('legacy declaration', () => { assert.equal(1, 1); });\n",
  "reports/results.xml": '<testsuite name="Declared suite"><testcase name="conditional submit" classname="Orders" time="0.1"/></testsuite>\n',
  "docs/guide.md": "# Guide\r\n\r\n说明😀 first line\r\nsecond line\r\n\r\n## Details\r\n[Source](../src/orders.ts)\r\n\r\n[Ambiguous](#duplicate)\r\n# Duplicate\r\n# Duplicate\r\n",
  "docs/opaque.custom": "OWNED_UNSUPPORTED_FORMAT_ORIGINAL_A\n",
});
export const acceptanceFilesB = Object.freeze({
  ...Object.fromEntries(Object.entries(acceptanceFilesA).filter(([name]) => name !== "test/legacy.test.js")),
  "src/orders.ts": acceptanceFilesA["src/orders.ts"].replace("return 10;", "return 20;"),
  "src/added.ts": "export function newlyAdded(value: number) { return value; }\n",
});
