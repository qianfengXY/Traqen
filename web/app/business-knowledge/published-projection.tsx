import type {CurrentPublishedProjection,PublishedExecutionTarget} from './published-client.ts';
const labels:Record<string,string>={UNMAPPED:'尚未映射',BOUND_TARGETS_CONFIRMED:'所列目标已确认',PARTIALLY_CONFIRMED:'仅部分目标已确认',NO_CURRENT_CONFIRMATION:'尚无当前有效确认',QUARANTINED:'已隔离',UNKNOWN:'未知',STALE:'已过期或版本不再适用',UNRESOLVED:'存在未解冲突',PASS:'通过（仅精确测试目标）',FAIL:'失败',NOT_RUN:'未运行'};
const axes={authority:'人工复核',conformance:'实现符合性',verification:'可信执行',freshness:'时效与版本',conflict:'冲突'};
export function PublishedProjection({value}:{value:CurrentPublishedProjection}){
  return <section aria-label="当前状态分项"><h4>当前状态分项</h4>
    {value.selectionRole==='ENDPOINT_CONTEXT_ONLY'&&<p className="bk-warning">此对象仅用于说明关系端点，没有据此确认这个对象。</p>}
    <p>{labels[value.currentAuthority.status]??'复核情况未知'} · {value.currentAuthority.confirmedTargets.length}/{value.currentAuthority.targets.length}个明确命题与适用范围。映射不代表整个对象或子图获得认可。</p>
    <dl className="bk-identities">{Object.entries(axes).map(([key,label])=><div key={key}><dt>{label}</dt><dd>{labels[value.stateDimensions[key as keyof typeof axes].status]??'未知'}</dd></div>)}</dl>
    <h5>明确执行目标 · 完整声明集合 {value.currentExecution.targets.length}项</h5>
    <p>保留失效映射及未运行目标，不把仍有效的子集推广为整个业务对象通过。</p>
    {value.currentExecution.targets.map((target,i)=><ExecutionScope key={i} target={target}/>)}
    {!value.currentExecution.targets.length&&<p>未声明固定执行目标，不代表整个对象通过。</p>}
    <p className="bk-caption">原分析、人工决定、执行证据、时效与冲突分别保留；不会合成一个“全部通过”状态。历史决定和执行记录见下方精确映射。</p>
  </section>;
}
function ExecutionScope({target}:{target:PublishedExecutionTarget}){
 return <details><summary>{target.testSpecId} v{target.testSpecVersion} · {labels[target.status]??'未知'}</summary>
  <p>命题 {target.claimId} v{target.claimVersion} · 范围 {target.scopeId} v{target.scopeVersion}</p>
  <p>{target.mappingCurrent===true?'映射仍为当前版本':target.mappingCurrent===false?'映射已失效':'映射时效未知'} · {target.authorityApplies===true?'人类决定适用于此目标':'未据此建立适用的人类确认'}</p>
  <p>快照 {target.snapshotManifestId} · 环境 {target.deploymentId}；此状态只描述所列测试目标。</p>
  <ol>{target.history?.map(h=><li key={h.id}>{h.trusted?(labels[h.status]??h.status):'可信依据未知'} · {h.receivedAt} · {h.id}</li>)}</ol>
 </details>;
}
