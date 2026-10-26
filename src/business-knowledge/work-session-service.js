import { publicationDigest as digest } from "./publication-authority.js";
import { requireF003 } from "./errors.js";
import { appendWorkRecord, readWorkRecord, workOperation, workFields, workKey, workText } from "./work-records.js";
import { investigationRecord } from "./investigation-service.js";
import { SourceDeltaService } from "../source-truth/delta-service.js";
import { technicalSnapshot } from "./technical-evidence.js";

export class F003WorkSessionService {
  constructor({ sources, publications, investigations }) {
    Object.assign(this,{sources,publications,investigations});
    investigations.questionWriteGuard=(tx,actor,workspaceId,context)=>publications.conversationAdmission(tx,actor,workspaceId,context.graphRevisionId);
  }
  async withSession(actor, workspaceId, id, write, work) {
    return this.sources.withWorkspace(actor,workspaceId,write,async(tx,access)=>{
      requireF003(access.restoreReady,"F003_RESTORE_UNVERIFIED","配套恢复尚未核验");
      requireF003(!write || !access.backupBarrier,"F003_BACKUP_BARRIER","备份围栏期间暂缓工作写入");
      return work(tx,await this.#session(tx,actor,workspaceId,id,write));
    });
  }
  async #session(tx,actor,workspaceId,id,write=false) {
      const session=await readWorkRecord(tx,workspaceId,"WORK_SESSION",id);
      requireF003(session,"F003_WORK_SESSION_NOT_FOUND","未找到本空间的工作会话",{status:404});
      const events=(await tx.query(`SELECT record_payload FROM understanding_record WHERE project_id=$1 AND record_type='WORK_SESSION_EVENT'
        AND record_payload->>'sessionId'=$2 ORDER BY (record_payload->>'version')::integer DESC LIMIT 101`,[workspaceId,id])).rows.map(r=>r.record_payload);
      const context=(await tx.query(`SELECT record_payload->'binding' AS binding FROM understanding_record WHERE project_id=$1 AND record_type='WORK_SESSION_EVENT'
        AND record_payload->>'sessionId'=$2 AND record_payload ? 'binding' ORDER BY (record_payload->>'version')::integer DESC LIMIT 1`,[workspaceId,id])).rows[0]?.binding ?? session.binding;
      const gateRevision=context.graphRevisionId ?? session.gateGraphRevisionId;
      if(write) await this.publications.conversationAdmission(tx,actor,workspaceId,gateRevision);
      else await this.publications.conversationVersion(tx,workspaceId,gateRevision);
      return {...session,binding:context,version:events[0]?.version ?? 1,events:events.slice(0,100).reverse(),eventsTruncated:events.length>100};
  }

  // Workspace sessions are already READ-shareable. This persistent index does
  // not grant access to private investigations or create/claim any work.
  async list(actor,workspaceId,{limit=50,cursor=null,graphRevisionId=null,originSessionId=null}={}) {
    requireF003(Number.isSafeInteger(limit) && limit>0 && limit<=100
      && [graphRevisionId,originSessionId].every(v=>v===null || workKey(v)),
    'F003_WORK_INPUT_INVALID','会话索引参数无效',{status:422});
    let after=null;
    if(cursor!==null) {
      try {
        requireF003(typeof cursor==='string' && cursor.length<=2048 && /^[A-Za-z0-9_-]+$/.test(cursor),'F003_WORK_INPUT_INVALID','无效分页',{status:422});
        after=JSON.parse(Buffer.from(cursor,'base64url').toString('utf8'));
        requireF003(after.workspaceId===workspaceId && after.actorId===actor.actorId && after.kind==='WORK_SESSION_INDEX'
          && after.graphRevisionId===graphRevisionId && after.originSessionId===originSessionId
          && workKey(after.id) && typeof after.createdAt==='string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(after.createdAt)
          && Number.isFinite(Date.parse(after.createdAt)),
        'F003_WORK_INPUT_INVALID','分页不属于本身份、空间或查询范围',{status:422});
      } catch {requireF003(false,'F003_WORK_INPUT_INVALID','会话索引分页无效',{status:422});}
    }
    return this.sources.withWorkspace(actor,workspaceId,false,async(tx,access)=>{
      requireF003(access.restoreReady,'F003_RESTORE_UNVERIFIED','配套恢复尚未核验');
      const rows=(await tx.query(`SELECT s.id,s.created_at,to_char(s.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_time,s.record_payload,
        COALESCE(b.record_payload->'binding',s.record_payload->'binding') AS current_binding,
        COALESCE((v.record_payload->>'version')::integer,1) AS current_version
        FROM understanding_record s
        LEFT JOIN LATERAL (SELECT record_payload FROM understanding_record e WHERE e.project_id=s.project_id
          AND e.record_type='WORK_SESSION_EVENT' AND e.record_payload->>'sessionId'=s.id AND e.record_payload ? 'binding'
          ORDER BY (e.record_payload->>'version')::integer DESC LIMIT 1) b ON true
        LEFT JOIN LATERAL (SELECT record_payload FROM understanding_record e WHERE e.project_id=s.project_id
          AND e.record_type='WORK_SESSION_EVENT' AND e.record_payload->>'sessionId'=s.id
          ORDER BY (e.record_payload->>'version')::integer DESC LIMIT 1) v ON true
        WHERE s.project_id=$1 AND s.record_type='WORK_SESSION'
        AND ($2::text IS NULL OR COALESCE(b.record_payload->'binding',s.record_payload->'binding')->>'graphRevisionId'=$2)
        AND ($3::text IS NULL OR s.record_payload->'origin'->>'sessionId'=$3)
        AND ($4::timestamptz IS NULL OR (s.created_at,s.id)>($4::timestamptz,$5::text))
        ORDER BY s.created_at,s.id LIMIT $6`,
      [workspaceId,graphRevisionId,originSessionId,after?.createdAt??null,after?.id??null,limit+1])).rows;
      const items=rows.slice(0,limit),checked=new Set();
      for(const r of items) {
        const revision=r.current_binding.graphRevisionId ?? r.record_payload.gateGraphRevisionId;
        if(!checked.has(revision)) {await this.publications.conversationVersion(tx,workspaceId,revision);checked.add(revision);}
      }
      const last=items.at(-1);
      return {sessions:items.map(r=>({id:r.id,title:r.record_payload.title,actorId:r.record_payload.actorId,
        createdAt:r.record_payload.createdAt,version:r.current_version,binding:r.current_binding,
        origin:r.record_payload.origin??null,investigationId:r.record_payload.investigationId??null,
        graphState:r.current_binding.graphRevisionId?'EXPLICITLY_ADOPTED':'AWAITING_EXPLICIT_GRAPH_ADOPTION'})),
        nextCursor:rows.length>limit?Buffer.from(JSON.stringify({kind:'WORK_SESSION_INDEX',workspaceId,actorId:actor.actorId,
          graphRevisionId,originSessionId,id:last.id,createdAt:last.cursor_time})).toString('base64url'):null};
    });
  }

  async operation(actor,workspaceId,operationId,{kind,originSessionId=null,originGraphRevisionId=null,expectedRequestDigest=null}={}) {
    const types={CREATE_SESSION:'WORK_SESSION',CONTINUATION:'WORK_SESSION',QUESTION:'KNOWLEDGE_QUESTION',
      FEEDBACK:'KNOWLEDGE_FEEDBACK',ADOPT_GRAPH:'WORK_SESSION_EVENT'};
    requireF003(workKey(operationId) && Object.hasOwn(types,kind)
      && [originSessionId,originGraphRevisionId].every(v=>v===null || workKey(v))
      && (expectedRequestDigest===null || /^[a-f0-9]{64}$/.test(expectedRequestDigest))
      && (kind!=='ADOPT_GRAPH' || originSessionId!==null),
    'F003_WORK_INPUT_INVALID','恢复须明确操作种类；采用操作还须明确原会话',{status:422});
    return this.sources.withWorkspace(actor,workspaceId,false,async(tx,access)=>{
      requireF003(access.restoreReady,'F003_RESTORE_UNVERIFIED','配套恢复尚未核验');
      const rows=(await tx.query(`SELECT record_payload FROM understanding_record WHERE project_id=$1 AND record_type=$2
        AND record_payload->>'actorId'=$3 AND record_payload->>'operationId'=$4
        AND ($5::text IS NULL OR record_payload->>'sessionId'=$5) LIMIT 2`,
      [workspaceId,types[kind],actor.actorId,operationId,kind==='ADOPT_GRAPH'?originSessionId:null])).rows;
      const record=rows[0]?.record_payload;
      requireF003(rows.length===1 && record
        && (kind!=='CREATE_SESSION' || !record.origin) && (kind!=='CONTINUATION' || record.origin)
        && (kind!=='ADOPT_GRAPH' || record.type==='GRAPH_EXPLICITLY_ADOPTED'),
      'F003_OPERATION_NOT_FOUND','未找到本人的此种持久操作',{status:404});
      requireF003(expectedRequestDigest===null || record.requestDigest===expectedRequestDigest,
        'F003_OPERATION_CONFLICT','操作键对应的原请求摘要不同');
      const sessionId=['CREATE_SESSION','CONTINUATION'].includes(kind)?record.id:record.sessionId;
      const session=await this.#session(tx,actor,workspaceId,sessionId);
      let origin={sessionId:kind==='CREATE_SESSION'?null:kind==='CONTINUATION'?record.origin.sessionId:record.sessionId,
        graphRevisionId:kind==='CONTINUATION'?record.origin.binding.graphRevisionId:record.binding?.graphRevisionId??null};
      if(kind==='ADOPT_GRAPH') {
        const previous=(await tx.query(`SELECT record_payload->'binding' AS binding FROM understanding_record
          WHERE project_id=$1 AND record_type='WORK_SESSION_EVENT' AND record_payload->>'sessionId'=$2
          AND record_payload ? 'binding' AND (record_payload->>'version')::integer<$3
          ORDER BY (record_payload->>'version')::integer DESC LIMIT 1`,[workspaceId,sessionId,record.version])).rows[0]?.binding;
        const initial=await readWorkRecord(tx,workspaceId,'WORK_SESSION',sessionId);
        origin={sessionId,graphRevisionId:(previous??initial.binding).graphRevisionId};
      }
      requireF003((originSessionId===null || originSessionId===origin.sessionId)
        && (originGraphRevisionId===null || originGraphRevisionId===origin.graphRevisionId),
      'F003_OPERATION_ORIGIN_MISMATCH','操作原始会话或图谱不符');
      const result={sessionId,...(kind==='QUESTION'?{questionId:record.id}:kind==='FEEDBACK'?{feedbackId:record.id}
        :kind==='CONTINUATION'?{investigationId:record.investigationId}:kind==='ADOPT_GRAPH'?{eventId:record.id,graphRevisionId:record.binding.graphRevisionId}:{})};
      const extra=kind==='QUESTION'?{question:await this.#question(tx,workspaceId,sessionId,record.id)}
        :kind==='FEEDBACK'?{feedback:record}:kind==='ADOPT_GRAPH'?{event:record}:{};
      if(kind==='CONTINUATION') {
        const row=(await tx.query('SELECT * FROM f003_investigation WHERE workspace_id=$1 AND id=$2',[workspaceId,record.investigationId])).rows[0];
        requireF003(row,'F003_VERSION_CORRUPT','接续缺少持久调查');extra.run=investigationRecord(row);
      }
      return {operation:{id:operationId,kind,actorId:actor.actorId,origin,result,requestDigest:record.requestDigest,createdAt:record.createdAt},session,...extra};
    });
  }
  async create(actor,workspaceId,revisionId,input) {
    workFields(input,["operationId","expectedGraphDigest","title"]);
    requireF003(workKey(input.operationId) && /^[a-f0-9]{64}$/.test(input.expectedGraphDigest??"") && workText(input.title,256),
      "F003_WORK_INPUT_INVALID","会话须明确操作键、图谱摘要和标题",{status:422});
    return this.publications.withPublishedVersion(actor,workspaceId,revisionId,true,async(tx,version)=>{
      requireF003(version.graph.digest===input.expectedGraphDigest,"F003_GRAPH_CONFLICT","图谱摘要不符");
      const admission=await this.publications.conversationAdmission(tx,actor,workspaceId,revisionId);
      const requestDigest=digest({revisionId,input}), prior=await workOperation(tx,workspaceId,"WORK_SESSION",actor.actorId,input.operationId,requestDigest);
      if(prior) return {session:prior,replayed:true};
      const session=await appendWorkRecord(tx,workspaceId,"WORK_SESSION",{actorId:actor.actorId,operationId:input.operationId,requestDigest,
        title:input.title.trim(),version:1,binding:{graphRevisionId:revisionId,graphDigest:version.graph.digest,
          sourceInput:version.publication.binding.sourceInput,adoptedVersionIds:version.graph.adoptedVersionIds},admission});
      await this.sources.audit(tx,workspaceId,null,actor.actorId,"F003_WORK_SESSION_CREATED",{sessionId:session.id,binding:session.binding});
      return {session,replayed:false};
    });
  }
  async get(actor,workspaceId,id,{limit=50,cursor=null}={}) {
    requireF003(Number.isSafeInteger(limit) && limit>0 && limit<=100,'F003_WORK_INPUT_INVALID','工作记录分页大小为1至100',{status:422});
    let after=null;
    if(cursor!==null) {
      try {
        requireF003(typeof cursor==='string' && cursor.length<=2048 && /^[A-Za-z0-9_-]+$/.test(cursor),'F003_WORK_INPUT_INVALID','工作分页定位符无效',{status:422});
        after=JSON.parse(Buffer.from(cursor,'base64url').toString('utf8'));
        requireF003(after.workspaceId===workspaceId && after.sessionId===id && workKey(after.id) && typeof after.createdAt==='string'
          && new Date(after.createdAt).toISOString()===after.createdAt,'F003_WORK_INPUT_INVALID','分页定位符不属于本空间／会话',{status:422});
      } catch {requireF003(false,'F003_WORK_INPUT_INVALID','工作分页定位符无效',{status:422});}
    }
    return this.withSession(actor,workspaceId,id,false,async(tx,session)=>{
      const records=(await tx.query(`SELECT record_type,record_payload-'graphView' AS record_payload,created_at FROM understanding_record WHERE project_id=$1
        AND record_type IN ('KNOWLEDGE_QUESTION','KNOWLEDGE_FEEDBACK') AND record_payload->>'sessionId'=$2
        AND ($3::timestamptz IS NULL OR (created_at,id)>($3::timestamptz,$4::text)) ORDER BY created_at,id LIMIT $5`,
        [workspaceId,id,after?.createdAt??null,after?.id??null,limit+1])).rows;
      const items=records.slice(0,limit),last=items.at(-1),more=records.length>limit;
      return {session,records:items.map(r=>({type:r.record_type,...r.record_payload})),recordsTruncated:more,
        nextCursor:more?Buffer.from(JSON.stringify({workspaceId,sessionId:id,id:last.record_payload.id,createdAt:new Date(last.created_at).toISOString()})).toString('base64url'):null};
    });
  }

  async events(actor,workspaceId,id,{afterVersion=0,limit=50}={}) {
    requireF003(Number.isSafeInteger(afterVersion) && afterVersion>=0 && Number.isSafeInteger(limit) && limit>0 && limit<=100,
      'F003_WORK_INPUT_INVALID','会话事件分页参数无效',{status:422});
    return this.withSession(actor,workspaceId,id,false,async(tx,session)=>{
      const rows=(await tx.query(`SELECT record_payload FROM understanding_record WHERE project_id=$1 AND record_type='WORK_SESSION_EVENT'
        AND record_payload->>'sessionId'=$2 AND (record_payload->>'version')::integer>$3 ORDER BY (record_payload->>'version')::integer LIMIT $4`,
        [workspaceId,id,afterVersion,limit+1])).rows.map(r=>r.record_payload),events=rows.slice(0,limit);
      return {sessionId:id,currentVersion:session.version,events,nextAfterVersion:rows.length>limit?events.at(-1).version:null};
    });
  }

  async ask(actor,workspaceId,sessionId,input) {
    workFields(input,["operationId","expectedSessionVersion","expectedProfileId","question","objectKeys","budget"]);
    const b=input.budget;
    workFields(b,["maxReadBytes","maxModelCalls","deadline"]);
    requireF003(workKey(input.operationId) && workText(input.question) && workText(input.expectedProfileId,256)
      && Number.isSafeInteger(input.expectedSessionVersion) && input.expectedSessionVersion>0
      && (input.objectKeys===null || (Array.isArray(input.objectKeys) && input.objectKeys.length>0 && input.objectKeys.length<=512
        && input.objectKeys.every(k=>workText(k,128)) && new Set(input.objectKeys).size===input.objectKeys.length))
      && Number.isSafeInteger(b.maxReadBytes) && b.maxReadBytes>0 && b.maxReadBytes<=512*1024
      && Number.isSafeInteger(b.maxModelCalls) && b.maxModelCalls>=3 && b.maxModelCalls<=32 && Number.isFinite(Date.parse(b.deadline)),
      "F003_WORK_INPUT_INVALID","问答须固定范围、生效团队、比较版本和有限预算",{status:422});
    const requestDigest=digest({sessionId,input});
    const prepared=await this.withSession(actor,workspaceId,sessionId,true,async(tx,session)=>{
      const prior=await workOperation(tx,workspaceId,"KNOWLEDGE_QUESTION",actor.actorId,input.operationId,requestDigest);
      if(prior) return {prior};
      requireF003(session.version===input.expectedSessionVersion,"F003_SESSION_CONFLICT","工作会话已经变化，请核对后再提交");
      requireF003(session.binding.graphRevisionId,"F003_SESSION_GRAPH_PENDING","新调查尚未明确采用已发布图谱，不能开始本版问答");
      const version=await this.publications.conversationVersion(tx,workspaceId,session.binding.graphRevisionId);
      const objects=[...version.graph.candidates,...version.graph.relations];
      const keys=input.objectKeys ?? objects.map(o=>o.key);
      requireF003(keys.length<=512 && keys.every(k=>objects.some(o=>o.key===k)),"F003_QA_SCOPE_INVALID","问答对象不属于此版本或超过有界范围",{status:422});
      const graphView=objects.filter(o=>keys.includes(o.key));
      requireF003(Buffer.byteLength(JSON.stringify(graphView))<=384*1024,"F003_QA_SCOPE_LIMIT","图谱上下文过大，请明确缩小对象范围");
      const row=(await tx.query("SELECT payload FROM f003_investigation WHERE workspace_id=$1 AND id=$2",[workspaceId,version.publication.investigationId])).rows[0];
      requireF003(row,"F003_VERSION_CORRUPT","缺少图谱的原始调查范围");
      return {binding:session.binding,scope:row.payload.scope,keys,graphView};
    });
    if(prepared.prior) return {...await this.question(actor,workspaceId,sessionId,prepared.prior.id),replayed:true};
    const questionContext={sessionId,...prepared.binding,objectKeys:prepared.keys};
    let created=false;
    const run=await this.investigations.start(actor,workspaceId,{
      operationId:`qa-${digest({sessionId,actorId:actor.actorId,operationId:input.operationId})}`,
      reference:{bundleId:prepared.binding.sourceInput.sourceBundleSnapshotId,receiptId:prepared.binding.sourceInput.receiptId},
      expectedProfileId:input.expectedProfileId,question:input.question,technicalVersionId:prepared.binding.adoptedVersionIds[0] ?? null,
      scope:prepared.scope,budget:b,supplementBudget:{maxMaterials:1,maxBytes:b.maxReadBytes,maxRuleApplications:1,maximumAttempts:1,deadline:b.deadline}
    },{questionContext,onAdmit:async(tx,admitted)=>{
      const session=await readWorkRecord(tx,workspaceId,"WORK_SESSION",sessionId);
      requireF003(session,"F003_WORK_SESSION_NOT_FOUND","工作会话不存在",{status:404});
      const current=(await tx.query(`SELECT max((record_payload->>'version')::integer) AS version FROM understanding_record
        WHERE project_id=$1 AND record_type='WORK_SESSION_EVENT' AND record_payload->>'sessionId'=$2`,[workspaceId,sessionId])).rows[0].version ?? 1;
      requireF003(current===input.expectedSessionVersion,"F003_SESSION_CONFLICT","会话在准入期间变化");
      await this.investigations.questionWriteGuard(tx,actor,workspaceId,questionContext);
      await appendWorkRecord(tx,workspaceId,"KNOWLEDGE_QUESTION",{id:admitted.id,sessionId,actorId:actor.actorId,operationId:input.operationId,requestDigest,
        question:input.question.trim(),binding:questionContext,profileId:admitted.profile.id,implementationVersion:admitted.implementationVersion,
        graphView:prepared.graphView,budget:admitted.budget});
      await appendWorkRecord(tx,workspaceId,"WORK_SESSION_EVENT",{sessionId,version:current+1,type:"QUESTION_ADMITTED",questionId:admitted.id,actorId:actor.actorId});
      await this.sources.audit(tx,workspaceId,null,actor.actorId,"F003_QUESTION_ADMITTED",{sessionId,questionId:admitted.id,graphDigest:questionContext.graphDigest});
      created=true;
    }});
    const response=await this.question(actor,workspaceId,sessionId,run.id);
    requireF003(response.request.requestDigest===requestDigest,"F003_OPERATION_CONFLICT","同键请求不一致");
    return {...response,replayed:!created};
  }

  question(actor,workspaceId,sessionId,id) {
    return this.withSession(actor,workspaceId,sessionId,false,tx=>this.#question(tx,workspaceId,sessionId,id));
  }
  async #question(tx,workspaceId,sessionId,id) {
      const request=await readWorkRecord(tx,workspaceId,"KNOWLEDGE_QUESTION",id);
      requireF003(request?.sessionId===sessionId,"F003_QUESTION_NOT_FOUND","未找到本会话的问题",{status:404});
      const row=(await tx.query("SELECT * FROM f003_investigation WHERE workspace_id=$1 AND id=$2",[workspaceId,id])).rows[0];
      requireF003(row?.payload.purpose==='GRAPH_QUESTION',"F003_QUESTION_NOT_FOUND","问题的持久运行不存在",{status:404});
      const run=investigationRecord(row),answer=run.latestAnswerId ? await readWorkRecord(tx,workspaceId,"KNOWLEDGE_ANSWER",run.latestAnswerId) : null;
      return {request,run,answer};
  }

  executionContext(actor,workspaceId,sessionId,id) {
    return this.withSession(actor,workspaceId,sessionId,false,async tx=>{
      const request=await readWorkRecord(tx,workspaceId,"KNOWLEDGE_QUESTION",id);
      requireF003(request?.sessionId===sessionId,"F003_QUESTION_NOT_FOUND","未找到本会话的问题",{status:404});
      const {graph}=await this.publications.conversationVersion(tx,workspaceId,request.binding.graphRevisionId);
      requireF003(graph.digest===request.binding.graphDigest,"F003_GRAPH_CONFLICT","问题图谱摘要不符");
      const endpointKeys=new Set(request.graphView.flatMap(o=>[o.sourceKey,o.targetKey]).filter(Boolean));
      return {request,materials:graph.materials,coverage:graph.coverage,
        endpoints:[...graph.candidates,...graph.materials.map(m=>({...m,key:m.id}))].filter(o=>endpointKeys.has(o.key))};
    });
  }

  async feedback(actor,workspaceId,sessionId,input) {
    workFields(input,["operationId","expectedSessionVersion","graphDigest","objectKey","answerId","kind","message"]);
    requireF003(workKey(input.operationId) && Number.isSafeInteger(input.expectedSessionVersion) && input.expectedSessionVersion>0
      && /^[a-f0-9]{64}$/.test(input.graphDigest??"") && (input.objectKey===null || workText(input.objectKey,128))
      && (input.answerId===null || workKey(input.answerId)) && (input.objectKey!==null || input.answerId!==null)
      && ['CORRECTION','REVIEW_REQUEST'].includes(input.kind) && workText(input.message),
      "F003_WORK_INPUT_INVALID","反馈须指向本版对象或答案；不能自报批准或执行结果",{status:422});
    const requestDigest=digest({sessionId,input});
    return this.withSession(actor,workspaceId,sessionId,true,async(tx,session)=>{
      const prior=await workOperation(tx,workspaceId,'KNOWLEDGE_FEEDBACK',actor.actorId,input.operationId,requestDigest);
      if(prior) return {feedback:prior,replayed:true};
      requireF003(session.version===input.expectedSessionVersion,"F003_SESSION_CONFLICT","会话已变化");
      requireF003(session.binding.graphRevisionId && session.binding.graphDigest===input.graphDigest,"F003_GRAPH_CONFLICT","反馈不属于当前明确图谱");
      const {graph}=await this.publications.conversationVersion(tx,workspaceId,session.binding.graphRevisionId);
      requireF003(input.objectKey===null || [...graph.candidates,...graph.relations].some(o=>o.key===input.objectKey),"F003_QA_SCOPE_INVALID","反馈对象不属于本版图谱",{status:422});
      if(input.answerId!==null) {
        const answer=await readWorkRecord(tx,workspaceId,'KNOWLEDGE_ANSWER',input.answerId);
        requireF003(answer?.binding.sessionId===sessionId && answer.binding.graphDigest===input.graphDigest
          && answer.binding.graphRevisionId===session.binding.graphRevisionId,"F003_QA_SCOPE_INVALID","反馈答案不属于本会话的本版图谱",{status:422});
      }
      const feedback=await appendWorkRecord(tx,workspaceId,'KNOWLEDGE_FEEDBACK',{actorId:actor.actorId,operationId:input.operationId,
        requestDigest,sessionId,binding:session.binding,objectKey:input.objectKey,answerId:input.answerId,kind:input.kind,
        message:input.message.trim(),status:'REVIEW_REQUESTED',authority:'NONE_USE_EXISTING_DECISION_WORKFLOW'});
      await appendWorkRecord(tx,workspaceId,'WORK_SESSION_EVENT',{sessionId,version:session.version+1,type:'FEEDBACK_REGISTERED',feedbackId:feedback.id,actorId:actor.actorId});
      await this.sources.audit(tx,workspaceId,null,actor.actorId,'F003_FEEDBACK_REGISTERED',{sessionId,feedbackId:feedback.id,graphDigest:input.graphDigest});
      return {feedback,replayed:false};
    });
  }

  async continuationPreview(actor,workspaceId,sessionId,input) {
    workFields(input,['reference','scope','technicalVersionId']);
    workFields(input.reference,['bundleId','receiptId']); workFields(input.scope,['componentIds']);
    requireF003(/^[a-f0-9]{64}$/.test(input.reference.bundleId??'') && workKey(input.reference.receiptId)
      && Array.isArray(input.scope.componentIds) && input.scope.componentIds.length>0 && input.scope.componentIds.length<=128
      && input.scope.componentIds.every(c=>/^[a-f0-9]{64}$/.test(c)) && new Set(input.scope.componentIds).size===input.scope.componentIds.length
      && (input.technicalVersionId===null || /^[a-f0-9]{64}$/.test(input.technicalVersionId??'')),
      'F003_WORK_INPUT_INVALID','接续须明确新冻结来源、Receipt、范围和采用或不采用技术版本',{status:422});
    const prepared=await this.withSession(actor,workspaceId,sessionId,false,async(tx,session)=>{
      requireF003(session.binding.graphRevisionId,'F003_SESSION_GRAPH_PENDING','请先完成并明确采用当前接续调查的图谱');
      const old=await this.publications.conversationVersion(tx,workspaceId,session.binding.graphRevisionId);
      const row=(await tx.query('SELECT payload FROM f003_investigation WHERE workspace_id=$1 AND id=$2',[workspaceId,old.publication.investigationId])).rows[0];
      requireF003(row,'F003_VERSION_CORRUPT','缺少原图谱范围');
      const next=await this.investigations.sourceAdmission.records(actor,workspaceId,input.reference,tx);
      requireF003(input.scope.componentIds.every(c=>next.bundle.payload.components.some(b=>b.id===c)),
        'F003_SCOPE_MISMATCH','新范围不属于明确冻结版本',{status:422});
      if(input.technicalVersionId!==null) await technicalSnapshot(tx,workspaceId,input.technicalVersionId,input.reference.bundleId,input.scope.componentIds);
      const previous=await this.investigations.sourceAdmission.assertBinding(workspaceId,{bundleId:session.binding.sourceInput.sourceBundleSnapshotId,
        receiptId:session.binding.sourceInput.receiptId},tx);
      return {from:session.binding,before:previous.bundle.identity.components.filter(c=>row.payload.scope.componentIds.includes(c.id)),
        after:next.bundle.payload.components.filter(c=>input.scope.componentIds.includes(c.id))};
    });
    const deltas=[],changedEntries=[],delta=new SourceDeltaService(this.sources);
    for(const sourceId of [...new Set([...prepared.before,...prepared.after].map(c=>c.sourceId))].sort()) {
      const before=prepared.before.find(c=>c.sourceId===sourceId), after=prepared.after.find(c=>c.sourceId===sourceId);
      if(!before || !after) {
        deltas.push({sourceId,comparable:false,reason:before?'OUTSIDE_NEW_SCOPE_OR_REMOVED_SOURCE':'NEWLY_SELECTED_OR_ADDED_SOURCE',
          beforeComponentId:before?.id??null,afterComponentId:after?.id??null,counts:null}); continue;
      }
      let cursor=null, result;
      do {
        result=await delta.compare(actor,workspaceId,{fromBundleId:prepared.from.sourceInput.sourceBundleSnapshotId,toBundleId:input.reference.bundleId,sourceId,limit:1000,cursor});
        changedEntries.push(...result.items.map(entry=>({sourceId,...entry})));
        cursor=result.nextCursor;
        requireF003(changedEntries.length<=10000 && Buffer.byteLength(JSON.stringify(changedEntries))<=1024*1024,
          'F003_CHANGESET_LIMIT','变更清单超过有界展示范围，请明确更小来源范围；不截断后静默接续');
      } while(cursor);
      deltas.push({sourceId,comparable:result.comparable,counts:result.counts,reason:result.reason??null,
        beforeComponentId:before.id,afterComponentId:after.id,fromScope:result.fromScope??null,toScope:result.toScope??null});
    }
    const summary={from:prepared.from,to:{reference:input.reference,scope:{componentIds:[...input.scope.componentIds].sort()},
      adoptedVersionIds:input.technicalVersionId===null?[]:[input.technicalVersionId]},deltas,changedEntries,
      adoptionChange:{kind:input.technicalVersionId===null?'EXPLICIT_NONE':'EXPLICIT_VERSION',from:prepared.from.adoptedVersionIds,to:input.technicalVersionId},
      limitations:['A source/scope change is not proof that previously out-of-scope files were deleted.','Material changes do not establish changed business meaning or inherit old human recognition.']};
    return {...summary,changeSetDigest:digest(summary)};
  }

  async continue(actor,workspaceId,sessionId,input) {
    workFields(input,['reference','scope','technicalVersionId','operationId','expectedSessionVersion','expectedChangeSetDigest',
      'question','expectedProfileId','budget','supplementBudget']);
    requireF003(workKey(input.operationId) && Number.isSafeInteger(input.expectedSessionVersion) && input.expectedSessionVersion>0
      && /^[a-f0-9]{64}$/.test(input.expectedChangeSetDigest??''),'F003_WORK_INPUT_INVALID','接续需要明确操作、会话比较版本和已查看的变更摘要',{status:422});
    const requestDigest=digest({sessionId,input}), prepared=await this.withSession(actor,workspaceId,sessionId,true,async(tx,session)=>{
      const prior=await workOperation(tx,workspaceId,'WORK_SESSION',actor.actorId,input.operationId,requestDigest);
      if(prior) return {prior};
      requireF003(session.version===input.expectedSessionVersion,'F003_SESSION_CONFLICT','接续期间会话已变化'); return {session};
    });
    if(prepared.prior) return {session:prepared.prior,run:await this.investigations.get(actor,workspaceId,prepared.prior.investigationId),replayed:true};
    const changes=await this.continuationPreview(actor,workspaceId,sessionId,{reference:input.reference,scope:input.scope,technicalVersionId:input.technicalVersionId});
    requireF003(changes.changeSetDigest===input.expectedChangeSetDigest,'F003_CHANGESET_CONFLICT','变更摘要不符，请重新核对');
    const origin=await this.withSession(actor,workspaceId,sessionId,false,async tx=>
      this.publications.conversationVersion(tx,workspaceId,prepared.session.binding.graphRevisionId));
    let saved;
    const run=await this.investigations.start(actor,workspaceId,{operationId:`continue-${digest({sessionId,actorId:actor.actorId,op:input.operationId})}`,
      reference:input.reference,scope:input.scope,technicalVersionId:input.technicalVersionId,expectedProfileId:input.expectedProfileId,
      question:input.question,budget:input.budget,supplementBudget:input.supplementBudget},{
      continuationSource:{kind:'PUBLISHED_WORK_SESSION',investigationId:origin.publication.investigationId,
        graphDigest:prepared.session.binding.graphDigest,graphRevisionId:prepared.session.binding.graphRevisionId,
        sessionId,sessionVersion:input.expectedSessionVersion,changeSetDigest:changes.changeSetDigest},
      onAdmit:async(tx,admitted)=>{
      const original=await readWorkRecord(tx,workspaceId,'WORK_SESSION',sessionId);
      requireF003(original,'F003_WORK_SESSION_NOT_FOUND','原会话不存在',{status:404});
      const current=(await tx.query(`SELECT max((record_payload->>'version')::integer) version FROM understanding_record
        WHERE project_id=$1 AND record_type='WORK_SESSION_EVENT' AND record_payload->>'sessionId'=$2`,[workspaceId,sessionId])).rows[0].version??1;
      requireF003(current===input.expectedSessionVersion,'F003_SESSION_CONFLICT','接续准入期间会话已变化');
      await this.publications.conversationAdmission(tx,actor,workspaceId,prepared.session.binding.graphRevisionId);
      saved=await appendWorkRecord(tx,workspaceId,'WORK_SESSION',{actorId:actor.actorId,operationId:input.operationId,requestDigest,
        title:input.question,version:1,investigationId:admitted.id,gateGraphRevisionId:prepared.session.binding.graphRevisionId,
        binding:{graphRevisionId:null,graphDigest:null,sourceInput:admitted.sourceInput,adoptedVersionIds:admitted.adoptedVersionIds},
        origin:{sessionId,binding:prepared.session.binding,changeSetDigest:changes.changeSetDigest},changes});
      await appendWorkRecord(tx,workspaceId,'WORK_SESSION_EVENT',{sessionId,version:current+1,type:'CONTINUATION_CREATED',
        newSessionId:saved.id,investigationId:admitted.id,actorId:actor.actorId});
      await this.sources.audit(tx,workspaceId,null,actor.actorId,'F003_WORK_CONTINUED',{sessionId,newSessionId:saved.id,
        investigationId:admitted.id,changeSetDigest:changes.changeSetDigest});
    }});
    const created=!!saved;
    if(!saved) saved=await this.withSession(actor,workspaceId,sessionId,false,tx=>workOperation(tx,workspaceId,'WORK_SESSION',actor.actorId,input.operationId,requestDigest));
    requireF003(saved,'F003_WORK_RECORD_CONFLICT','接续缺少持久会话记录');
    return {session:saved,run,replayed:!created};
  }

  async adoptGraph(actor,workspaceId,sessionId,input) {
    workFields(input,['operationId','expectedSessionVersion','graphRevisionId','expectedGraphDigest','adoptedVersionIds']);
    requireF003(workKey(input.operationId) && Number.isSafeInteger(input.expectedSessionVersion) && input.expectedSessionVersion>0
      && workText(input.graphRevisionId,128) && /^[a-f0-9]{64}$/.test(input.expectedGraphDigest??'')
      && Array.isArray(input.adoptedVersionIds) && input.adoptedVersionIds.length<=128
      && input.adoptedVersionIds.every(v=>/^[a-f0-9]{64}$/.test(v)),'F003_WORK_INPUT_INVALID','采用须固定图谱、明确技术版本和比较版本',{status:422});
    const requestDigest=digest({sessionId,input});
    return this.withSession(actor,workspaceId,sessionId,true,async(tx,session)=>{
      const prior=(await tx.query(`SELECT record_payload FROM understanding_record WHERE project_id=$1 AND record_type='WORK_SESSION_EVENT'
        AND record_payload->>'sessionId'=$2 AND record_payload->>'actorId'=$3 AND record_payload->>'operationId'=$4`,
        [workspaceId,sessionId,actor.actorId,input.operationId])).rows[0]?.record_payload;
      if(prior) {requireF003(prior.requestDigest===requestDigest,'F003_OPERATION_CONFLICT','采用操作键冲突');return {event:prior,replayed:true};}
      requireF003(session.version===input.expectedSessionVersion,'F003_SESSION_CONFLICT','会话已变化');
      const version=await this.publications.conversationVersion(tx,workspaceId,input.graphRevisionId);
      requireF003(session.investigationId && version.publication.investigationId===session.investigationId
        && version.graph.sourceBundleId===session.binding.sourceInput.sourceBundleSnapshotId
        && version.publication.binding.sourceInput.receiptId===session.binding.sourceInput.receiptId
        && version.graph.digest===input.expectedGraphDigest && digest(version.graph.adoptedVersionIds)===digest(input.adoptedVersionIds),
        'F003_CONTINUATION_GRAPH_MISMATCH','图谱并非此新调查／来源／明确采用版本的发布结果');
      await this.publications.conversationAdmission(tx,actor,workspaceId,input.graphRevisionId);
      const event=await appendWorkRecord(tx,workspaceId,'WORK_SESSION_EVENT',{sessionId,version:session.version+1,type:'GRAPH_EXPLICITLY_ADOPTED',
        actorId:actor.actorId,operationId:input.operationId,requestDigest,binding:{graphRevisionId:input.graphRevisionId,graphDigest:version.graph.digest,
          sourceInput:version.publication.binding.sourceInput,adoptedVersionIds:version.graph.adoptedVersionIds}});
      await this.sources.audit(tx,workspaceId,null,actor.actorId,'F003_SESSION_GRAPH_ADOPTED',{sessionId,graphRevisionId:input.graphRevisionId,graphDigest:version.graph.digest});
      return {event,replayed:false};
    });
  }

  async control(actor,workspaceId,sessionId,id,action,input) {
    workFields(input,['expectedRevision']);
    requireF003(['CANCEL','PAUSE','RESUME'].includes(action) && Number.isSafeInteger(input.expectedRevision) && input.expectedRevision>0,
      'F003_WORK_INPUT_INVALID','问题控制需要当前比较版本',{status:422});
    await this.question(actor,workspaceId,sessionId,id);
    return {run:await this.investigations.control(actor,workspaceId,id,{action,expectedRevision:input.expectedRevision})};
  }
}
