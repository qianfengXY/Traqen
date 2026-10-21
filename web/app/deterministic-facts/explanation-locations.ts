import type { FactRecord } from "./types.ts";
import { sourceAnchorTextRange } from "./source-anchor.ts";

export const metadataObject = (value: unknown): Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
export const metadataText = (value: unknown): string | null => typeof value === "string" ? value : null;
export const metadataIds = (value: unknown): string[] => Array.isArray(value) ? value.filter((id): id is string => typeof id === "string" && /^[a-f0-9]{64}$/.test(id)) : [];
const coordinate = (value: unknown, minimum = 0): value is number => Number.isSafeInteger(value) && Number(value) >= minimum;

export function explainSourceLocation(record: FactRecord) {
  const anchor = record.payload.anchor;
  if (!anchor) return null;
  let description = "锚点类型未确认；不能推断原文位置。";
  if (anchor.kind === "TEXT" || anchor.kind === "JSON_POINTER") {
    const range: Record<string, unknown> = sourceAnchorTextRange(anchor) ?? {};
    const positions: string[] = [];
    if (coordinate(range.lineStart, 1) && coordinate(range.lineEnd, range.lineStart)) {
      positions.push(`第 ${range.lineStart}–${range.lineEnd} 行`);
      if (coordinate(range.columnStart, 1) && coordinate(range.columnEnd, 1)) positions.push(`列 ${range.columnStart}–${range.columnEnd}（对应两端行）`);
    }
    if (coordinate(range.byteStart) && coordinate(range.byteEnd, Number(range.byteStart))) positions.push(`UTF-8 字节 [${range.byteStart}, ${range.byteEnd})`);
    description = positions.length ? `${anchor.kind === "JSON_POINTER" ? `JSON Pointer ${anchor.pointer || "（根）"} · ` : ""}${positions.join(" · ")}` : "文本锚点缺少可用坐标；不会从字节猜测行号。";
  } else if (anchor.kind === "IMAGE") {
    description = coordinate(anchor.width, 1) && coordinate(anchor.height, 1) ? `整图 ${anchor.width} × ${anchor.height} 像素；未声明局部图像区域。` : "整图锚点；尺寸未确认，未声明局部图像区域。";
  } else if (anchor.kind === "BINARY") description = "二进制内容锚点；没有文本行号或图像区域。";
  return { id: record.id, kind: record.kind, materialId: metadataText(record.payload.materialId),
    contentDigest: metadataText(record.payload.contentDigest) ?? metadataText(anchor.digest), description };
}

export function explainGap(record: FactRecord) {
  const payload = record.payload, reason = metadataObject(payload.reason);
  const inherited = payload.origin === "F001";
  const code = metadataText(payload.code) ?? "原因代码未确认";
  const nextStep = inherited ? "回到 F001 来源快照核对原始限制和材料可用性；本页不会修改来源或启动新分析。"
    : code === "EXPRESS_ROUTE_DYNAMIC" ? "查看标记处的动态路径表达式及可用原文；需要运行时证据时另行调查，本静态事实集不能确认路由可达。"
    : /PARSE_FAILED|ENCODING_UNSUPPORTED|COMPLEX_STRUCTURE_UNSUPPORTED/.test(code) ? "核对标记材料、实际编码与已登记规则能力；本页不会把重试或其他格式当作已成功。"
    : "核对原文锚点、受影响材料和固定规则范围；若需要范围之外的证据，应另行调查，不能把此限制当作业务结论。";
  return { id: record.id, code, originLabel: inherited ? "F001 继承限制" : payload.origin === "F002" ? "F002 提取限制" : "来源未确认",
    capability: metadataText(payload.capability), category: metadataText(reason.category), affectedScope: metadataText(reason.affectedScope),
    sourceGapId: metadataText(reason.sourceGapId), nextStep,
    notice: inherited ? "这是来源层继承的限制，不是 F002 新发现或提取失败；原来源 Gap 身份保留。" : "这是范围内的技术限制，不是业务矛盾、全局失败或人工确认。" };
}
