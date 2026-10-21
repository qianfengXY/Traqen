import { canonicalDigest } from "./identity.js";
import { requireF002 } from "./errors.js";

export const reportPredicates = new Set(["reportOutcomeMarker", "reportTestId", "reportSourceBundleId", "reportCommand", "reportEnvironment", "reportProducer", "reportTestedVersion"]);
const jsonField = new Map([["testName", "name"], ["reportsResult", "status"], ["reportTestId", "testId"], ["reportSourceBundleId", "sourceBundleId"], ["reportCommand", "command"], ["reportEnvironment", "environment"], ["reportProducer", "producer"], ["reportTestedVersion", "testedVersion"]]);
const check = (value, reason) => requireF002(value, "F002_REPORT_INVALID", reason, { status: 422 });
const anchorDigest = anchor => canonicalDigest("REPORT_ANCHOR", { anchor: anchor ?? null });
const sameAnchor = (a, b) => anchorDigest(a) === anchorDigest(b);

// Checks publication semantics independently of parser/extractor emission.
// Raw declaration truth still comes from fixed evidence bytes and replay; this
// guard never treats the report's identity fields as a trusted execution receipt.
export function verifyReports({ objects, materials, facts, evidence, gaps, profile, bundleId }) {
  const bySubject = new Map(), gapKeys = new Set(), counts = new Map();
  for (const f of facts.values()) { if (!bySubject.has(f.subjectId)) bySubject.set(f.subjectId, []); bySubject.get(f.subjectId).push(f); }
  for (const g of gaps.values()) if (g.origin === "F002") gapKeys.add(`${g.materialId}:${g.code}:${anchorDigest(g.anchor)}`);
  const gap = (materialId, code, anchor) => gapKeys.has(`${materialId}:${code}:${anchorDigest(anchor)}`);
  const property = (o, p, required = true) => {
    const list = (bySubject.get(o.objectId) ?? []).filter(f => f.predicate === p);
    check(list.length <= 1 && (!required || list.length === 1), `报告缺少唯一 ${p} 声明`); return list[0];
  };
  for (const o of objects.values()) {
    if (o.kind !== "TEST_RESULT" || materials.get(o.materialId).ruleRef?.version !== "2") continue;
    const m = materials.get(o.materialId), xml = m.ruleRef.id === "f002-junit-xml";
    check(xml || m.ruleRef.id === "f002-json", "报告对象不属于支持的固定规则");
    const n = (counts.get(o.materialId) ?? 0) + 1; counts.set(o.materialId, n); check(n <= (profile.extractionLimits.maxReportCases ?? 2000), "报告用例预算超限");
    check(gap(o.materialId, "EXECUTION_BINDING_MISSING", o.anchor), "报告必须保留未证明执行绑定的限制");
    const name = property(o, "testName"), result = property(o, "reportsResult", false);
    check(name.value?.datatype === "string" && name.value.value === o.name && name.basis === "DECLARED", "报告名称没有满足其对象声明前提");
    check(objects.get(o.parentId)?.kind === (xml ? "JUNIT_SUITE" : "JSON_ARRAY"), "报告用例没有直接套件或数组父对象");
    for (const f of bySubject.get(o.objectId) ?? []) {
      if (!reportPredicates.has(f.predicate) && !["testName", "reportsResult"].includes(f.predicate)) continue;
      check(f.kind === "PROPERTY" && f.value?.datatype === "string" && f.ruleRef.id === m.ruleRef.id && f.ruleRef.version === "2", "报告属性不属于同材料规则");
      const anchors = f.evidenceIds.map(id => evidence.get(id)); check(anchors.length === 1 && anchors[0].materialId === o.materialId, "报告属性缺少同材料唯一定位");
      if (f !== result || !xml) check(f.basis === "DECLARED" && f.premiseFactIds.length === 0, "报告字段不能提升为执行证明");
      if (f.predicate !== "reportOutcomeMarker") check(f.value.value.length > 0 && Buffer.byteLength(f.value.value) <= (profile.extractionLimits.maxReportFieldBytes ?? 4096)
        && !/(?:password|secret|token|api[_-]?key)/i.test(f.value.value) && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(f.value.value), "报告字段受限或预算越界");
      if (!xml) check(jsonField.has(f.predicate) && anchors[0].anchor.kind === "JSON_POINTER" && anchors[0].anchor.pointer === `${o.anchor.pointer}/${jsonField.get(f.predicate)}`, "JSON 报告字段没有精确指针");
      if (f.predicate === "reportSourceBundleId") {
        check(/^[a-f0-9]{64}$/.test(f.value.value), "报告来源声明身份格式无效");
        if (bundleId && f.value.value !== bundleId) check(gap(o.materialId, "REPORT_SOURCE_BINDING_MISMATCH", anchors[0].anchor), "报告来源不匹配却未记录限制");
      }
    }
    if (!result) { check(gap(o.materialId, "REPORT_RESULT_AMBIGUOUS", o.anchor), "报告结果缺失却未记录本用例歧义"); continue; }
    check(["PASS", "FAIL", "SKIP", "ERROR"].includes(result.value.value), "报告结果不属于固定字面结果集合");
    if (xml) {
      const marker = property(o, "reportOutcomeMarker");
      check(result.basis === "DERIVED" && result.premiseFactIds.length === 2 && new Set(result.premiseFactIds).size === 2
        && result.premiseFactIds.includes(name.factId) && result.premiseFactIds.includes(marker.factId), "XML 报告结果缺少名称和结果标记前提");
      const outcomes = { none: "PASS", failure: "FAIL", error: "ERROR", skipped: "SKIP" };
      check(Object.hasOwn(outcomes, marker.value.value) && outcomes[marker.value.value] === result.value.value, "报告结果与标记前提冲突");
      check(sameAnchor(evidence.get(result.evidenceIds[0]).anchor, o.anchor), "XML 结果没有绑定完整测试节点范围");
      if (marker.value.value === "none") check(sameAnchor(evidence.get(marker.evidenceIds[0]).anchor, o.anchor), "缺结果标记的条件没有绑定完整节点");
    }
  }
}
