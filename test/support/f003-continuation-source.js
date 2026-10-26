import {createHash} from 'node:crypto';
import {pathBytes} from '../../src/source-truth/identity.js';
import {SourcePublicationService} from '../../src/source-truth/publication-service.js';
import {questionActor as owner} from './f003-question-fixture.js';

// A new genuinely frozen source in the same isolated F001 store, not mutation
// of an existing Bundle or an unqualified HTTP source description.
export async function freezeContinuationSource(f,files) {
  const source={sourceId:'registration',kind:'DIRECTORY_UPLOAD',scope:{kind:'UPLOADED_DIRECTORY'}};
  const draft=await f.repository.saveDraft(owner,'workspace',{expectedRevision:1,input:{sources:[source]}});
  const run=await f.repository.startRun(owner,'workspace',{draftRevision:draft.revision,policyRevisionId:'policy-v1'});
  const lease=await f.repository.claimRun('workspace',run.id,{workerId:'new-source-fixture',leaseMs:60000});
  const context={workspaceId:'workspace',runId:run.id,generation:lease.generation,sourceId:source.sourceId};
  const advance=(from,to)=>f.repository.transition('workspace',run.id,{generation:lease.generation,expectedStatus:from,status:to});
  await advance('PREFLIGHTING','ENUMERATING');await f.materials.addSource(context,source);
  const directories=[...new Set(files.flatMap(([p])=>p.split('/').slice(0,-1).map((_,n)=>p.split('/').slice(0,n+1).join('/'))))];
  if(directories.length)await f.materials.appendEntries(context,directories.map(p=>({pathBytes:pathBytes(p),kind:'DIRECTORY',sizeBytes:null,expectedContent:null,gitMode:null})));
  for(const [name,text] of files) {
    const bytes=Buffer.from(text),digest=createHash('sha256').update(bytes).digest('hex');
    await f.materials.appendEntries(context,[{pathBytes:pathBytes(name),kind:'FILE',sizeBytes:String(bytes.length),expectedContent:{algorithm:'sha256',digest},gitMode:null}]);
    await f.blobs.putBlob({workspaceId:'workspace',tenantId:'tenant'},{digest,sizeBytes:String(bytes.length)},[bytes]);
  }
  await f.materials.closeEnumeration(context,{fileCount:String(files.length),directoryCount:String(directories.length)});await f.materials.freezeManifest(context);
  await advance('ENUMERATING','MANIFEST_FROZEN');await advance('MANIFEST_FROZEN','CAPTURING');
  for(const p of directories)await f.materials.dispose(context,{pathBytes:pathBytes(p),disposition:'METADATA',reasonCode:'DIRECTORY_RECORDED'});
  for(const [name,text] of files) await f.materials.dispose(context,{pathBytes:pathBytes(name),disposition:'VERIFIED',reasonCode:'CONTENT_VERIFIED',
    digest:createHash('sha256').update(text).digest('hex'),sizeBytes:String(Buffer.byteLength(text)),gaps:[]});
  await advance('CAPTURING','RECONCILING');const candidate=await f.candidates.prepare(context);await advance('RECONCILING','REVIEW_REQUIRED');
  const pub=new SourcePublicationService(f.repository,f.candidates),confirmed=await pub.confirm(owner,context,{candidateId:candidate.id,gapSetId:candidate.gapSetId});
  const result=await pub.seal(owner,context,{confirmationId:confirmed.id,clientToken:run.id});
  return {reference:{bundleId:result.bundle.id,receiptId:result.receipt.id},scope:{componentIds:result.bundle.components.map(c=>c.id)}};
}
