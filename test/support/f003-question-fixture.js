import { authorityFixture } from './f003-authority-fixture.js';
export const questionActor={actorId:'owner',tenantId:'tenant'};
export const questionInput=(f,overrides={})=>({operationId:'question-1',expectedSessionVersion:1,expectedProfileId:f.request.expectedProfileId,
  question:'基于明确图谱说明取消条件及未知',objectKeys:[f.graph.candidates[0].key],
  budget:{maxReadBytes:8192,maxModelCalls:5,deadline:'2099-01-01T00:00:00Z'},...overrides});

// Model port, quality/recovery fixtures and responses are explicitly synthetic.
export async function questionFixture(t,{database,transform=(_c,result)=>result,onCall=async()=>{}}={}) {
  const calls=[];
  const f=await authorityFixture(t,{database,modelExecutor:service=>async c=>{
    const reservation=await service.reserveModelCall(c.actor,c.workspaceId,c.investigationId,{...c,phase:c.input.phase});
    await service.beginModelCall(c.actor,c.workspaceId,c.investigationId,{generation:c.generation,reservationId:reservation.id});
    calls.push(c); await onCall(c,service);
    const i=c.input;
    const result=i.phase==='PLAN'?{assignments:[{slotId:i.childSlots[0].id,objectKeys:i.objects.map(o=>o.key)}]}
      :i.operation==='DRAFT'?{segments:[{key:'cancel-answer',text:'原文说明用户可取消未支付订单；不代表执行通过。',stance:'SUPPORTED',
        graphRefs:[i.objects[0].key],evidence:i.objects[0].evidence,technicalRefs:[],uncertainties:[]}],unknowns:['尚无实际执行证明']}
        :{reviews:i.drafts.flatMap(d=>d.segments).map(s=>({key:s.key,support:'SUPPORTED',rationale:'explicit isolated mechanism reviewer',unresolvedConflicts:[]}))};
    const changed=await transform(c,result);
    await service.finishModelCall(c.actor,c.workspaceId,c.investigationId,{generation:c.generation,reservationId:reservation.id,outcome:'SUCCEEDED'});
    return {result:changed,reservationId:reservation.id};
  }});
  const s=f.runtime.services;s.investigations.profiles=f.profiles;
  const {session}=await s.workSessions.create(questionActor,'workspace',f.published.publication.graphRevisionId,
    {operationId:'test-session',expectedGraphDigest:f.graph.digest,title:'mechanism-only question fixture'});
  return {...f,s,session,calls,ask:input=>s.workSessions.ask(questionActor,'workspace',session.id,questionInput(f,input)),
    read:id=>s.workSessions.question(questionActor,'workspace',session.id,id)};
}
