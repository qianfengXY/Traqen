"use client";
import { useId, useState } from "react";
import { kindNames, materialPath, propositionName, propositionState, shortId } from "./model.ts";
import type { BusinessGraph, GraphMaterial, Proposition } from "./types.ts";
import {CoverageView} from "./coverage-view.tsx";

export function PropositionDetails({ record, onMaterial }: { record: Proposition; onMaterial: (id: string) => void }) {
  return <div className="bk-proposition"><p className="bk-caption">{propositionState(record)}</p><p>{record.statement ?? record.predicate}</p><p><b>适用范围：</b>{record.scope}</p>
    {record.uncertainties.length > 0 && <div className="bk-warning"><b>尚不确定</b><ul>{record.uncertainties.map((value, i) => <li key={i}>{value}</li>)}</ul></div>}
    {record.verification && <details><summary>核查理由与前提</summary><p>{record.verification.rationale}</p><ul>{record.verification.premises?.map((value, i) => <li key={i}>{value}</li>)}</ul>{record.verification.unresolvedConflicts?.map((value, i) => <p key={i}>未解冲突：{value}</p>)}</details>}
    <h4>原文依据 · {record.evidence.length}</h4>{record.evidence.length === 0 && <p>没有可引用原文，不能视为有依据的确认。</p>}
    {record.evidence.map((citation, i) => <blockquote key={i}><p>{citation.quote}</p><footer><button className="bk-text-button" onClick={() => onMaterial(citation.materialId)}>回查原文 · 行{citation.startLine}–{citation.endLine}</button></footer></blockquote>)}
    {record.technicalRefs.length > 0 && <details><summary>采用的技术事实引用 · {record.technicalRefs.length}</summary><ul>{record.technicalRefs.map(ref => <li key={ref}><code>{ref}</code></li>)}</ul><p>这些是明确采用版本中的技术事实，不是人工确认或运行证明。</p></details>}
  </div>;
}

export function MaterialList({ materials, onMaterial }: { materials: GraphMaterial[]; onMaterial: (id: string) => void }) {
  return <ul className="bk-materials">{materials.map(material => <li key={material.id}><button className="bk-text-button" onClick={() => onMaterial(material.id)}>{materialPath(material.sourceMaterial.pathBytes)}</button><span>{kindNames[material.assetType] ?? material.assetType}</span><small>原文摘要 {shortId(material.sourceMaterial.contentDigest)}</small></li>)}</ul>;
}

function edgePath(source:{x:number;y:number},target:{x:number;y:number}) {
  // Cards are 216 × 62. Clip both ends to their border, leaving a small
  // marker gap; a center-to-center arrow is hidden by the target card.
  const dx=target.x-source.x,dy=target.y-source.y;
  if(!dx&&!dy)return `M${source.x+220},${source.y+31} C${source.x+250},${source.y-20} ${source.x+108},${source.y-25} ${source.x+108},${source.y-4}`;
  const fraction=1/Math.max(Math.abs(dx)/112,Math.abs(dy)/35);
  return `M${source.x+108+dx*fraction},${source.y+31+dy*fraction} L${target.x+108-dx*fraction},${target.y+31-dy*fraction}`;
}

function GraphMap({ graph, selectedKey, onSelect }: { graph: BusinessGraph; selectedKey: string; onSelect: (key: string) => void }) {
  const arrowId = useId().replace(/:/g, "");
  const nodes = graph.nodes.slice(0, 24), positions = new Map(nodes.map((node, i) => [node.key, { x: 20 + i % 3 * 250, y: 30 + Math.floor(i / 3) * 110 }]));
  const edges = graph.edges.filter(edge => positions.has(edge.sourceKey!) && positions.has(edge.targetKey!));
  return <div className="bk-map" aria-label="业务关联图">
    <svg viewBox={`0 0 770 ${Math.max(160, Math.ceil(nodes.length / 3) * 110 + 20)}`} role="group" aria-label="可选择的业务对象与有向关系">
      <defs><marker id={arrowId} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" /></marker></defs>
      {edges.map(edge => { const source = positions.get(edge.sourceKey!)!, target = positions.get(edge.targetKey!)!;
        return <g key={edge.key}><title>{`${edge.predicate} · ${edge.scope}`}</title><path className="bk-map-edge" markerEnd={`url(#${arrowId})`} d={edgePath(source,target)} /></g>; })}
      {nodes.map(node => { const point = positions.get(node.key)!; return <g key={node.key} role="button" aria-label={`查看${propositionName(node)}`} aria-pressed={selectedKey === node.key} tabIndex={0}
        onClick={() => onSelect(node.key)} onKeyDown={event => { if (["Enter", " "].includes(event.key)) { event.preventDefault(); onSelect(node.key); } }} className="bk-map-node" transform={`translate(${point.x},${point.y})`}>
        <title>{`${propositionName(node)} · ${propositionState(node)}`}</title><rect width="216" height="62" rx="9" /><text x="12" y="24">{Array.from(propositionName(node)).slice(0, 17).join("")}</text><text className="bk-map-kind" x="12" y="45">{kindNames[node.kind ?? ""] ?? "业务命题"} · {node.state === "ANALYSIS_ACCEPTED" ? "分析态" : "待查"}</text></g>; })}
    </svg>
    <p className="bk-caption">箭头保留服务端关系方向，几何位置不表示因果或层级。图示最多24个对象；完整对象可从下方列表和服务端搜索查阅。</p>
  </div>;
}

export function GraphView({ graph, selectedKey, onSelect, onMaterial }: { graph: BusinessGraph; selectedKey: string;
  onSelect: (key: string) => void; onMaterial: (id: string) => void }) {
  const [limit, setLimit] = useState(40);
  const names = new Map([...graph.nodes.map(node => [node.key, propositionName(node)] as const), ...graph.materials.map(material => [material.id, materialPath(material.sourceMaterial.pathBytes)] as const)]);
  return <div className="bk-graph-result">
    <p className="bk-caption">{graph.nodes.length}个对象 · {graph.edges.length}条关系 · 另有{graph.uncertaintyCount}个非收录候选。只读查询不会重新调用模型。</p>
    {graph.view !== "COVERAGE" && graph.nodes.length > 0 && <GraphMap graph={graph} selectedKey={selectedKey} onSelect={onSelect} />}
    {graph.view !== "COVERAGE" && !graph.nodes.length && <div className="bk-empty"><h3>当前筛选内没有业务对象</h3><p>可能尚无可靠解释，或筛选排除了待查内容；这不等于材料已全部理解、系统无业务能力或测试已通过。</p></div>}
    {graph.view === "COVERAGE" ? <CoverageView entries={graph.coverage} onMaterial={onMaterial}/>
      : <section><h3>业务对象</h3><div className="bk-node-list">{graph.nodes.slice(0, limit).map(node => <button key={node.key} className="bk-node" aria-pressed={node.key === selectedKey} onClick={() => onSelect(node.key)}><span>{kindNames[node.kind ?? ""] ?? "业务命题"}</span><b>{propositionName(node)}</b><small>{propositionState(node)}</small></button>)}</div>{graph.nodes.length > limit && <button className="button" onClick={() => setLimit(value => value + 40)}>显示更多对象</button>}</section>}
    {graph.edges.length > 0 && <section><h3>有向关系</h3><p>以下为分析关系；每条的适用范围、依据和未知独立保留，不代表真实执行。</p>{graph.edges.slice(0, limit).map(edge => <details key={edge.key} className="bk-edge"><summary>{names.get(edge.sourceKey!) ?? shortId(edge.sourceKey!)} → {edge.predicate} → {names.get(edge.targetKey!) ?? shortId(edge.targetKey!)}</summary><PropositionDetails record={edge} onMaterial={onMaterial} /><button className="button" onClick={()=>onSelect(edge.key)}>查看关系决定与执行</button></details>)}{graph.edges.length > limit && <button className="button" onClick={() => setLimit(value => value + 40)}>显示更多关系</button>}</section>}
    {graph.view === "IMPLEMENTATION" && <section><h3>实现材料与独立关系依据</h3><MaterialList materials={graph.materials} onMaterial={onMaterial} />{!graph.materials.length && <p>当前筛选没有已读材料关联；未把未读材料记为已有依据。</p>}</section>}
    <details><summary>当前保存图谱的固定来源</summary><dl className="bk-identities"><dt>图谱摘要</dt><dd>{graph.graphDigest}</dd><dt>原材料</dt><dd>{graph.sourceBundleId}</dd><dt>固定模型配置</dt><dd>{graph.profileId}</dd><dt>此图谱采用的技术依据</dt><dd>{graph.adoptedVersionIds.join("、") || "未采用"}</dd></dl></details>
  </div>;
}
