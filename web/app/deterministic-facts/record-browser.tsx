"use client";

import { evidenceResultKey } from "./model.ts";

import { useCallback, useEffect, useRef, useState } from "react";
import { DeterministicFactsClient, FactsClientError } from "./client.ts";
import { matchEvidenceRecords, filterEvidenceGaps, evidenceRelationReturn, relationEndpointLocation, type EvidenceLocation } from "./model.ts";
import { dispositionStates, evidenceRecordTitle as title, evidenceMatchDescription as hitDescription } from "./search.ts";
import { MaterialView } from "./material-view.tsx";
import { RecordDetailPanel } from "./record-detail.tsx";
import { RelationView } from "./relation-view.tsx";
import { DirectoryView } from "./directory-view.tsx";
import { emptyGapFilters } from "./traversal.ts";
import { useEvidenceResource } from "./use-resource.ts";
import { useEvidenceView, useInspectorControls } from "./use-view-state.ts";
import type { Coverage, FactRecord, RecordDetail, RecordPage } from "./types.ts";
import { boundedTextRange } from "./text-window.ts";
import { sourceAnchorTextRange } from "./source-anchor.ts";
import { materialCoverage, materialRecords } from "./coverage.ts";

const short = (value: string) => `${value.slice(0, 12)}…`;
const statusLabels: Record<string, string> = { DONE: "该能力已完成", NOT_APPLICABLE: "该能力不适用", UNSUPPORTED: "该能力不支持", PARSE_FAILED: "解析失败", PENDING: "待处理", RUNNING: "处理中" };

function useRecords(client: DeterministicFactsClient, versionId: string, name: string, accessLost: (error: Error) => void, query = "") {
  const route = `/versions/${versionId}/${name}?limit=100${query ? `&q=${encodeURIComponent(query)}` : ""}`;
  const load = useCallback((bound: DeterministicFactsClient) => bound.request<RecordPage>(route), [route]);
  const resource = useEvidenceResource(client, route, load, accessLost);
  const [paginationError, setPaginationError] = useState<{ route: string; error: Error } | null>(null), [busy, setBusy] = useState(false);
  const page = resource.data, error = resource.error ?? (paginationError?.route === route ? paginationError.error : null);
  const more = async () => {
    if (!page?.nextCursor || busy) return;
    setBusy(true);
    try {
      const next = await client.request<RecordPage>(`${route}&cursor=${encodeURIComponent(page.nextCursor)}`);
      if (!client.signal?.aborted) resource.update(current => ({ items: [...current.items, ...next.items], nextCursor: next.nextCursor }));
    } catch (error) { if (error instanceof FactsClientError && [401, 403].includes(error.status)) accessLost(error); else if (!client.signal?.aborted) setPaginationError({ route, error: error as Error }); }
    finally { if (!client.signal?.aborted) setBusy(false); }
  };
  return { page, error, busy, more, retry: () => { setPaginationError(null); resource.retry(); } };
}

function RecordList({ records, selectedId, select, query = "" }: { records: FactRecord[]; selectedId?: string; select: (record: FactRecord) => void; query?: string }) {
  const matches = matchEvidenceRecords(records, query);
  if (!matches.length) return <p className="f002-empty" role="status">{query.trim() ? "没有匹配记录；保留筛选与固定选择，可清除查询或加载更多。" : "当前已加载页没有记录；不据此推断业务不存在。"}</p>;
  return <table className="f002-table"><thead><tr><th scope="col">对象／谓词</th><th scope="col">类型与依据</th><th scope="col">完整定位</th></tr></thead><tbody>{matches.map(({ record, fields }) => <tr key={`${record.kind}:${record.id}`} aria-selected={record.id === selectedId}><td><button className="f002-record-link" onClick={() => select(record)}>{title(record)}</button>{fields.length > 0 && <small>{hitDescription(fields)}</small>}</td><td>{record.payload.kind ?? record.kind}{record.payload.basis && <small>{record.payload.basis === "DERIVED" ? "推导依据 DERIVED" : "直接依据 DECLARED"}</small>}</td><td><code title={record.id}>{short(record.id)}</code>{record.payload.displayPath && <small>{record.payload.displayPath}</small>}{record.payload.materialId && <small title={record.payload.materialId}>材料：{short(record.payload.materialId)}</small>}</td></tr>)}</tbody></table>;
}

export function RecordBrowser({ client, context, actorId, navigate, accessLost }: { client: DeterministicFactsClient; context: EvidenceLocation; actorId: string; navigate: (next: EvidenceLocation) => void; accessLost: (error: Error) => void }) {
  const versionId = evidenceResultKey(context);
  const view = useEvidenceView({ workspaceId: context.workspaceId, graphVersionId: versionId, actorId, authorized: true, recordId: context.recordId, recordKind: context.kind, graphRootId: context.graphRootId });
  const materials = useRecords(client, versionId, "materials", accessLost, view.materialPathQuery);
  const records = useRecords(client, versionId, "objects", accessLost);
  const relations = useRecords(client, versionId, "relations", accessLost);
  const facts = useRecords(client, versionId, "facts", accessLost);
  const coverageIds = (materials.page?.items ?? []).map(material => material.id).sort().join(",");
  const coverageRoute = `/versions/${versionId}/coverage?materialIds=${coverageIds}`;
  const loadCoverage = useCallback((bound: DeterministicFactsClient) => materialCoverage(bound, versionId, coverageIds ? coverageIds.split(",") : []), [versionId, coverageIds]);
  const coverageResource = useEvidenceResource(client, coverageRoute, loadCoverage, accessLost);
  const coverage = coverageResource.data;
  const { reopenRef, autoFocus, close, open } = useInspectorControls(view);
  const { query, materialType, processingStatus, directoryScrollTop } = view;
  const directory = useRef<HTMLElement>(null);
  useEffect(() => {
    const element = directory.current;
    if (materials.page && element && directoryScrollTop <= element.scrollHeight - element.clientHeight) element.scrollTop = directoryScrollTop;
  }, [materials.page, records.page, coverage, query, materialType, processingStatus, view.expandedDirectory, directoryScrollTop]);
  const selectedRoute = context.recordId && context.kind ? `/versions/${versionId}/records/${context.kind}/${context.recordId}` : "";
  const loadMaterial = useCallback(async (bound: DeterministicFactsClient) => {
    if (!selectedRoute) return null;
    const detail = await bound.request<RecordDetail>(selectedRoute);
    const materialId = detail.record.kind === "MATERIAL" ? detail.record.id : detail.record.payload.materialId
      ?? detail.references.find(record => record.role === "evidence" || record.role === "subject")?.payload.materialId;
    if (!materialId) return null;
    const material = detail.record.kind === "MATERIAL" ? detail.record : (await bound.request<RecordDetail>(`/versions/${versionId}/records/MATERIAL/${materialId}`)).record;
    const anchor = sourceAnchorTextRange(detail.record.payload.anchor ?? detail.references.find(record => record.role === "evidence")?.payload.anchor);
    const line = anchor?.lineStart, lineEnd = line === undefined ? undefined : anchor?.lineEnd ?? line;
    return { material, line, lineEnd };
  }, [selectedRoute, versionId]);
  const materialResource = useEvidenceResource(client, selectedRoute, loadMaterial, accessLost);
  const openedMaterial = materialResource.data?.material ?? null;
  const readingLine = context.line ?? materialResource.data?.line ?? view.readingLine;
  const readingLineEnd = context.lineEnd ?? (context.line !== undefined ? context.line : materialResource.data?.lineEnd ?? view.readingLineEnd);
  const readingWindowLine = context.windowLine ?? context.line ?? materialResource.data?.line ?? view.readingWindowLine;
  const selectRange = (start: number, end: number, windowLine = readingWindowLine) => {
    boundedTextRange(start, end); boundedTextRange(windowLine);
    view.update({ readingLine: start, readingLineEnd: end, readingWindowLine: windowLine });
    navigate({ ...context, line: start, lineEnd: end, windowLine });
  };
  const select = (record: FactRecord, line?: number) => {
    // Without a fixed graph root, the newly selected relation is the focus;
    // an unrelated material selected before entering this tab is not a root.
    const graphRootId = context.tab === "relations" ? context.graphRootId ?? view.graphRootId ?? record.id : context.graphRootId;
    const anchor = sourceAnchorTextRange(record.payload.anchor);
    const start = line ?? anchor?.lineStart, end = start === undefined ? undefined : anchor?.lineEnd ?? start;
    view.update({ readingLine: start ?? 1, readingLineEnd: end ?? 1, readingWindowLine: start ?? 1, inspectorScrollTop: 0, ...(graphRootId ? { graphRootId } : {}) }, record.id, record.kind);
    navigate({ ...context, kind: record.kind, recordId: record.id, line: start, lineEnd: end, windowLine: start, graphRootId, relationReturn: context.tab === "relations" ? undefined : context.relationReturn });
  };
  const openEndpoint = (fact: FactRecord, object: FactRecord) => {
    const next = relationEndpointLocation({ ...context, graphRootId: context.graphRootId ?? view.graphRootId ?? context.recordId ?? fact.id }, fact, object.id, view.relationScrollTop);
    const anchor = sourceAnchorTextRange(object.payload.anchor);
    const start = anchor?.lineStart ?? 1, end = anchor?.lineEnd ?? start;
    view.update({ readingLine: start, readingLineEnd: end, readingWindowLine: start, inspectorScrollTop: 0 }, object.id, "OBJECT"); navigate({ ...next, line: start, lineEnd: end, windowLine: start });
  };
  const back = evidenceRelationReturn(context);
  const openObject = (record: FactRecord) => {
    const anchor = sourceAnchorTextRange(record.payload.anchor);
    const start = anchor?.lineStart ?? 1, end = anchor?.lineEnd ?? start;
    view.update({ inspectorScrollTop: 0, readingLine: start, readingLineEnd: end, readingWindowLine: start }, record.id, record.kind);
    navigate({ ...context, tab: "objects", kind: record.kind, recordId: record.id, line: start, lineEnd: end, windowLine: start });
  };
  const returnRelation = () => {
    if (!back || !context.relationReturn) return;
    view.update({ relationScrollTop: context.relationReturn.scrollTop, graphRootId: back.graphRootId ?? null, inspectorScrollTop: 0, readingLine: 1, readingLineEnd: 1, readingWindowLine: 1 }, back.recordId, "FACT"); navigate(back);
  };
  const materialTypes = [...new Set([materialType, ...(materials.page?.items ?? []).map(item => item.payload.kind)].filter((kind): kind is string => typeof kind === "string" && /^[A-Z][A-Z0-9_]{0,63}$/.test(kind)))].sort();
  return <>
    {back && context.tab !== "relations" && <button className="button" onClick={returnRelation}>返回原关系与列表位置</button>}
    <div className="f002-actions"><label className="f002-search">在整个固定范围检索材料路径<input aria-label="在整个固定范围检索材料路径" value={view.materialPathQuery} maxLength={512} onChange={event => view.update({ materialPathQuery: event.target.value, directoryScrollTop: 0 })} placeholder="例如 scripts/android-native-ci.mjs" /></label>
      <label className="f002-search">在已加载材料／对象／事实中筛选<input value={query} maxLength={512} onChange={event => view.update({ query: event.target.value, directoryScrollTop: 0 })} placeholder="名称、符号、路径、谓词或完整 ID" /></label>
      <label>材料登记类型<select aria-label="材料类型筛选" value={materialType} disabled={!materials.page} onChange={event => view.update({ materialType: event.target.value, directoryScrollTop: 0 })}><option value="">全部已加载类型</option>{materialTypes.map(kind => <option key={kind} value={kind}>{kind}</option>)}</select></label>
      <label>任一能力的实际处置<select aria-label="能力处置状态筛选" value={processingStatus} disabled={!coverage} onChange={event => view.update({ processingStatus: event.target.value, directoryScrollTop: 0 })}><option value="">全部处置状态</option>{dispositionStates.map(status => <option key={status} value={status}>{statusLabels[status]} · {status}</option>)}</select></label>
      <button className="button" disabled={!view.materialPathQuery && !query && !materialType && !processingStatus} onClick={() => view.update({ materialPathQuery: "", query: "", materialType: "", processingStatus: "", directoryScrollTop: 0 })}>清除筛选</button>
      {!view.inspectorOpen && <button className="button" ref={reopenRef} aria-label="重开依据面板" onClick={open}>重开依据面板</button>}</div>
    <p className="f002-caption">材料路径在整个固定范围查询，并有界分页；名称、符号、谓词、类型与处置筛选只作用于已加载页，条件叠加。状态来自各项已声明能力，同一材料可匹配多种处置；DONE 不证明完整理解。短编号可能命中多个候选，需明确选择；筛选不更换固定阅读引用。偏好仅按已验证成员和固定版本保存，不保存正文。</p>
    {coverageResource.error ? <p className="f002-notice" role="alert">处置记录最新读取未完成：{coverageResource.error.message}。{coverage ? "保留本固定版本最后可信的处置。" : "状态未确认，不从可读性、类型或零事实推断；已选状态仍保留。"}<button className="button" onClick={coverageResource.retry}>重试处置记录</button></p> : !coverage && <p className="f002-caption" role="status">正在读取本固定版本的能力处置；未确认前保留筛选，不猜测处理状态。</p>}
    {view.error && <p className="f002-notice" role="status">{view.error}</p>}
    <div className={`f002-browser-grid${view.inspectorOpen ? "" : " f002-inspector-closed"}`}><aside className="f002-directory" ref={directory} onScroll={event => view.update({ directoryScrollTop: event.currentTarget.scrollTop })}><h2>材料目录</h2>{materials.error ? <p role="alert">目录不可用：{materials.error.message}<button className="button" onClick={materials.retry}>重试目录</button></p> : !materials.page ? <p role="status">读取获准目录…</p> : <>
      {!records.page && !records.error && <p role="status">正在加载材料内对象；材料入口不等待对象或事实。</p>}
      {records.error && <p role="alert">材料内对象读取未完成：{records.error.message}<button className="button" onClick={records.retry}>重试材料内对象</button></p>}
      <DirectoryView materials={materials.page.items} objects={records.page?.items ?? []} filters={{ query, materialType, processingStatus }} coverage={coverage}
        selectedId={context.recordId} selectedKind={context.kind} readingMaterialId={openedMaterial?.id} expandedDirectory={view.expandedDirectory}
        onExpansion={expandedDirectory => view.update({ expandedDirectory })} select={select} />
      {materials.page.nextCursor && <><p className="f002-caption">保存的位置若超出已加载目录，加载后再恢复；不替换所选材料。</p><button className="button" disabled={materials.busy} onClick={() => void materials.more()}>加载更多材料</button></>}
      {records.page?.nextCursor && <button className="button" disabled={records.busy} onClick={() => void records.more()}>加载更多材料内对象</button>}
    </>}</aside>
      <div className="f002-main-reading"><MaterialView client={client} versionId={versionId} material={openedMaterial} line={readingLine} lineEnd={readingLineEnd} windowLine={readingWindowLine}
        onLine={line => selectRange(line, line)} onRange={selectRange} onWindowLine={windowLine => selectRange(readingLine, readingLineEnd, windowLine)} onAccessLost={accessLost} />
        <section className="f002-records"><h2>{context.tab === "relations" ? "关系事实（与局部图相同依据）" : "对象"}</h2>{context.tab === "objects" && <>{records.error ? <p role="alert">{records.error.message}<button className="button" onClick={records.retry}>重试本区</button></p> : !records.page ? <p role="status">读取固定记录…</p> : <><RecordList records={records.page.items} query={query} selectedId={context.recordId} select={select} />{records.page.nextCursor && <button className="button" disabled={records.busy} onClick={() => void records.more()}>加载下一页</button>}</>}</>}
          {context.tab === "objects" && <><h2>PROPERTY／RELATION 事实</h2>{facts.error ? <p role="alert">{facts.error.message}</p> : facts.page ? <>{facts.page.items.length === 0 ? <p className="f002-empty" role="status">本加载页没有已提取事实；获准原材料仍可从目录读取，不据此推断业务不存在。</p> : <RecordList records={facts.page.items} query={query} selectedId={context.recordId} select={select} />}{facts.page.nextCursor && <button className="button" disabled={facts.busy} onClick={() => void facts.more()}>加载更多事实</button>}</> : <p role="status">读取事实…</p>}</>}
          {context.tab === "relations" && <>{relations.error && <p role="alert">关系读取未完成：{relations.error.message}<button className="button" onClick={relations.retry}>重试关系</button></p>}<RelationView client={client} context={context} view={view} relations={relations.page?.items ?? []} objects={records.page?.items ?? []} materials={materials.page?.items ?? []} select={select} openEndpoint={openEndpoint} openObject={openObject} accessLost={accessLost} />{relations.page?.nextCursor && <button className="button" disabled={relations.busy} onClick={() => void relations.more()}>加载更多关系</button>}{records.page?.nextCursor && <button className="button" disabled={records.busy} onClick={() => void records.more()}>加载更多端点对象</button>}</>}
        </section></div>{view.inspectorOpen && <RecordDetailPanel client={client} context={context} select={select} accessLost={accessLost} scrollTop={view.inspectorScrollTop} onScroll={inspectorScrollTop => view.update({ inspectorScrollTop })} onEndpoint={openEndpoint} onClose={close} autoFocus={autoFocus} />}</div>
  </>;
}


export function CoverageView({ client, context, actorId, navigate, accessLost }: { client: DeterministicFactsClient; context: EvidenceLocation; actorId: string; navigate: (next: EvidenceLocation) => void; accessLost: (error: Error) => void }) {
  const gaps = useRecords(client, evidenceResultKey(context), "gaps", accessLost);
  const [position, setPosition] = useState<{ versionId: string; cursor: string | null } | null>(null);
  const cursor = position && position.versionId === evidenceResultKey(context) ? position.cursor : null;
  const setCursor = (next: string | null) => setPosition({ versionId: evidenceResultKey(context), cursor: next });
  const route = `/versions/${evidenceResultKey(context)}/coverage?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
  const load = useCallback(async (bound: DeterministicFactsClient) => (await bound.request<{ coverage: Coverage }>(route)).coverage, [route]);
  const resource = useEvidenceResource(client, route, load, accessLost);
  const coverage = resource.data, error = resource.error;
  const referencedIds = [...new Set([
    ...(coverage?.items ?? []).map(item => item.materialId),
    ...(gaps.page?.items ?? []).flatMap(gap => typeof gap.payload.materialId === "string" ? [gap.payload.materialId] : []),
  ])].sort().join(",");
  const loadMaterials = useCallback((bound: DeterministicFactsClient) => materialRecords(bound, evidenceResultKey(context), referencedIds ? referencedIds.split(",") : []), [evidenceResultKey(context), referencedIds]);
  const materialResource = useEvidenceResource(client, `${evidenceResultKey(context)}/referenced-materials/${referencedIds}`, loadMaterials, accessLost);
  const materials = { page: materialResource.data, error: materialResource.error, retry: materialResource.retry };
  const view = useEvidenceView({ workspaceId: context.workspaceId, graphVersionId: evidenceResultKey(context), actorId, authorized: true, recordId: context.recordId, recordKind: context.kind });
  const { reopenRef, autoFocus, close, open } = useInspectorControls(view);
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = list.current;
    if (gaps.page && element && view.gapScrollTop <= element.scrollHeight - element.clientHeight) element.scrollTop = view.gapScrollTop;
  }, [gaps.page, materials.page, coverage, view.gapFilters, view.gapScrollTop]);
  const filters = view.gapFilters;
  const updateFilter = (patch: Partial<typeof filters>) => view.update({ gapFilters: { ...filters, ...patch }, gapScrollTop: 0 });
  const materialById = new Map((materials.page?.items ?? []).map(record => [record.id, record]));
  const gapMaterialIds = [...new Set((gaps.page?.items ?? []).flatMap(gap => typeof gap.payload.materialId === "string" ? [gap.payload.materialId] : []))].sort().join(",");
  const loadGapCoverage = useCallback((bound: DeterministicFactsClient) => materialCoverage(bound, evidenceResultKey(context), gapMaterialIds ? gapMaterialIds.split(",") : []), [evidenceResultKey(context), gapMaterialIds]);
  const gapCoverage = useEvidenceResource(client, `${evidenceResultKey(context)}/gap-coverage/${gapMaterialIds}`, loadGapCoverage, accessLost);
  const filtered = filterEvidenceGaps(gaps.page?.items ?? [], filters, materials.page?.items ?? [], gapCoverage.data);
  const codes = [...new Set([filters.code, ...(gaps.page?.items ?? []).map(gap => gap.payload.code)].filter(Boolean))];
  const materialTypes = [...new Set([filters.materialType, ...(materials.page?.items ?? []).map(material => material.payload.kind)].filter(Boolean))];
  const select = (record: FactRecord, line?: number) => {
    const anchor = sourceAnchorTextRange(record.payload.anchor);
    const start = line ?? anchor?.lineStart, end = start === undefined ? undefined : anchor?.lineEnd ?? start;
    view.update({ inspectorScrollTop: 0, readingLine: start ?? 1, readingLineEnd: end ?? 1, readingWindowLine: start ?? 1 }, record.id, record.kind);
    navigate({ ...context, tab: record.kind === "GAP" ? "coverage" : "objects", kind: record.kind, recordId: record.id, line: start, lineEnd: end, windowLine: start });
  };
  return <section className="f002-panel">
    <div className="f002-actions"><h2>覆盖与缺口</h2>{!view.inspectorOpen && <button className="button" ref={reopenRef} aria-label="重开依据面板" onClick={open}>重开依据面板</button>}</div>
    <p>材料 × 已声明能力是分母；零 Gap 不代表业务理解完整，也不包含未声明能力。访问限制与提取限制不同；只显示本次获准的记录与数量。</p>
    {view.error && <p role="status">{view.error}</p>}
    {error && <p role="alert">最新覆盖读取未完成：{error.message}。不从零事实或可读性猜测状态。<button className="button" onClick={resource.retry}>重试固定范围覆盖</button></p>}
    {!coverage ? <p role="status">读取固定范围覆盖…</p> : <>
      <dl className="f002-counts">{Object.entries(coverage.counts).map(([status, count]) => <div key={status}><dt>{status}</dt><dd>{count}</dd></div>)}</dl>
      <p>已声明能力：{coverage.declaredCapabilities.join("、")}</p>
      <p>全范围 {coverage.totalItems ?? Object.values(coverage.counts).reduce((sum, count) => sum + count, 0)} 个材料×能力工作项；下表仅显示当前页 {coverage.items.length} 项，非完整清单。</p>
      <div className="f002-coverage-list"><table className="f002-table"><thead><tr><th scope="col">材料</th><th scope="col">能力</th><th scope="col">实际处置</th><th scope="col">未知／恢复依据</th></tr></thead><tbody>{coverage.items.map(item => <tr key={`${item.materialId}:${item.capabilityId}`}>
        <td><button className="f002-record-link" onClick={() => select(materialById.get(item.materialId) ?? { kind: "MATERIAL", id: item.materialId, payload: {} })}>{materialById.get(item.materialId)?.payload.displayPath ?? item.materialId}</button></td>
        <td>{item.capabilityId}</td><td>{item.status}</td><td>{item.diagnostic ? JSON.stringify(item.diagnostic) : "无额外诊断；不推断业务结论"}</td></tr>)}</tbody></table></div>
      <div className="f002-actions"><button className="button" disabled={!cursor} onClick={() => setCursor(null)}>回到覆盖首页</button><button className="button" disabled={!coverage.nextCursor} onClick={() => setCursor(coverage.nextCursor ?? null)}>覆盖下一页</button></div>
    </>}
    <h3>F001 继承缺口与 F002 技术限制</h3>
    {gapCoverage.error && <p role="alert">当前缺口的能力处置读取未完成：{gapCoverage.error.message}<button className="button" onClick={gapCoverage.retry}>重读缺口处置</button></p>}
    <div className="f002-actions">
      <label>缺口检索<input aria-label="缺口检索" maxLength={512} value={filters.query} onChange={event => updateFilter({ query: event.target.value })} /></label>
      <label>限制原因<select aria-label="缺口原因筛选" value={filters.code} onChange={event => updateFilter({ code: event.target.value })}><option value="">全部已加载原因</option>{codes.map(code => <option key={code}>{code}</option>)}</select></label>
      <label>发现来源<select aria-label="缺口来源筛选" value={filters.origin} onChange={event => updateFilter({ origin: event.target.value })}><option value="">全部来源</option><option value="F001">F001 继承限制</option><option value="F002">F002 技术发现</option></select></label>
      <label>受影响材料类型<select aria-label="缺口材料类型筛选" value={filters.materialType} onChange={event => updateFilter({ materialType: event.target.value })}><option value="">全部已加载类型</option>{materialTypes.map(kind => <option key={kind}>{kind}</option>)}</select></label>
      <label>对应能力的实际处置<select aria-label="缺口处置状态筛选" disabled={!gapCoverage.data} value={filters.status} onChange={event => updateFilter({ status: event.target.value })}><option value="">全部状态</option>{dispositionStates.map(status => <option key={status}>{status}</option>)}</select></label>
      <button className="button" disabled={!Object.values(filters).some(Boolean)} onClick={() => view.update({ gapFilters: emptyGapFilters(), gapScrollTop: 0 })}>清除缺口筛选</button>
    </div>
    {materials.error && <p role="alert">材料类型读取未完成，保留已选条件：{materials.error.message}<button className="button" onClick={materials.retry}>重试本版本材料目录</button></p>}
    {gaps.error ? <p role="alert">缺口读取未完成：{gaps.error.message}<button className="button" onClick={gaps.retry}>重试本版本缺口</button></p> : !gaps.page ? <p role="status">读取缺口…</p> : <>
      <div className="f002-gap-list" ref={list} onScroll={event => view.update({ gapScrollTop: event.currentTarget.scrollTop })}>
        {!filtered.length ? <p className="f002-empty" role="status">{filters.status && !gapCoverage.data ? "对应能力处置尚未确认；没有静默清除筛选。" : "当前已加载页没有匹配缺口；保留条件与当前选择，零 Gap 不证明没有遗漏。"}</p>
          : <table className="f002-table"><thead><tr><th scope="col">原因与发现来源</th><th scope="col">受影响材料／能力</th><th scope="col">精确定位</th></tr></thead><tbody>{filtered.map(gap => {
            const material = materialById.get(gap.payload.materialId ?? "");
            return <tr key={gap.id} data-gap-id={gap.id} aria-selected={gap.id === context.recordId}><td><button className="f002-record-link" onClick={() => select(gap)}>{gap.payload.code ?? "原因未说明"}</button><small>{gap.payload.origin === "F001" ? "F001 继承限制" : gap.payload.origin === "F002" ? "F002 技术发现" : "发现来源未确认"}</small></td>
              <td>{material?.payload.displayPath ?? gap.payload.materialId ?? "范围见依据"}<small>{gap.payload.capability ?? "原来源限制，不推断提取状态"}</small></td><td><code>{gap.id}</code></td></tr>;
          })}</tbody></table>}
      </div>
      {gaps.page.nextCursor && <button className="button" disabled={gaps.busy} onClick={() => void gaps.more()}>加载更多缺口</button>}
    </>}
    {view.inspectorOpen && <RecordDetailPanel client={client} context={context} select={select} accessLost={accessLost} scrollTop={view.inspectorScrollTop} onScroll={inspectorScrollTop => view.update({ inspectorScrollTop })} onClose={close} autoFocus={autoFocus} />}
  </section>;
}
