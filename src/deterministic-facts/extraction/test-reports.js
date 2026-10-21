import { JunitSyntaxError, parseJunitSyntax } from "./junit-syntax.js";
import { isRestrictedText } from "../sensitive-content.js";

export const reportFields = new Map([["testId", "reportTestId"], ["sourceBundleId", "reportSourceBundleId"], ["command", "reportCommand"], ["environment", "reportEnvironment"], ["producer", "reportProducer"], ["testedVersion", "reportTestedVersion"]]);
export const reportStatuses = new Set(["PASS", "FAIL", "SKIP", "ERROR"]);
export function reportFieldProblem(value, limits = {}) {
  if (typeof value !== "string" || !value.length || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) return "REPORT_FIELD_INVALID";
  if (isRestrictedText(value)) return "REPORT_FIELD_RESTRICTED";
  if (Buffer.byteLength(value) > (limits.maxReportFieldBytes ?? 4096)) return "REPORT_FIELD_LIMIT";
  return null;
}

// Binding fields are claims in an untrusted report. Never resolve by name,
// promote a self-reported executor to authority, or issue an execution proof.
export function extractReportMetadata({ material, object, fields, limits, addFact, addGap }) {
  for (const [key, predicate] of reportFields) {
    const field = fields.get(key); if (!field) continue;
    let problem = reportFieldProblem(field.value, limits);
    if (key === "sourceBundleId" && !problem && !/^[a-f0-9]{64}$/.test(field.value)) problem = "REPORT_FIELD_INVALID";
    if (problem) { addGap(material, material.kind === "JSON" ? "json" : "junit-xml", problem, field.anchor); continue; }
    addFact({ subject: object, predicate, value: { datatype: "string", value: field.value }, material, anchor: field.anchor });
    if (key === "sourceBundleId" && field.value !== material.reportBundleId) addGap(material, material.kind === "JSON" ? "json" : "junit-xml", "REPORT_SOURCE_BINDING_MISMATCH", field.anchor);
  }
}

export function extractJunitReports({ material, text, limits, textAnchor, addObject, addFact, addGap }) {
  let parsed;
  try { parsed = parseJunitSyntax(text, limits); }
  catch (error) {
    if (!(error instanceof JunitSyntaxError)) throw error;
    addGap(material, "junit-xml", error.code, textAnchor(text, error.index, Math.min(text.length, error.index + 1))); return;
  }
  const suites = new Map();
  for (const node of parsed.nodes) {
    if (node.name === "testsuite" || node.name === "testsuites") {
      const attr = node.attrs.get("name"), restricted = attr && reportFieldProblem(attr.value, limits);
      const object = addObject(material, "JUNIT_SUITE", attr && !restricted ? attr.value : node.name, textAnchor(text, node.start, node.end));
      object.parentId = suites.get(node.parent)?.objectId ?? material.root.objectId; suites.set(node, object);
      if (restricted) addGap(material, "junit-xml", restricted, textAnchor(text, attr.start, attr.end));
      addFact({ subject: object, predicate: "name", value: { datatype: "string", value: object.name }, material, anchor: object.anchor }); continue;
    }
    if (node.name !== "testcase") continue;
    const attr = node.attrs.get("name"), problem = reportFieldProblem(attr?.value, limits);
    if (problem) { addGap(material, "junit-xml", problem, textAnchor(text, attr?.start ?? node.start, attr?.end ?? node.end)); continue; }
    const anchor = textAnchor(text, node.start, node.end), object = addObject(material, "TEST_RESULT", attr.value, anchor);
    object.parentId = suites.get(node.parent).objectId;
    const nameId = addFact({ subject: object, predicate: "testName", value: { datatype: "string", value: attr.value }, material, anchor: textAnchor(text, attr.start, attr.end) });
    addGap(material, "junit-xml", "EXECUTION_BINDING_MISSING", anchor);
    const fields = new Map();
    for (const key of reportFields.keys()) { const a = node.attrs.get(key === "testId" ? "id" : key); if (a) fields.set(key, { value: a.value, anchor: textAnchor(text, a.start, a.end) }); }
    extractReportMetadata({ material, object, fields, limits, addFact, addGap });
    const markers = node.children.filter(n => ["failure", "error", "skipped"].includes(n.name));
    if (markers.length > 1 || node.attrs.has("status") || node.attrs.has("result")) { addGap(material, "junit-xml", "REPORT_RESULT_AMBIGUOUS", anchor); continue; }
    const marker = markers[0], outcome = marker?.name ?? "none";
    const markerId = addFact({ subject: object, predicate: "reportOutcomeMarker", value: { datatype: "string", value: outcome }, material,
      anchor: marker ? textAnchor(text, marker.start, marker.end) : anchor });
    addFact({ subject: object, predicate: "reportsResult", value: { datatype: "string", value: ({ none: "PASS", failure: "FAIL", error: "ERROR", skipped: "SKIP" })[outcome] }, material, anchor,
      basis: "DERIVED", premiseFactIds: [nameId, markerId] });
  }
}
