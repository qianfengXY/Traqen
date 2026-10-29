"use client";

import { evidenceResultKey } from "./model.ts";

import { useCallback, useEffect, useMemo, useRef, type KeyboardEvent } from "react";
import { DeterministicFactsClient } from "./client.ts";
import { filterRelationFacts, projectEvidenceGraph, type EvidenceLocation } from "./model.ts";
import { emptyGraphViewport, emptyRelationFilters, type RelationFilters } from "./traversal.ts";
import { evidenceRecordTitle as title } from "./search.ts";
import { useEvidenceResource } from "./use-resource.ts";
import type { useEvidenceView } from "./use-view-state.ts";
import type { FactRecord, LocalGraph } from "./types.ts";
import { isEvidenceShortcut } from "./keyboard.ts";

export function RelationView({ client, context, view, relations, objects, materials, select, openEndpoint, openObject, accessLost }: {
  client: DeterministicFactsClient; context: EvidenceLocation; view: ReturnType<typeof useEvidenceView>;
  relations: FactRecord[]; objects: FactRecord[]; materials: FactRecord[];
  select: (fact: FactRecord) => void; openEndpoint: (fact: FactRecord, object: FactRecord) => void;
  openObject: (object: FactRecord) => void; accessLost: (error: Error) => void;
}) {
  const rootId = context.graphRootId ?? view.graphRootId ?? context.recordId;
  const route = rootId ? `/versions/${evidenceResultKey(context)}/graph?rootId=${rootId}&depth=2&limit=40` : "";
  const load = useCallback(async (bound: DeterministicFactsClient) => route ? (await bound.request<{ graph: LocalGraph }>(route)).graph : null, [route]);
  const resource = useEvidenceResource(client, route, load, accessLost);
  const graph = resource.data;
  const projected = useMemo(() => graph ? projectEvidenceGraph(graph) : { nodes: [], edges: [], unavailableFactIds: [] }, [graph]);
  const allObjects = [...objects, ...projected.nodes.filter(node => node.kind === "OBJECT")];
  const byId = new Map(allObjects.map(object => [object.id, object]));
  const allRelations = [...new Map([...relations, ...projected.edges.map(edge => edge.fact)].map(fact => [fact.id, fact])).values()];
  const filtered = filterRelationFacts(allRelations, view.relationFilters, [...materials, ...projected.nodes, ...allObjects]);
  const selected = allRelations.find(fact => fact.id === context.recordId);
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = list.current, top = view.relationScrollTop;
    if (element && top <= element.scrollHeight - element.clientHeight) element.scrollTop = top;
    // A path match becomes renderable only after its admitted endpoints,
    // materials or graph arrive. Do not lose the target while rows are empty.
  }, [relations, objects, materials, graph, view.relationFilters, view.relationScrollTop]);
  useEffect(() => {
    if (context.relationReturn?.factId === context.recordId) list.current?.querySelector<HTMLButtonElement>(`[data-relation-select="${context.recordId}"]`)?.focus({ preventScroll: true });
  }, [context.recordId, context.relationReturn?.factId, relations]);
  const filters = view.relationFilters;
  const filter = (patch: Partial<RelationFilters>) => view.update({ relationFilters: { ...filters, ...patch }, relationScrollTop: 0 });
  const viewport = view.graphViewport;
  const explore = (patch: Partial<typeof viewport>) => view.update({ graphRootId: rootId ?? null, graphViewport: { ...viewport, ...patch } });
  const points = new Map(projected.nodes.map((node, index) => [node.id, { x: 250 + Math.cos(index * Math.PI * 2 / Math.max(1, projected.nodes.length)) * 165,
    y: 200 + Math.sin(index * Math.PI * 2 / Math.max(1, projected.nodes.length)) * 125 }]));
  const keyActivate = (event: KeyboardEvent<SVGGElement>, act: () => void) => {
    if (isEvidenceShortcut(event.nativeEvent, ["Enter", " "])) { event.preventDefault(); act(); }
  };
  return <section className="f002-relations" aria-label="确定性关系列表与局部图">
    <div className="f002-actions">
      <label>关系检索<input aria-label="关系检索" maxLength={512} value={filters.query} onChange={event => filter({ query: event.target.value })} /></label>
      <label>关系类型<select aria-label="关系类型筛选" value={filters.predicate} onChange={event => filter({ predicate: event.target.value })}><option value="">全部已加载类型</option>{[...new Set([filters.predicate, ...allRelations.map(fact => fact.payload.predicate)].filter(Boolean))].map(predicate => <option key={predicate}>{predicate}</option>)}</select></label>
      <label>起点编号或名称<input aria-label="关系起点筛选" maxLength={512} value={filters.source} onChange={event => filter({ source: event.target.value })} /></label>
      <label>终点编号或名称<input aria-label="关系终点筛选" maxLength={512} value={filters.target} onChange={event => filter({ target: event.target.value })} /></label>
      <label>端点材料路径<input aria-label="关系路径筛选" maxLength={512} value={filters.path} onChange={event => filter({ path: event.target.value })} /></label>
      <button className="button" disabled={!Object.values(filters).some(Boolean)} onClick={() => view.update({ relationFilters: emptyRelationFilters(), relationScrollTop: 0 })}>清除关系筛选</button>
    </div>
    <p className="f002-caption">仅检索本固定版本已获准的加载页和局部图；同名对象仍按完整编号分别选择。静态关系不证明实际执行，没有关系也不证明业务无关联。</p>
    <div className="f002-relation-list" ref={list} onScroll={event => view.update({ relationScrollTop: event.currentTarget.scrollTop })}>
      {!filtered.length ? <p className="f002-empty" role="status">没有匹配关系；保留筛选和固定选择，不据此推断不存在关联。</p> : <table className="f002-table"><thead><tr><th scope="col">起点 → 终点</th><th scope="col">关系与依据</th><th scope="col">事实完整编号</th></tr></thead><tbody>{filtered.map(fact => {
        const subject = byId.get(fact.payload.subjectId ?? ""), target = byId.get(fact.payload.targetId ?? "");
        return <tr key={fact.id} data-relation-id={fact.id} aria-selected={context.recordId === fact.id}><td>
          {subject ? <button className="f002-record-link" onClick={() => openEndpoint(fact, subject)}>{title(subject)}<small>{subject.id}</small></button> : <span>起点当前未加载：{fact.payload.subjectId}</span>}
          <span aria-label="关系方向"> → </span>
          {target ? <button className="f002-record-link" onClick={() => openEndpoint(fact, target)}>{title(target)}<small>{target.id}</small></button> : <span>终点当前未加载：{fact.payload.targetId}</span>}
        </td><td><button className="f002-record-link" data-relation-select={fact.id} onClick={() => select(fact)}>{fact.payload.predicate}</button><small>{fact.payload.basis === "DERIVED" ? "规则派生，须核对前提" : "材料声明，不表示执行"}</small></td><td><code>{fact.id}</code></td></tr>;
      })}</tbody></table>}
    </div>
    <h3>局部关系图 · 深度 2 / 上限 40</h3>
    {!rootId ? <p role="status">先选择记录作为局部图根节点；不生成全仓毛线球。</p> : resource.error ? <p role="alert">局部图读取失败，关系列表仍可使用：{resource.error.message}<button className="button" onClick={resource.retry}>重试固定局部图</button></p>
      : !graph ? <p role="status">读取固定版本局部图…</p> : <>
        <p>{graph.truncated ? "⚠ 图已截断；缺少的端点或关系不能当作不存在。" : "同一事实集的局部技术联系，不是业务概念图。"}</p>
        {projected.unavailableFactIds.length > 0 && <p className="f002-notice" role="status">部分关系缺少获准端点或与事实记录不一致，未画确定连线；请从事实与依据核查。</p>}
        <div className="f002-actions">
          <button className="button" aria-label="缩小局部关系图" disabled={viewport.zoom <= .25} onClick={() => explore({ zoom: Math.max(.25, viewport.zoom - .25) })}>缩小</button>
          <button className="button" aria-label="放大局部关系图" disabled={viewport.zoom >= 4} onClick={() => explore({ zoom: Math.min(4, viewport.zoom + .25) })}>放大</button>
          <button className="button" aria-label="向左平移局部关系图" onClick={() => explore({ x: Math.max(-100_000, viewport.x - 40) })}>←</button>
          <button className="button" aria-label="向右平移局部关系图" onClick={() => explore({ x: Math.min(100_000, viewport.x + 40) })}>→</button>
          <button className="button" aria-label="向上平移局部关系图" onClick={() => explore({ y: Math.max(-100_000, viewport.y - 40) })}>↑</button>
          <button className="button" aria-label="向下平移局部关系图" onClick={() => explore({ y: Math.min(100_000, viewport.y + 40) })}>↓</button>
          <button className="button" onClick={() => explore(emptyGraphViewport())}>重置局部图视口</button><span aria-live="polite">{Math.round(viewport.zoom * 100)}%</span>
        </div>
        <svg viewBox="0 0 500 400" role="group" aria-label="局部关系图，节点与关系可用键盘选择">
          <defs><marker id="f002-local-direction" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M 0 0 L 8 4 L 0 8 z" fill="var(--graph-edge)" /></marker></defs>
          <g data-graph-viewport="true" transform={`translate(${viewport.x} ${viewport.y}) translate(250 200) scale(${viewport.zoom}) translate(-250 -200)`}>
            {projected.edges.map(edge => {
              const a = points.get(edge.subject.id)!, b = points.get(edge.target.id)!;
              const d = edge.subject.id === edge.target.id ? `M ${a.x} ${a.y} C ${a.x + 60} ${a.y - 60},${a.x - 60} ${a.y - 60},${a.x} ${a.y}` : `M ${a.x} ${a.y} L ${b.x} ${b.y}`;
              return <g key={edge.fact.id} role="button" tabIndex={0} aria-label={`选择关系 ${edge.fact.payload.predicate} ${edge.fact.id}`} aria-pressed={context.recordId === edge.fact.id}
                data-edge-fact-id={edge.fact.id} className={context.recordId === edge.fact.id ? "selected" : ""} onClick={() => select(edge.fact)} onKeyDown={event => keyActivate(event, () => select(edge.fact))}>
                <path d={d} className="f002-edge-hit" stroke="transparent" strokeWidth="16" fill="none" /><path d={d} stroke="var(--graph-edge)" strokeWidth="2" markerEnd="url(#f002-local-direction)" fill="none" /><title>{edge.fact.payload.predicate} · {edge.fact.id}</title>
              </g>;
            })}
            {projected.nodes.map(node => { const point = points.get(node.id)!; return <g key={`${node.kind}:${node.id}`} role="button" tabIndex={0} aria-label={`查看对象 ${title(node)} ${node.id}`}
              data-node-id={node.id} onClick={() => selected && [selected.payload.subjectId, selected.payload.targetId].includes(node.id) ? openEndpoint(selected, node) : openObject(node)}
              onKeyDown={event => keyActivate(event, () => selected && [selected.payload.subjectId, selected.payload.targetId].includes(node.id) ? openEndpoint(selected, node) : openObject(node))}>
              <circle cx={point.x} cy={point.y} r="10" fill="var(--graph-node)" stroke="var(--accent)" /><text x={point.x + 14} y={point.y + 4} fill="var(--ink)" fontSize="12">{title(node).slice(0, 18)}</text><title>{title(node)} · {node.id}</title>
            </g>; })}
          </g>
        </svg>
        <p className="f002-caption">图与上方等价关系列表共用完整 Fact 引用。键盘 Enter／空格选择节点或边，方向按钮平移；关闭依据、主题或页面整体缩放不会重置探索视口。</p>
      </>}
  </section>;
}
