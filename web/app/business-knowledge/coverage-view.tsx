"use client";
import {useState} from "react";
import type {CoverageEntry} from "./types.ts";

type Ranges = [number, number][];
const labels: Record<string,string> = {UNKNOWN:"传输情况未知",NOT_SUPPLIED:"未传输给模型",PARTIALLY_SUPPLIED:"部分字节已传输",FULLY_SUPPLIED:"全部字节已传输"};
function validRanges(value: unknown): value is Ranges {
  return Array.isArray(value) && value.every(pair => Array.isArray(pair) && pair.length === 2
    && Number.isSafeInteger(pair[0]) && Number.isSafeInteger(pair[1]) && pair[0] >= 0 && pair[1] >= pair[0]);
}
function rangesLabel(ranges: Ranges) {return ranges.map(([start,end])=>`[${start}, ${end})`).join("、") || "无已记录区间";}
function ByteRanges({label,ranges}:{label:string;ranges:Ranges}) {
  const [limit,setLimit]=useState(32);
  return <div><p>{label} · {ranges.length}段</p><p className="bk-caption">{rangesLabel(ranges.slice(0,limit))}</p>
    {ranges.length>limit&&<button className="bk-text-button" onClick={()=>setLimit(v=>v+32)}>显示更多{label}</button>}</div>;
}
export function ModelTransport({entry}:{entry:CoverageEntry}) {
  const value=entry.modelInput;
  if(value===undefined)return <p>旧图谱未记录模型片段，传输情况未知。</p>;
  if(!value || !labels[value.status] || value.meaning!=="TRANSPORT_COVERAGE_NOT_SEMANTIC_COMPLETENESS"
    || !validRanges(value.suppliedByteRanges) || !validRanges(value.pendingByteRanges)
    || (value.status==="NOT_SUPPLIED"&&value.suppliedByteRanges.length!==0)) return <p className="bk-warning">模型片段记录不可核对；不推断传输完整。</p>;
  return <><p>{labels[value.status]}</p><details><summary>已传输与待处理字节范围</summary>
    <p className="bk-caption">UTF-8 半开字节范围；仅表示片段传输，不代表业务理解完整。</p>
    <ByteRanges label="已传输" ranges={value.suppliedByteRanges}/><ByteRanges label="待处理" ranges={value.pendingByteRanges}/>
  </details></>;
}
export function CoverageView({entries,onMaterial}:{entries:CoverageEntry[];onMaterial:(id:string)=>void}) {
  const [limit,setLimit]=useState(40);
  return <section aria-label="材料覆盖明细"><h3>材料与覆盖</h3><p>采集、原文读取、模型片段传输和业务关联分别记录。运输完整不代表业务理解完整；已有分析关联不消除待处理片段。</p>
    <div className="bk-table-scroll"><table className="bk-coverage"><thead><tr><th>材料</th><th>采集状态</th><th>原文读取</th><th>模型片段传输</th><th>业务关联</th><th>原因与回查</th></tr></thead>
      <tbody>{entries.slice(0,limit).map(entry=><tr key={entry.key}><td>{entry.path||"不可显示的路径"}</td><td>{String(entry.disposition??"未确认")}</td>
        <td>{entry.sourceReadStatus==="READ"?"已读取原文":entry.sourceReadStatus==="UNREAD"?"尚未读取原文":"读取情况未知"}</td><td><ModelTransport entry={entry}/></td>
        <td>{entry.businessStatus==="ASSOCIATED"?"已有分析关联":entry.businessStatus==="UNASSOCIATED"?"尚未关联":"关联情况未知"}</td>
        <td>{entry.investigationReason||String(entry.reasonCode??"未记录原因")}{entry.materialId&&<button className="bk-text-button" onClick={()=>onMaterial(entry.materialId!)}>查询已读原文与业务关联</button>}</td></tr>)}</tbody></table></div>
    {entries.length>limit&&<button className="button" onClick={()=>setLimit(v=>v+40)}>显示更多覆盖条目</button>}
  </section>;
}
