import type {KnowledgeAnswer} from './work-types.ts';
const record=(v:unknown):Record<string,unknown>|null=>v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:null;
const count=(v:unknown)=>Number.isSafeInteger(v)&&Number(v)>=0?Number(v):null;
export function AnswerContext({answer}:{answer:KnowledgeAnswer}){
  const premise=record(answer.premiseContext),process=Array.isArray(answer.process)?answer.process:[];
  return <section aria-label="答案依据与处理范围">
    {premise?<details><summary>实际原文前提闭包与缺口（局部窗口，不是语义完整或业务批准）</summary>
      <p>待处理对象：{Array.isArray(premise.pendingObjects)?premise.pendingObjects.length:'未记录'}；缺失依据：{Array.isArray(premise.missingEvidence)?premise.missingEvidence.length:'未记录'}。未提供的字段保持未知，不补写旧记录。</p>
      <pre>{JSON.stringify(premise,null,2)}</pre></details>:<p>本答案未记录可核实的原文前提范围；保持未知，不冒充已完成核查。</p>}
    <details><summary>各次调用的实际输入与隔离范围</summary>
      <p>待处理表示有资格但未装入本次预算的内容；隔离表示无效原始内容未进入语义核查，不是删除旧记录或获得支持。传输与字节数不代表业务理解完整。</p>
      {answer.questionContractVersion!==4&&<p>旧版或未识别版本按其保存格式展示，不自动迁移或重跑。</p>}
      {process.map((value,i)=>{const p=record(value),r=record(p?.resourceContext),isolated=record(r?.isolatedItems);if(!p||!r)return null;
        const supplied=count(r.suppliedItems),pending=count(r.pendingItems),invalid=count(isolated?.count),requested=count(r.requestedItems);
        const coherent=supplied!==null&&pending!==null&&invalid!==null&&requested!==null&&requested===supplied+pending+invalid;
        return <article key={i} className="bk-edge"><h5>调用 {typeof p.taskKey==='string'?p.taskKey:i+1}</h5>
          <p>实际输入：{count(p.inputBytes)??'未知'}/{count(p.maxInputBytes)??count(r.maxInputBytes)??'未知'}字节；技术上下文：{count(p.technicalContextBytes)??'未知'}字节。</p>
          {r.authority==='ROUTING_NOT_EVIDENCE'?<p>仅用于任务路由，不是语义证据。</p>:<>
            <p>已供应{supplied??'未知'}项 · 待处理{pending??'未知'}项 · 隔离{invalid??'未知'}项；请求总量{requested??'未知'}项。</p>
            {!coherent&&<p className="bk-warning">计量字段不完整或不能对齐，未推断处理完整。</p>}
          </>}
          <details><summary>保存的计量与范围字段</summary><pre>{JSON.stringify(r,null,2)}</pre></details>
        </article>;
      })}
    </details>
  </section>;
}
