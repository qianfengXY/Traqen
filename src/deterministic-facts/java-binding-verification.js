import { requireF002 } from "./errors.js";
import { canonicalDigest } from "./identity.js";
import { javaDeclarationIndex, javaBindingRequiredProperties, implicitObjectMethodNames } from "./extraction/java-bindings.js";

const identifier=/^[$_\p{ID_Start}][$_\p{ID_Continue}]*$/u;
const compare=(a,b)=>Buffer.compare(Buffer.from(a),Buffer.from(b));
const requireBinding=condition=>requireF002(condition,"F002_RECORD_JAVA_BINDING_INVALID","Java 跨声明绑定的精确前提或唯一条件不成立",{status:422});

export function verifyJavaBindings({objects,facts,materials,evidence,gaps,profile}){
  const index=javaDeclarationIndex([...objects.values()],[...facts.values()],[...materials.values()]);
  const {one,children,qualified,imports}=index;
  const relations=[...facts.values()].filter(f=>f.predicate==="staticCalls"&&f.ruleRef.id==="f002-java"&&f.premiseFactIds.length!==5);
  const maxCalls=profile.extractionLimits.maxJavaBindingCalls??20_000, maxDecl=profile.extractionLimits.maxJavaBindingDeclarations??20_000;
  const localCalls=new Set([...facts.values()].filter(f=>f.predicate==="staticCalls"&&f.ruleRef.id==="f002-java"&&f.premiseFactIds.length===5)
    .flatMap(f=>f.premiseFactIds).map(id=>facts.get(id)).filter(f=>f?.predicate==="name"&&objects.get(f.subjectId)?.kind==="JAVA_CALL").map(f=>f.subjectId));
  if(relations.length)requireBinding([...objects.values()].filter(o=>o.kind==="JAVA_CALL"&&!localCalls.has(o.objectId)).length<=maxCalls
    &&[...objects.values()].filter(o=>["JAVA_TYPE","JAVA_METHOD","IMPORT"].includes(o.kind)).length<=maxDecl);
  for(const f of relations){
    const source=objects.get(f.subjectId),target=objects.get(f.targetId),sourceOwner=objects.get(source?.parentId),owner=objects.get(target?.parentId);
    requireBinding(f.basis==="DERIVED"&&f.ruleRef.version==="2"&&source?.kind==="JAVA_METHOD"&&target?.kind==="JAVA_METHOD"
      &&sourceOwner?.kind==="JAVA_TYPE"&&owner?.kind==="JAVA_TYPE"&&objects.get(sourceOwner.parentId)?.kind==="MATERIAL"&&objects.get(owner.parentId)?.kind==="MATERIAL");
    const material=materials.get(source.materialId),targetMaterial=materials.get(target.materialId);
    requireBinding(material?.componentId===targetMaterial?.componentId);
    const nameFacts=f.premiseFactIds.map(id=>facts.get(id)).filter(p=>p.predicate==="name"&&objects.get(p.subjectId)?.kind==="JAVA_CALL"&&objects.get(p.subjectId).parentId===source.objectId);
    requireBinding(nameFacts.length===1);const call=objects.get(nameFacts[0].subjectId),name=nameFacts[0].value.value,receiver=one(call,"receiverName")?.value.value;
    requireBinding(call.materialId===source.materialId&&identifier.test(name)&&typeof receiver==="string"&&(!receiver||receiver.split(".").every(p=>identifier.test(p))));
    if(receiver)requireBinding(![...objects.values()].some(o=>o.kind==="JAVA_TYPE"&&o.materialId===source.materialId&&o.name===receiver.split(".")[0]));
    const required=javaBindingRequiredProperties(call,sourceOwner,target,owner,name).map(([id,p,v])=>{
      const fact=one(id,p);requireBinding(fact&&(v===undefined||fact.value.value===v));return fact;
    });
    let targetName,binding=[];const unit=imports.get(source.materialId)??[];
    if(receiver.includes("."))targetName=receiver;
    else{
      requireBinding(!unit.some(o=>one(o,"importKind").value.value.endsWith("_WILDCARD")));
      const relevant=unit.filter(o=>one(o,"importKind").value.value===(receiver?"TYPE":"STATIC")&&one(o,"path")?.value.value.split(".").at(-1)===(receiver||name));
      requireBinding(relevant.length<=1);
      if(receiver)requireBinding(!(children.get(material.rootObjectId)??[]).some(o=>o.kind==="JAVA_TYPE"&&o.name===receiver));
      else requireBinding(!implicitObjectMethodNames.has(name)&&!(children.get(sourceOwner.objectId)??[]).some(o=>o.kind==="JAVA_METHOD"&&one(o,"name")?.value.value===name));
      if(relevant.length){const imp=relevant[0];targetName=one(imp,"path").value.value;if(!receiver)targetName=targetName.split(".").slice(0,-1).join(".");binding=[one(imp,"path"),one(imp,"importKind")];}
      else{requireBinding(!!receiver);const p=one(material.rootObjectId,"packageName");requireBinding(!!p);targetName=`${p.value.value}${p.value.value?".":""}${receiver}`;binding=[p];}
    }
    const types=qualified.get(`${material.componentId}:${targetName}`)??[];
    requireBinding(types.length===1&&types[0].objectId===owner.objectId);
    const choices=(children.get(owner.objectId)??[]).filter(o=>o.kind==="JAVA_METHOD"&&one(o,"name")?.value.value===name);
    requireBinding(choices.length===1&&choices[0].objectId===target.objectId&&!(children.get(target.objectId)??[]).some(o=>o.kind==="JAVA_PARAMETER"));
    const expected=[...required,...binding].map(p=>p.factId).sort(compare);
    requireBinding(f.premiseFactIds.length===expected.length&&[...f.premiseFactIds].sort(compare).every((id,i)=>id===expected[i]));
    requireBinding(f.evidenceIds.some(id=>evidence.get(id)?.materialId===call.materialId&&canonicalDigest("ANCHOR",evidence.get(id).anchor)===canonicalDigest("ANCHOR",call.anchor)));
  }
  for(const g of gaps.values())if(g.code.startsWith("JAVA_BINDING_")&&Array.isArray(g.reason?.candidateObjectIds)){
    const ids=g.reason.candidateObjectIds;
    requireBinding(ids.length<=(profile.extractionLimits.maxJavaBindingCandidateRefs??64)&&new Set(ids).size===ids.length&&typeof g.reason.candidatesTruncated==="boolean");
    requireBinding(ids.every((id,i)=>{
      const o=objects.get(id);return o&&["JAVA_TYPE","JAVA_METHOD"].includes(o.kind)&&materials.get(o.materialId)?.componentId===materials.get(g.materialId)?.componentId&&(i===0||compare(ids[i-1],id)<0);
    }));
  }
}
