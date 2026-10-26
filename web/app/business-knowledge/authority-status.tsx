import type {AuthorityResponse,DecisionRecord,VerificationProjection} from "./authority-types.ts";
const decisionNames:Record<string,string>={UNREVIEWED:"尚无人类决定",CONFIRMED:"人类已确认",REJECTED:"人类已拒绝",EXCEPTION_RECORDED:"已记录例外",DEPRECATED:"已失效或到期"};
const executionNames:Record<string,string>={NOT_RUN:"未运行",UNKNOWN:"可信依据未知",PASS:"通过",FAIL:"失败",ERROR:"执行错误",INCONCLUSIVE:"无法判定",SKIPPED:"已跳过",CANCELLED:"已取消"};
function Decision({value}:{value:DecisionRecord}) {
  return <li><b>{decisionNames[value.type]??value.type}</b> · {value.createdAt}<p>{value.content}</p><p>决定人 {value.actorId} · 角色 {value.actorRole} · 有效截止 {value.validUntil??"未设置"}</p><small>决定记录 {value.id}</small></li>;
}
function Execution({value}:{value:VerificationProjection}) {
  const trusted=["NOT_RUN","UNKNOWN"].includes(value.status)||value.history[0]?.trusted===true;
  return <article className="bk-authority-target"><h5>执行目标：{value.testSpecId} · v{value.testSpecVersion}</h5>
    <p>当前执行状态：{executionNames[trusted?value.status:"UNKNOWN"]??"未知状态"}；测试方案{value.testSpecApproved?"已获批准":"未获批准"}。</p>
    <p className="bk-caption">SnapshotManifest {value.snapshotManifestId} · 环境 {value.deploymentId}</p>
    <p>{value.ordering==="UNDETERMINED_RECEIPT_ORDER"?"无法确定最新接收顺序，不挑选旧通过结果。":"按服务端接收时间读取；较晚失败不会被旧通过掩盖。"}</p>
    <details><summary>执行历史 · {value.history.length}{value.truncated?"（清单已截断）":""}</summary><ol>{value.history.map(record=><li key={record.id}>
      {record.trusted?(executionNames[record.status]??"未知状态"):"可信依据未知"} · 接收 {record.receivedAt}<p>记录 {record.id} · {record.trusted?"服务器已核验签名与目标":"未能核验可信依据"}</p>
      <p>证据引用：{record.evidenceRefs.join("、")||"无可信证据引用"}</p></li>)}</ol></details>
  </article>;
}
export function AuthorityStatus({value}:{value:AuthorityResponse}) {
  const {bindingSet,projection,currentBindingVersion}=value;
  return <section aria-label="人类决定与可信执行"><h3>人类决定与可信执行</h3><p>原分析状态：{projection.analysisState}。映射、人类决定、可信执行分别来自独立服务端记录，不互相代替。</p>
    {!bindingSet?<p>此精确发布版本的对象尚无显式权威映射；不按名字或模型分析推断确认与执行。</p>:<>
      <p>映射集合 v{bindingSet.version} · 当前集合 v{currentBindingVersion}{bindingSet.version!==currentBindingVersion?" · 正在查看历史映射":""}</p>
      <p>映射理由：{bindingSet.rationale}</p>{!bindingSet.targets.length&&<p>本次集合已显式清空；旧集合仍可按修订回查。</p>}
      {projection.targets.map(target=><article key={`${target.claimId}:${target.claimVersion}`} className="bk-authority-target"><h4>{target.claimId} · v{target.claimVersion}</h4>
        <p>Feature {target.featureId} · v{target.featureVersion}；范围 {target.scopeId} · v{target.scopeVersion}</p>
        <p>人类决定：{decisionNames[target.authority.status]??"决定状态未知"}</p>
        <p>范围{target.authority.scopeActive?"有效":"已失效"} · 版本{target.authority.versionCurrent?"仍为当前版本":"已不是当前版本"} · {target.authority.applies?"决定适用于此绑定":"决定不适用于此绑定"}</p>
        <details><summary>适用范围快照</summary><pre>{JSON.stringify(target.scope,null,2)}</pre></details>
        {target.authority.latestDecision&&<p>原决定类型：{target.authority.latestDecision.type} · 有效截止 {target.authority.latestDecision.validUntil??"未设置"}。到期不改写原决定。</p>}
        <details><summary>人类决定历史 · {target.authority.history.length}{target.authority.historyTruncated?"（清单已截断）":""}</summary><ol>{target.authority.history.map(record=><Decision key={record.id} value={record}/>)}</ol></details>
        <h4>可信执行</h4>{target.verification.length?target.verification.map((record,i)=><Execution key={i} value={record}/>):<p>未选择固定执行目标；静态测试资产不表示曾执行。</p>}
      </article>)}
    </>}
    <p className="bk-caption">投影时间 {projection.evaluatedAt}。查询不会创建命题、批准决定、摄取执行或修改原图谱。</p>
  </section>;
}
