"use client";
import { useCallback, useEffect, useRef } from "react";
import { BusinessKnowledgeClient } from "./client.ts";
import { useKnowledgeRead } from "./use-read.ts";
import { MaterialList, PropositionDetails } from "./graph-view.tsx";
import { materialPath, propositionState, shortId } from "./model.ts";
import type { GraphMaterial, Investigation, SevenQuestions } from "./types.ts";
import {AuthorityPanel} from "./authority-panel.tsx";
import {ReadIssue} from "./read-issue.tsx";
export {ReadIssue} from "./read-issue.tsx";

export function TracePanel({ client, run, target, onSelect, onMaterial, onAccessLost, onClose, canControl=false }: {
  client: BusinessKnowledgeClient; run: Investigation; target: { key: string } | { materialId: string };
  onSelect: (key: string) => void; onMaterial: (id: string) => void; onAccessLost: (error: Error) => void; onClose: () => void;
  canControl?:boolean;
}) {
  const targetKey = "key" in target ? target.key : target.materialId;
  const byKey = "key" in target;
  const load = useCallback(async(bound: BusinessKnowledgeClient) => {
    const fixed={graphDigest:run.latestGraph?.digest??"",sourceBundleId:run.sourceInput.sourceBundleSnapshotId,profileId:run.profile.id};
    return byKey?bound.inspect(run.id,targetKey,fixed):{...await bound.trace(run.id,{materialId:targetKey},fixed),relation:false};
  },
    [run.id, run.latestGraph?.digest, run.sourceInput.sourceBundleSnapshotId, run.profile.id, byKey, targetKey]);
  const trace = useKnowledgeRead(client, `trace:${run.id}:${run.latestGraph?.digest}:${byKey?"object":"material"}:${targetKey}`, load, onAccessLost);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { const current = dialog.current; current?.showModal(); return () => current?.close(); }, []);
  const selected = [...(trace.data?.nodes??[]),...(trace.data?.edges??[])].find(node => "key" in target && node.key === target.key);
  return <dialog ref={dialog} className="bk-inspector-dialog" aria-label="业务依据追溯" onCancel={event => { event.preventDefault(); onClose(); }}><div className="bk-panel bk-inspector"><div className="bk-heading"><h2>{"key" in target ? "命题与依据" : "材料反查"}</h2><button className="button" onClick={onClose}>关闭追溯</button></div>
    {trace.loading && <p role="status">正在复验当前调查与依据…</p>}
    {trace.error && <ReadIssue error={trace.error} retry={trace.retry} />}
    {trace.data && <>{selected && <><h3>{selected.name??selected.predicate}</h3><PropositionDetails record={selected} onMaterial={onMaterial} /><AuthorityPanel key={`${run.id}:${run.latestGraph?.digest}:${selected.key}`} client={client} run={run} objectKey={selected.key} canControl={canControl} onAccessLost={onAccessLost}/></>}
      {"materialId" in target && <><h3>相关业务对象 · {trace.data.nodes.length}</h3>{trace.data.nodes.map(node => <p key={node.key}><button className="bk-text-button" onClick={() => onSelect(node.key)}>{node.name}</button> · {propositionState(node)}</p>)}{!trace.data.nodes.length && <p>材料已读，但没有关联业务对象；不推断不存在业务关系。</p>}</>}
      <h3>关联原文</h3><MaterialList materials={trace.data.materials} onMaterial={onMaterial} />
      {"materialId" in target && trace.data.materials.find(material => material.id === target.materialId) && <OriginalMaterial key={target.materialId}
        client={client} runId={run.id} material={trace.data.materials.find(material => material.id === target.materialId)!} onAccessLost={onAccessLost} />}
      {trace.data.edges.length > 0 && <section><h3>关系依据</h3>{trace.data.edges.map(edge => <details key={edge.key}><summary>{edge.predicate} · {propositionState(edge)}</summary><PropositionDetails record={edge} onMaterial={onMaterial} /></details>)}</section>}
      {"key" in target && (trace.data.relation?<section><h3>关系端点与业务七问</h3><p>本关系的独立依据与权威映射如上；服务端七问以业务对象为单位。选择明确端点后读取其七问，不以端点决定代替关系决定。</p>{trace.data.nodes.map(node=><p key={node.key}><button className="bk-text-button" onClick={()=>onSelect(node.key)}>读取端点七问：{node.name}</button></p>)}</section>
        :<SevenQuestionPanel client={client} run={run} objectKey={target.key} onMaterial={onMaterial} onSelect={onSelect} onAccessLost={onAccessLost} />)}
    </>}
  </div></dialog>;
}

function OriginalMaterial({ client, runId, material, onAccessLost }: { client: BusinessKnowledgeClient; runId: string; material: GraphMaterial; onAccessLost: (error: Error) => void }) {
  const load = useCallback((bound: BusinessKnowledgeClient) => bound.material(runId, material), [runId, material]);
  const content = useKnowledgeRead(client, `original:${runId}:${material.id}`, load, onAccessLost);
  return <section aria-label="原文回查"><h3>{materialPath(material.sourceMaterial.pathBytes)}</h3>
    <p>原始材料，按当前权限读取；不是模型解释或技术脱敏副本。只作为文本显示，不执行其中内容。</p>
    {content.loading && <p role="status">正在核验原文字节摘要…</p>}{content.error && <ReadIssue error={content.error} retry={content.retry} />}
    {content.data && <><p>摘要已核对：<code>{content.data.digest}</code> · {content.data.bytes}字节</p>{content.data.text === null ? <p>该材料不是可显示的 UTF-8 文本；没有将其解释为网页或脚本。</p> : <pre className="bk-original" tabIndex={0}>{content.data.text}</pre>}</>}
  </section>;
}

export function SevenAnswers({ answer, onMaterial, onSelect }: { answer: SevenQuestions; onMaterial: (id: string) => void; onSelect: (key: string) => void }) {
  return <div aria-label="图谱派生七问"><p>从此保存版本派生的查询答卷，不调用模型，不是人工确认。</p>{answer.sections.map((section, index) => <section className="bk-answer" key={index}><h4>{index + 1}. {section.question}</h4>
    {section.nodes?.map(node => <p key={node.key}><button className="bk-text-button" onClick={() => onSelect(node.key)}>{node.name}</button>：{node.statement} <small>{propositionState(node)}</small></p>)}
    {section.nodes?.length === 0 && <p>当前依据内未知，未补造结论。</p>}
    {(section.materials || section.testAssets) && <MaterialList materials={section.materials ?? section.testAssets ?? []} onMaterial={onMaterial} />}
    {section.relations?.map(relation => <p key={relation.key}>{relation.predicate} · {relation.scope} · {propositionState(relation)}</p>)}
    {section.executionStatus && <p className="bk-warning">原分析答卷未关联真实执行记录。发布版本的显式映射与当前可信执行另列，不改写这份原答卷；测试资产或断言存在，不等于测试已通过。</p>}
    {section.environmentStatus && <p>原材料版本：{shortId(section.sourceBundleId ?? "")}；技术版本：{section.adoptedVersionIds?.map(shortId).join("、") || "未采用"}。分析材料不能证明实际运行环境。</p>}
    {section.evidence?.map((citation, i) => <blockquote key={i}><p>{citation.quote}</p><button className="bk-text-button" onClick={() => onMaterial(citation.materialId)}>查看原文 · 行{citation.startLine}–{citation.endLine}</button></blockquote>)}
    {section.uncertainties?.map(item => <div key={item.key}><p>{item.state === "ANALYSIS_ACCEPTED" ? "分析收录，仍受以下前提约束" : "待查解释"}</p><ul>{[...item.premises, ...item.uncertainties].map((text, i) => <li key={i}>{text}</li>)}</ul></div>)}
    {!!section.unassociatedMaterials?.length && <p>仍有{section.unassociatedMaterials.length}份未关联材料，见覆盖视图；不能据此声称完整理解。</p>}
  </section>)}</div>;
}
function SevenQuestionPanel({ client, run, objectKey, onMaterial, onSelect, onAccessLost }: {
  client: BusinessKnowledgeClient; run: Investigation; objectKey: string; onMaterial: (id: string) => void; onSelect: (key: string) => void; onAccessLost: (error: Error) => void;
}) {
  const load = useCallback((bound: BusinessKnowledgeClient) => bound.sevenQuestions(run.id, objectKey,
    {graphDigest:run.latestGraph?.digest??"",sourceBundleId:run.sourceInput.sourceBundleSnapshotId,profileId:run.profile.id}),
    [run.id, run.latestGraph?.digest, run.sourceInput.sourceBundleSnapshotId, run.profile.id, objectKey]);
  const answer = useKnowledgeRead(client, `seven:${run.id}:${run.latestGraph?.digest}:${objectKey}`, load, onAccessLost);
  return <section><h3>业务七问</h3>{answer.loading && <p role="status">读取已保存图谱的派生答卷…</p>}{answer.error && <ReadIssue error={answer.error} retry={answer.retry} />}{answer.data && <SevenAnswers answer={answer.data} onMaterial={onMaterial} onSelect={onSelect} />}</section>;
}
