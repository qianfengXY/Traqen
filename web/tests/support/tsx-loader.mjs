// Test-only TSX loader; async module hooks also support the declared Node 22.13 baseline.
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const app = new URL("../../app/", import.meta.url).href;
export function resolve(specifier, context, next) {
  if (context.parentURL?.startsWith(app) && specifier.startsWith(".")) {
    const target = new URL(specifier, context.parentURL);
    for (const suffix of ["", ".ts", ".tsx"]) {
      if (existsSync(fileURLToPath(target.href + suffix))) return { url: target.href + suffix, shortCircuit: true };
    }
  }
  return next(specifier, context);
}
export function load(url, context, next) {
  if (!url.startsWith(app)) return next(url, context);
  if (url.endsWith(".css")) return { format: "module", source: "export {};", shortCircuit: true };
  if (!/\.tsx?$/.test(url)) return next(url, context);
  const source = ts.transpileModule(readFileSync(fileURLToPath(url), "utf8"), {
    fileName: fileURLToPath(url), compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  return { format: "module", source, shortCircuit: true };
}
