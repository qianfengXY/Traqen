#!/usr/bin/env node
import { parseArgs } from "node:util";
import { sourceTruthPilot } from "../../test/support/source-truth-pilot.js";

try {
  const { values } = parseArgs({ options: { "files-per-source": { type: "string" }, "postgres-bin": { type: "string" },
    "max-tree-rss-mib": { type: "string" }, "max-tree-fds": { type: "string" }, help: { type: "boolean" } }, strict: true });
  if (values.help) {
    console.log("Isolated F001 service pilot. Requires --files-per-source 10..50000 --postgres-bin ABSOLUTE --max-tree-rss-mib N --max-tree-fds N. Creates only new fixture directories and a new PostgreSQL cluster; never reads .env or uses existing databases. Retains artifacts. Not browser/disaster-deployment acceptance.");
  } else {
    const result = await sourceTruthPilot({ filesPerSource: Number(values["files-per-source"]), postgresBin: values["postgres-bin"],
      maxTreeRssBytes: Number(values["max-tree-rss-mib"]) * 1024 * 1024, maxTreeFileDescriptors: Number(values["max-tree-fds"]),
      onProgress: (event) => console.log(JSON.stringify(event)) });
    console.log(JSON.stringify(result, (_, value) => typeof value === "bigint" ? String(value) : value));
  }
} catch (error) {
  console.error(JSON.stringify({ status: "FAILED", code: error.code ?? "SOURCE_PILOT_FAILED", message: error.message }));
  process.exitCode = 1;
}
