"use client";
import {useCallback,useEffect,useRef} from 'react';
import type {BusinessKnowledgeClient} from './client.ts';
import type {PublishedVersion} from './authority-types.ts';
import {useKnowledgeRead} from './use-read.ts';
import {ReadIssue} from './read-issue.tsx';
import {materialPath} from './model.ts';

function Download({data,name}:{data:Uint8Array;name:string}){
  const link=useRef<HTMLAnchorElement>(null);
  useEffect(()=>{const target=link.current;if(!target)return;const value=URL.createObjectURL(new Blob([new Uint8Array(data)],{type:'application/octet-stream'}));target.href=value;return()=>{target.removeAttribute('href');URL.revokeObjectURL(value);};},[data]);
  return <a ref={link} className="button" download={name.split(/[\\/]/).at(-1)||'original.bin'}>下载已核验原文</a>;
}
export function PublishedOriginal({client,version,id,onAccessLost}:{client:BusinessKnowledgeClient;version:PublishedVersion;id:string;onAccessLost:(e:Error)=>void}){
  const revision=version.publication.graphRevisionId,digest=version.publication.graphDigest;
  const load=useCallback(async(bound:BusinessKnowledgeClient)=>{
    const reader=bound.publishedReads(version),page=await reader.materials(),material=page.materials.find(m=>m.id===id);
    if(!material)throw Error('此原文不属于选定发布版本，未读取其他版本或私人调查。');
    return {material,...await reader.material(material)};
  },[version,id]);
  const state=useKnowledgeRead(client,`published-original:${revision}:${digest}:${id}`,load,onAccessLost);
  return <section className="bk-panel" aria-label="发布版本原文"><h3>发布版本原文</h3>
    <p>版本、来源、收据及实际字节摘要核验后展示。仅显示文本，不执行原文中的网页或脚本。</p>
    {state.loading&&<p role="status">正在核验发布版本和原文字节…</p>}{state.error&&<ReadIssue error={state.error} retry={state.retry}/>}
    {state.data&&<><h4>{materialPath(state.data.material.sourceMaterial.pathBytes)}</h4><p>摘要已核对：<code>{state.data.digest}</code> · {state.data.bytes}字节</p>
      {state.data.text===null?<p>此材料不是可显示的UTF-8文本；可以下载已核验字节，没有将它当作网页或脚本。</p>:<pre className="bk-original" tabIndex={0}>{state.data.text}</pre>}
      <Download data={state.data.data} name={materialPath(state.data.material.sourceMaterial.pathBytes)}/>
    </>}
  </section>;
}
