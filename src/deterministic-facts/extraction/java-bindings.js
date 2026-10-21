// Fixed source-declaration table only: no filesystem/classpath/JVM access.
const compare=(a,b)=>Buffer.compare(Buffer.from(a),Buffer.from(b));
const identifier=/^[$_\p{ID_Start}][$_\p{ID_Continue}]*$/u;
export const implicitObjectMethodNames=new Set(["clone","equals","finalize","getClass","hashCode","notify","notifyAll","toString","wait"]);
export const javaBindingRequiredProperties=(call,sourceOwner,target,targetOwner,name)=>[
  [call.objectId,"name",name],[call.objectId,"argumentCount",0],[call.objectId,"receiverName"], [call.objectId,"lexicalShadow",false],
  [sourceOwner.objectId,"qualifiedName"],[sourceOwner.objectId,"hasInheritance",false],[sourceOwner.objectId,"hasTypeParameters",false],[sourceOwner.objectId,"type","class"],
  [target.objectId,"name",name],[target.objectId,"staticModifier",true],[target.objectId,"signature",`${name}()`],[target.objectId,"visibility","PUBLIC"],[target.objectId,"hasTypeParameters",false],
  [targetOwner.objectId,"qualifiedName"],[targetOwner.objectId,"hasInheritance",false],[targetOwner.objectId,"visibility","PUBLIC"],[targetOwner.objectId,"hasTypeParameters",false],[targetOwner.objectId,"type","class"],
];

// Shared indexing is mechanical; publication independently checks the binding
// choice, unique declarations, actual premise identities and evidence anchor.
export function javaDeclarationIndex(objects,facts,materials){
  const byId=new Map(objects.map(o=>[o.objectId,o])), byMaterial=new Map(materials.map(m=>[m.materialId,m]));
  const properties=new Map(), children=new Map(), qualified=new Map(), imports=new Map();
  for(const f of facts)if(f.kind==="PROPERTY"&&f.basis==="DECLARED"&&f.ruleRef.id==="f002-java"&&f.ruleRef.version==="2"){
    const key=`${f.subjectId}:${f.predicate}`;if(!properties.has(key))properties.set(key,[]);properties.get(key).push(f);
  }
  const one=(o,p)=>{const rows=properties.get(`${typeof o==="string"?o:o?.objectId}:${p}`)??[];return rows.length===1?rows[0]:null;};
  for(const o of objects){
    if(!children.has(o.parentId))children.set(o.parentId,[]);children.get(o.parentId).push(o);
    if(o.kind==="JAVA_TYPE"){
      const q=one(o,"qualifiedName"),m=byMaterial.get(o.materialId);if(!q||!m)continue;
      const key=`${m.componentId}:${q.value.value}`;if(!qualified.has(key))qualified.set(key,[]);qualified.get(key).push(o);
    }
    if(o.kind==="IMPORT"&&one(o,"importKind")){
      if(!imports.has(o.materialId))imports.set(o.materialId,[]);imports.get(o.materialId).push(o);
    }
  }
  return{byId,byMaterial,one,children,qualified,imports};
}

export function resolveJavaBindings({objects,facts,materialById,limits,addFact,addGap}){
  if(limits?.javaBindings!=="component-static-zero-v1")return;
  const index=javaDeclarationIndex(objects,facts,[...materialById.values()]);
  const {one,byId,children,qualified,imports}=index;
  const factById=new Map(facts.map(f=>[f.factId,f]));
  const localOccurrences=new Set(facts.filter(f=>f.predicate==="staticCalls"&&f.ruleRef.id==="f002-java").flatMap(f=>f.premiseFactIds)
    .map(id=>factById.get(id)).filter(f=>f?.predicate==="name"&&byId.get(f.subjectId)?.kind==="JAVA_CALL").map(f=>f.subjectId));
  const calls=objects.filter(o=>o.kind==="JAVA_CALL"&&!localOccurrences.has(o.objectId));
  const declarations=objects.filter(o=>["JAVA_TYPE","JAVA_METHOD","IMPORT"].includes(o.kind));
  if(calls.length>(limits.maxJavaBindingCalls??20_000)||declarations.length>(limits.maxJavaBindingDeclarations??20_000)){
    for(const m of new Set(calls.map(o=>materialById.get(o.materialId))))addGap(m,"java","JAVA_BINDING_LIMIT");return;
  }
  const failure=(call,code,candidates=[])=>{
    const ids=[...new Set(candidates.map(o=>o.objectId))].sort(compare),max=limits.maxJavaBindingCandidateRefs??64;
    addGap(materialById.get(call.materialId),"java",code,call.anchor,{candidateObjectIds:ids.slice(0,max),candidatesTruncated:ids.length>max});
  };
  for(const call of calls){
    const source=byId.get(call.parentId),sourceOwner=byId.get(source?.parentId),material=materialById.get(call.materialId);
    const name=one(call,"name")?.value.value,receiver=one(call,"receiverName")?.value.value;
    if(source?.kind!=="JAVA_METHOD"||sourceOwner?.kind!=="JAVA_TYPE"||byId.get(sourceOwner.parentId)?.kind!=="MATERIAL"
      ||one(call,"argumentCount")?.value.value!==0||one(call,"lexicalShadow")?.value.value!==false||typeof receiver!=="string"
      ||!identifier.test(name??"")|| (receiver&&!receiver.split(".").every(p=>identifier.test(p)))){failure(call,"JAVA_BINDING_UNSUPPORTED");continue;}
    const ownMethods=(children.get(sourceOwner.objectId)??[]).filter(o=>o.kind==="JAVA_METHOD"&&one(o,"name")?.value.value===name);
    const unitImports=imports.get(material.materialId)??[];let targetName,binding=[];
    if(receiver.includes("."))targetName=receiver;
    else{
      if(unitImports.some(o=>one(o,"importKind")?.value.value.endsWith("_WILDCARD"))){failure(call,"JAVA_BINDING_UNSUPPORTED");continue;}
      const applicable=unitImports.filter(o=>one(o,"importKind")?.value.value===(receiver?"TYPE":"STATIC")&&one(o,"path")?.value.value.split(".").at(-1)===(receiver||name));
      if(applicable.length>1){
        const candidates=applicable.flatMap(o=>{const path=one(o,"path").value.value;const q=receiver?path:path.split(".").slice(0,-1).join(".");return qualified.get(`${material.componentId}:${q}`)??[];});
        failure(call,"JAVA_BINDING_AMBIGUOUS",candidates);continue;
      }
      if(receiver&&(children.get(material.root.objectId)??[]).some(o=>o.kind==="JAVA_TYPE"&&o.name===receiver)){failure(call,"JAVA_BINDING_UNSUPPORTED");continue;}
      if(!receiver&&(ownMethods.length||implicitObjectMethodNames.has(name))){failure(call,"JAVA_BINDING_UNSUPPORTED",ownMethods);continue;}
      if(applicable.length){const imp=applicable[0];targetName=one(imp,"path").value.value;if(!receiver)targetName=targetName.split(".").slice(0,-1).join(".");binding=[one(imp,"path"),one(imp,"importKind")];}
      else if(receiver){const p=one(material.root,"packageName");if(!p){failure(call,"JAVA_BINDING_UNRESOLVED");continue;}targetName=`${p.value.value}${p.value.value?".":""}${receiver}`;binding=[p];}
      else{failure(call,"JAVA_BINDING_UNRESOLVED");continue;}
    }
    const types=qualified.get(`${material.componentId}:${targetName}`)??[];
    if(types.length!==1){failure(call,types.length?"JAVA_BINDING_AMBIGUOUS":"JAVA_BINDING_UNRESOLVED",types);continue;}
    const owner=types[0],candidates=(children.get(owner.objectId)??[]).filter(o=>o.kind==="JAVA_METHOD"&&one(o,"name")?.value.value===name);
    if(candidates.length!==1){failure(call,candidates.length?"JAVA_BINDING_AMBIGUOUS":"JAVA_BINDING_UNRESOLVED",candidates);continue;}
    const target=candidates[0],required=javaBindingRequiredProperties(call,sourceOwner,target,owner,name);
    const proof=required.map(([id,p,v])=>{const f=one(id,p);return f&&(v===undefined||f.value.value===v)?f:null;});
    if(byId.get(owner.parentId)?.kind!=="MATERIAL"||proof.some(f=>!f)||(children.get(target.objectId)??[]).some(o=>o.kind==="JAVA_PARAMETER")){
      failure(call,"JAVA_BINDING_UNSUPPORTED",[target]);continue;
    }
    addFact({subject:source,predicate:"staticCalls",target,material,anchor:call.anchor,basis:"DERIVED",premiseFactIds:[...proof,...binding].map(f=>f.factId)});
  }
}
