#!/usr/bin/env node

import process from "node:process";

import { qualityGateExitCode } from "../domain/index.js";

function argument(name) {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1 || !process.argv[index + 1]) throw new Error(`--${name} is required`);
  return process.argv[index + 1];
}

const baseUrl = argument("base-url").replace(/\/$/, "");
const projectId = argument("project");
const changeSetId = argument("change-set");
const token = process.env.TRAQEN_PROGRAM_TOKEN ?? "";
const headers = token ? { authorization: `Bearer ${token}`, accept: "application/json" } : { accept: "application/json" };

try {
  if(!token)throw new Error("TRAQEN_PROGRAM_TOKEN is required; shared deployment tokens no longer authorize CI");
  const response = await fetch(
    `${baseUrl}/v1/projects/${encodeURIComponent(projectId)}/change-sets/${encodeURIComponent(changeSetId)}/continuous-protection`,
    { headers, signal: AbortSignal.timeout(15000) },
  );
  const body = await response.json();
  if (!response.ok) throw new Error(body?.error?.message ?? `Traqen API returned ${response.status}`);
  process.stdout.write(`${JSON.stringify(body, null, 2)}\n`);
  process.exitCode = qualityGateExitCode(body);
} catch (error) {
  process.stderr.write(`${error.stack ?? error.message}\n`);
  process.exitCode = 3;
}
