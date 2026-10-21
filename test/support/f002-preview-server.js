import { f002BrowserFixture } from "./f002-browser-fixture.js";

const fixture = await f002BrowserFixture();
process.stdout.write("Owned synthetic F001→F002 PGlite browser fixture: 127.0.0.1:6225. No production/F003 connection.\n");
for (const signal of ["SIGTERM", "SIGINT"]) process.once(signal, () => { void fixture.close(); });
