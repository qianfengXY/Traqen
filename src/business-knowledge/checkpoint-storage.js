import {createHash} from 'node:crypto';
import {TextDecoder} from 'node:util';
import {canonicalEncode} from '../source-truth/identity.js';
import {requireF003} from './errors.js';
import {intactBusinessGraph} from './semantic-graph.js';

// Same immutable table and owning transaction. The old physical row bound is
// unchanged; logical aggregates have a separate finite 64x1MiB envelope.
export const checkpointRowBytes=2*1024*1024;
export const checkpointChunkBytes=1024*1024;
export const checkpointMaxChunks=64;
export const checkpointDocumentBytes=checkpointChunkBytes*checkpointMaxChunks;
export const checkpointChunkPrefix='__f003_blob_';
const manifestKind='F003_CHECKPOINT_MANIFEST',chunkKind='F003_CHECKPOINT_CHUNK';
const sha=b=>createHash('sha256').update(b).digest('hex');
const digest=v=>sha(canonicalEncode(v));
const hex=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const object=v=>v&&typeof v==='object'&&!Array.isArray(v);
const corrupt=ok=>requireF003(ok,'F003_CHECKPOINT_CORRUPT','检查点分块、绑定、顺序、计数或完整性摘要不符');
const bytes=v=>Buffer.from(JSON.stringify(v),'utf8');

function binding(row,generation,key,adoptedVersionIds=row.payload.adoptedVersionIds) {
  return {workspaceId:row.workspace_id,investigationId:row.id,generation,key,
    requestDigest:row.request_digest,sourceInputDigest:digest(row.source_input),profileDigest:digest(row.profile),
    analysisContractVersion:row.payload.analysisContractVersion,
    implementationDigest:digest(row.payload.implementationVersion??null),adoptedVersionIds};
}
const chunkKey=(b,documentDigest,index)=>`${checkpointChunkPrefix}${digest({binding:b,documentDigest})}_${String(index).padStart(3,'0')}`;

// Internal codec, also used by corruption/recovery tests. Never accepts an
// HTTP- or model-supplied manifest as an authorized logical checkpoint.
export function checkpointDocument(row,generation,key,payload) {
  requireF003(!key.startsWith(checkpointChunkPrefix)&&object(payload)
    &&![manifestKind,chunkKind].includes(payload.storageKind),'F003_INPUT_INVALID','检查点使用了内部保留格式',{status:422});
  let raw;
  try {raw=bytes(payload);}catch {requireF003(false,'F003_INPUT_INVALID','检查点不是可保存的JSON',{status:422});}
  requireF003(raw.length<=checkpointDocumentBytes,'F003_CHECKPOINT_STORAGE_LIMIT','聚合检查点超过明确的分块保存上限',{status:422,
    details:{bytes:raw.length,maxBytes:checkpointDocumentBytes,maxChunks:checkpointMaxChunks}});
  if(raw.length<=checkpointRowBytes)return {root:payload,chunks:[]};
  const b=binding(row,generation,key),documentDigest=sha(raw),chunkCount=Math.ceil(raw.length/checkpointChunkBytes),chunks=[];
  for(let index=0;index<chunkCount;index++) {
    const part=raw.subarray(index*checkpointChunkBytes,(index+1)*checkpointChunkBytes);
    chunks.push({key:chunkKey(b,documentDigest,index),payload:{storageKind:chunkKind,storageVersion:1,binding:b,documentDigest,
      index,chunkCount,byteLength:part.length,chunkDigest:sha(part),data:part.toString('base64')}});
  }
  const root={storageKind:manifestKind,storageVersion:1,encoding:'JSON_UTF8_BASE64',binding:b,
    documentDigest,canonicalDigest:digest(JSON.parse(raw.toString('utf8'))),byteLength:raw.length,chunkCount,
    chunks:chunks.map(c=>({key:c.key,index:c.payload.index,byteLength:c.payload.byteLength,chunkDigest:c.payload.chunkDigest})),
    ...(key==='graph'?{logicalGraphDigest:payload.digest}: {})};
  corrupt([root,...chunks.map(c=>c.payload)].every(p=>bytes(p).length<=checkpointRowBytes));
  return {root,chunks};
}

// Caller owns ACL/restore/backup authorization and its Workspace transaction.
// Historical adopted sets are snapshots: never rebind an old checkpoint to a
// later adoption or the running implementation's new source watermark.
export async function readCheckpointDocument(tx,row,{generation,key,payload}) {
  if(payload?.storageKind!==manifestKind) {
    corrupt(payload?.storageKind!==chunkKind);
    return payload;
  }
  const m=payload;
  corrupt(Number.isSafeInteger(row.payload.analysisContractVersion)&&Array.isArray(row.payload.adoptedVersionIds)
    &&m.storageVersion===1&&m.encoding==='JSON_UTF8_BASE64'&&object(m.binding)
    &&Array.isArray(m.binding.adoptedVersionIds)&&m.binding.adoptedVersionIds.every(hex)
    &&new Set(m.binding.adoptedVersionIds).size===m.binding.adoptedVersionIds.length
    &&m.binding.adoptedVersionIds.every((v,i)=>row.payload.adoptedVersionIds[i]===v)
    &&Number.isSafeInteger(m.byteLength)&&m.byteLength>checkpointRowBytes&&m.byteLength<=checkpointDocumentBytes
    &&Number.isSafeInteger(m.chunkCount)&&m.chunkCount===Math.ceil(m.byteLength/checkpointChunkBytes)
    &&m.chunkCount<=checkpointMaxChunks&&Array.isArray(m.chunks)&&m.chunks.length===m.chunkCount
    &&hex(m.documentDigest)&&hex(m.canonicalDigest)&&bytes(m).length<=checkpointRowBytes);
  corrupt(canonicalEncode(m.binding)===canonicalEncode(binding(row,generation,key,m.binding.adoptedVersionIds)));
  corrupt(new Set(m.chunks.map(c=>c?.key)).size===m.chunkCount);
  for(const [index,c] of m.chunks.entries())corrupt(object(c)&&c.index===index&&hex(c.chunkDigest)
    &&c.key===chunkKey(m.binding,m.documentDigest,index)
    &&c.byteLength===Math.min(checkpointChunkBytes,m.byteLength-index*checkpointChunkBytes));
  const rows=(await tx.query(`SELECT checkpoint_key,payload FROM f003_checkpoint WHERE workspace_id=$1 AND investigation_id=$2
    AND generation=$3 AND checkpoint_key=ANY($4::text[])`,[row.workspace_id,row.id,generation,m.chunks.map(c=>c.key)])).rows;
  corrupt(rows.length===m.chunkCount);
  const byKey=new Map(rows.map(r=>[r.checkpoint_key,r.payload])),parts=[];
  for(const c of m.chunks) {
    const p=byKey.get(c.key);
    corrupt(object(p)&&p.storageKind===chunkKind&&p.storageVersion===1&&p.documentDigest===m.documentDigest
      &&p.index===c.index&&p.chunkCount===m.chunkCount&&p.byteLength===c.byteLength&&p.chunkDigest===c.chunkDigest
      &&object(p.binding)&&canonicalEncode(p.binding)===canonicalEncode(m.binding)&&typeof p.data==='string'
      &&p.data.length<=Math.ceil(checkpointChunkBytes/3)*4&&bytes(p).length<=checkpointRowBytes);
    const part=Buffer.from(p.data,'base64');
    corrupt(part.length===c.byteLength&&part.toString('base64')===p.data&&sha(part)===c.chunkDigest);parts.push(part);
  }
  const raw=Buffer.concat(parts,m.byteLength);corrupt(raw.length===m.byteLength&&sha(raw)===m.documentDigest);
  let value;
  try {value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));}catch {corrupt(false);}
  corrupt(object(value)&&digest(value)===m.canonicalDigest
    &&(key!=='graph'||hex(m.logicalGraphDigest)&&value.digest===m.logicalGraphDigest&&intactBusinessGraph(value)));
  return value;
}

export async function writeCheckpointDocument(tx,row,{generation,key,payload,allowChunks=true}) {
  const plan=checkpointDocument(row,generation,key,payload);
  requireF003(allowChunks||!plan.chunks.length,'F003_INPUT_INVALID','此运行合同仍使用原单条检查点上限',{status:422});
  const existing=(await tx.query(`SELECT payload FROM f003_checkpoint WHERE workspace_id=$1 AND investigation_id=$2
    AND generation=$3 AND checkpoint_key=$4`,[row.workspace_id,row.id,generation,key])).rows[0];
  if(existing) {
    const prior=await readCheckpointDocument(tx,row,{generation,key,payload:existing.payload});
    requireF003(digest(prior)===digest(JSON.parse(bytes(payload).toString('utf8'))),'F003_OPERATION_CONFLICT','检查点键已绑定不同结果');
    return prior;
  }
  if(plan.chunks.length) {
    const orphan=(await tx.query(`SELECT checkpoint_key FROM f003_checkpoint WHERE workspace_id=$1 AND investigation_id=$2
      AND generation=$3 AND checkpoint_key=ANY($4::text[])`,[row.workspace_id,row.id,generation,plan.chunks.map(c=>c.key)])).rows;
    corrupt(orphan.length===0);
    for(const chunk of plan.chunks)await tx.query(`INSERT INTO f003_checkpoint (workspace_id,investigation_id,generation,checkpoint_key,payload)
      VALUES ($1,$2,$3,$4,$5)`,[row.workspace_id,row.id,generation,chunk.key,JSON.stringify(chunk.payload)]);
    // Verify the actual stored chunks before the logical commit marker exists.
    await readCheckpointDocument(tx,row,{generation,key,payload:plan.root});
  }
  await tx.query(`INSERT INTO f003_checkpoint (workspace_id,investigation_id,generation,checkpoint_key,payload)
    VALUES ($1,$2,$3,$4,$5)`,[row.workspace_id,row.id,generation,key,JSON.stringify(plan.root)]);
  return payload;
}
