import {createHash} from 'node:crypto';
import {canonicalEncode} from '../source-truth/identity.js';
import {requireF003} from './errors.js';

// A supported, scoped candidate contract is not an adopted production policy.
// Only trusted deployment configuration can select it; no report selects rules.
export const graphQualityContract=Object.freeze({adapterId:'F003-BKG-765-A1-v1',
  contractId:'F003-BKG-MEASUREMENT-CANDIDATE-20261023-R1',contractHash:'765ec4e799be65909913672da937b4153459d8042c8a0432d2e8fdbfc1dd5b1b',
  appendixId:'F003-BKG-MEASUREMENT-APPENDIX-A1',appendixHash:'94efba355077b197bf5042e439f3df1cc3e39b45d9223f9dfdb540ea334fe273'});
const hash=v=>createHash('sha256').update(canonicalEncode(v)).digest('hex');
const digest=v=>typeof v==='string' && /^[a-f0-9]{64}$/.test(v);
const name=v=>typeof v==='string' && v.length>0 && v.length<=256;
const count=v=>Number.isSafeInteger(v) && v>=0;
const positive=v=>count(v) && v>0;
const exact=(v,keys)=>v && typeof v==='object' && !Array.isArray(v) && Object.keys(v).every(k=>keys.includes(k));
const comparisonKinds=['modelRebuild','persistenceRecovery','incrementalFull'];
const sourceKeys=['workspaceId','sourceRevision','sourceBundleSnapshotId','receiptId','inventoryId','inventoryDigest','sourceProof'];
const sortedIds=v=>Array.isArray(v) && v.length>0 && v.length<=128 && v.every(digest)
  && new Set(v).size===v.length && v.every((id,i)=>i===0 || v[i-1]<id);
const validComponent=c=>exact(c,['componentSnapshotId','kind','manifestId','nativeIdentity'])
    && digest(c.componentSnapshotId) && digest(c.manifestId)
    && (c.kind==='DIRECTORY_UPLOAD' ? exact(c.nativeIdentity,['manifestDigest']) && c.nativeIdentity.manifestDigest===c.manifestId
      : c.kind==='GIT' && exact(c.nativeIdentity,['objectFormat','resolvedCommit'])
        && ['sha1','sha256'].includes(c.nativeIdentity.objectFormat)
        && new RegExp(`^[a-f0-9]{${c.nativeIdentity.objectFormat==='sha1'?40:64}}$`).test(c.nativeIdentity.resolvedCommit??''));
const componentIdentity=({componentSnapshotId,kind,manifestId,nativeIdentity})=>({componentSnapshotId,kind,manifestId,nativeIdentity});
const validManifest=m=>exact(m,['version','components','entryCount','entriesDigest','coverageDigest']) && m.version===1
  && positive(m.entryCount) && m.entryCount<=200000 && digest(m.entriesDigest) && digest(m.coverageDigest)
  && Array.isArray(m.components) && m.components.length>0 && m.components.length<=128
  && m.components.every((c,i)=>validComponent(c) && (i===0 || m.components[i-1].componentSnapshotId<c.componentSnapshotId));
const validSourceProof=p=>exact(p,['componentIds','manifest','registrationArtifactDigest']) && sortedIds(p.componentIds)
  && validManifest(p.manifest) && digest(p.registrationArtifactDigest)
  && canonicalEncode(p.componentIds)===canonicalEncode(p.manifest.components.map(c=>c.componentSnapshotId));

// Same identity projection for the F001 stream and immutable graph inventory;
// transport/reading/semantic association states are deliberately not promoted.
export function inventoryEntryIdentity(r) {
  return {key:r.key??null,componentId:r.componentId??null,pathBytes:r.pathBytes??null,kind:r.kind??null,
    disposition:r.disposition??null,reasonCode:r.reasonCode??null,sizeBytes:r.sizeBytes??null,materialId:r.materialId??null};
}
function graphInventoryDigest(rows) {
  if(!Array.isArray(rows) || rows.length>200000 || rows.some(r=>!r || !digest(r.componentId)
    || typeof r.pathBytes!=='string'))return null;
  const ordered=[...rows].sort((a,b)=>a.componentId.localeCompare(b.componentId)
    || Buffer.compare(Buffer.from(a.pathBytes,'base64url'),Buffer.from(b.pathBytes,'base64url')));
  const h=createHash('sha256');for(const row of ordered)h.update(canonicalEncode(inventoryEntryIdentity(row))).update('\n');
  return h.digest('hex');
}
export {graphInventoryDigest};

const object=v=>v!==null && typeof v==='object' && !Array.isArray(v);
const timestamp=v=>typeof v==='string' && Number.isFinite(Date.parse(v));
const comparisonKeys=['workspaceId','investigationId','graphDigest','sourceInput','investigationScope','sourceManifest',
  'adoptedVersionIds','technicalVersions','profileId','modelRevisionIds','implementationVersion',
  'questionDigest','budget','supplementBudget','admittedAt','runContractDigest'];
function comparisonConditions(b) {
  if(!exact(b,comparisonKeys) || !name(b.workspaceId) || !name(b.investigationId) || !digest(b.graphDigest)
    || !digest(b.questionDigest) || !timestamp(b.admittedAt)
    || !object(b.sourceInput) || b.sourceInput.workspaceId!==b.workspaceId || !name(b.sourceInput.receiptId)
    || !['sourceBundleSnapshotId','inventoryId','inventoryDigest'].every(k=>digest(b.sourceInput[k]))
    || b.sourceInput.bundleId!==b.sourceInput.sourceBundleSnapshotId
    || !Array.isArray(b.sourceInput.components) || !b.sourceInput.components.length
    || b.sourceInput.components.length>128 || !b.sourceInput.components.every(c=>object(c) && validComponent(componentIdentity(c)))
    || new Set(b.sourceInput.components.map(c=>c.componentSnapshotId)).size!==b.sourceInput.components.length
    || !exact(b.investigationScope,['componentIds']) || !sortedIds(b.investigationScope.componentIds) || !validManifest(b.sourceManifest)
    || !Array.isArray(b.adoptedVersionIds) || b.adoptedVersionIds.length>1000 || !b.adoptedVersionIds.every(digest)
    || new Set(b.adoptedVersionIds).size!==b.adoptedVersionIds.length
    || !Array.isArray(b.technicalVersions) || b.technicalVersions.length!==b.adoptedVersionIds.length
    || !b.technicalVersions.every((t,i)=>exact(t,['versionId','profileId','recordDigest']) && t.versionId===b.adoptedVersionIds[i]
      && name(t.profileId) && digest(t.recordDigest))
    || !name(b.profileId) || !Array.isArray(b.modelRevisionIds) || !b.modelRevisionIds.length
    || b.modelRevisionIds.length>128 || !b.modelRevisionIds.every(name)
    || !exact(b.implementationVersion,['status','commitSha','sourceDigest']) || b.implementationVersion.status!=='VERIFIED'
    || !/^[a-f0-9]{40}$/.test(b.implementationVersion.commitSha??'') || !digest(b.implementationVersion.sourceDigest))return null;
  const selected=b.sourceInput.components.filter(c=>b.investigationScope.componentIds.includes(c.componentSnapshotId))
    .map(componentIdentity).sort((a,b)=>a.componentSnapshotId.localeCompare(b.componentSnapshotId));
  if(canonicalEncode(selected)!==canonicalEncode(b.sourceManifest.components))return null;
  const budget=b.budget,s=b.supplementBudget;
  if(!exact(budget,['maxReadBytes','maxModelCalls','deadline']) || !positive(budget.maxReadBytes)
    || !positive(budget.maxModelCalls) || !timestamp(budget.deadline)
    || !exact(s,['maxMaterials','maxBytes','maxRuleApplications','maximumAttempts','deadline'])
    || !['maxMaterials','maxBytes','maxRuleApplications','maximumAttempts'].every(k=>positive(s[k])) || !timestamp(s.deadline))return null;
  const windowMs=Date.parse(budget.deadline)-Date.parse(b.admittedAt),supplementWindowMs=Date.parse(s.deadline)-Date.parse(b.admittedAt);
  if(!positive(windowMs) || !positive(supplementWindowMs) || supplementWindowMs>windowMs)return null;
  return {version:1,workspaceId:b.workspaceId,questionDigest:b.questionDigest,
    source:Object.fromEntries(['sourceBundleSnapshotId','receiptId','inventoryId','inventoryDigest'].map(k=>[k,b.sourceInput[k]])),
    investigationScope:b.investigationScope,sourceManifest:b.sourceManifest,adoptedVersionIds:b.adoptedVersionIds,
    technicalVersions:b.technicalVersions,profileId:b.profileId,modelRevisionIds:b.modelRevisionIds,implementationVersion:b.implementationVersion,
    budget:{maxReadBytes:budget.maxReadBytes,maxModelCalls:budget.maxModelCalls,windowMs},
    supplementBudget:{maxMaterials:s.maxMaterials,maxBytes:s.maxBytes,maxRuleApplications:s.maxRuleApplications,
      maximumAttempts:s.maximumAttempts,windowMs:supplementWindowMs}};
}
// Exact relative admitted windows, not absolute wall-clock deadline strings.
// No rounding/tolerance or report-supplied normalization. Unsupported/missing
// historical rule evidence remains unqualified; never infer the caller's intent.
export function comparisonContractDigest(binding) {
  const conditions=comparisonConditions(binding);return conditions ? hash(conditions) : null;
}

export function selectGraphQualityPolicy(value=null) {
  if(value===null)return null;
  requireF003(exact(value,[...Object.keys(graphQualityContract),'scope'])
    && Object.entries(graphQualityContract).every(([k,v])=>value[k]===v),
  'F003_QUALITY_POLICY_INVALID','需要部署侧明确选择受支持的图谱计量合同及精确摘要',{status:503});
  const s=value.scope;
  requireF003(exact(s,['id','sources','referencePackageId','referenceDigest','comparisonPlanDigest','registeredAttempts',
    'measurementPlanDigest','calibrationDigest','evaluatorIssuerId','calibratorIssuerId'])
    && name(s.id) && Array.isArray(s.sources) && s.sources.length>0 && s.sources.length<=128
    && s.sources.every(r=>exact(r,sourceKeys) && name(r.workspaceId) && name(r.receiptId)
      && /^[a-f0-9]{40}$/.test(r.sourceRevision??'') && ['sourceBundleSnapshotId','inventoryId','inventoryDigest'].every(k=>digest(r[k]))
      && validSourceProof(r.sourceProof))
    && new Set(s.sources.map(r=>hash({...r,sourceRevision:null,sourceProof:{componentIds:r.sourceProof.componentIds}}))).size===s.sources.length
    && name(s.referencePackageId)
    && ['referenceDigest','measurementPlanDigest','comparisonPlanDigest','calibrationDigest'].every(k=>digest(s[k]))
    && Array.isArray(s.registeredAttempts) && s.registeredAttempts.length>0 && s.registeredAttempts.length<=1000
    && s.registeredAttempts.every(a=>exact(a,['id','kind','conditionsDigest']) && name(a.id)
      && comparisonKinds.includes(a.kind) && digest(a.conditionsDigest))
    && new Set(s.registeredAttempts.map(a=>a.id)).size===s.registeredAttempts.length
    && comparisonKinds.every(kind=>s.registeredAttempts.some(a=>a.kind===kind))
    && name(s.evaluatorIssuerId) && name(s.calibratorIssuerId) && s.evaluatorIssuerId!==s.calibratorIssuerId,
  'F003_QUALITY_POLICY_INVALID','计量范围、参考工件与独立签发身份必须由部署配置固定',{status:503});
  return structuredClone(value);
}

export function calibrationBinding(policy) {
  const s=policy.scope;
  // Reference qualification precedes measured run output. Bind its logical
  // source revisions and reference/plan, not a future graph or model answer.
  const scope={id:s.id,sourceRevisions:[...new Set((s.sources??[]).map(r=>r.sourceRevision))].sort(),
    referencePackageId:s.referencePackageId,referenceDigest:s.referenceDigest,measurementPlanDigest:s.measurementPlanDigest};
  return {contract:graphQualityContract,scope};
}

const definitions={
  semanticRecall:['SEMANTIC_CLAIM',9,10],
  outputClaimPrecision:['AFFIRMATIVE_SEMANTIC_CLAIM',9,10],
  outputRelationPrecision:['AFFIRMATIVE_DIRECTED_RELATION',9,10],
  requiredRelations:['REQUIRED_POSITIVE_DIRECTED_RELATION',1,1],
  sourceSupportClaims:['AFFIRMATIVE_SEMANTIC_CLAIM',9,10],
  sourceSupportRelations:['AFFIRMATIVE_DIRECTED_RELATION',9,10],
  unknownHonesty:['INDEPENDENT_UNKNOWN_OBLIGATION_OR_DECLARATION',1,1],
  inventoryDisposition:['F001_INVENTORY_ENTRY',1,1],
  modelRebuild:['COMPLETED_REAL_MODEL_REBUILD_PAIR',1,1],
  persistenceRecovery:['COMPLETED_PERSISTENT_RECOVERY_PAIR',1,1],
  incrementalFull:['COMPLETED_A_TO_B_VS_FULL_B_PAIR',1,1],
};
export const graphQualityDimensions=Object.freeze(Object.keys(definitions));
const states=['SUPPORTED','CONTRADICTED','PARTIAL','UNRESOLVED','OMITTED'];

// This verifier consumes independent, signed semantic judgements. It does not
// read hidden answers, infer semantic equivalence or issue a quality signature.
// Every returned reason denies eligibility; no average or rounded percentage.
export function assessGraphQuality(record,graph,binding,policy,authority) {
  if(!policy)return [{code:'F003_QUALITY_POLICY_UNCONFIRMED'}];
  const missing=[],note=(code,dimension)=>missing.push({code,...(dimension?{dimension}:{})});
  try {record=authority.verify(record?.document,binding);} catch {return [{code:'F003_QUALITY_REPORT_UNTRUSTED'}];}
  const q=record?.document?.payload?.quality,s=policy.scope;
  if(!q || q.version!==1 || q.measurementKind!=='INDEPENDENT_GRAPH_SEMANTIC_MEASUREMENT'
    || q.evidenceClass!=='REAL_PROJECT' || record.issuerId!==s.evaluatorIssuerId
    || !exact(q.contract,Object.keys(graphQualityContract)) || !Object.entries(graphQualityContract).every(([k,v])=>q.contract?.[k]===v)) {
    note('F003_QUALITY_REPORT_INCOMPLETE');return missing;
  }
  const registration=s.sources.find(r=>r.workspaceId===binding.workspaceId && r.sourceRevision===q.sourceRevision
    && ['sourceBundleSnapshotId','receiptId','inventoryId','inventoryDigest'].every(k=>r[k]===binding.sourceInput?.[k])
    && canonicalEncode(r.sourceProof.componentIds)===canonicalEncode(binding.investigationScope?.componentIds??null));
  if(!registration || q.scopeId!==s.id
    || q.inventoryDigest!==binding.sourceInput.inventoryDigest
    || canonicalEncode(q.finalImplementation??null)!==canonicalEncode(binding.implementationVersion)
    || binding.implementationVersion?.status!=='VERIFIED')note('F003_QUALITY_SCOPE_MISMATCH');
  // Logical reference revision is NOT an upload's native identity. Deployment
  // preregisters an independently checked file-version map for the exact F001
  // tuple and selected scope. The server hashes actual immutable entry metadata;
  // neither a report nor an unrelated Git component can supply this proof.
  const proof=registration?.sourceProof,ids=binding.investigationScope?.componentIds;
  const selected=(binding.sourceInput.components??[]).filter(c=>ids?.includes(c.componentSnapshotId))
    .map(({componentSnapshotId,kind,manifestId,nativeIdentity})=>({componentSnapshotId,kind,manifestId,nativeIdentity}))
    .sort((a,b)=>a.componentSnapshotId.localeCompare(b.componentSnapshotId));
  if(!validSourceProof(proof) || !sortedIds(ids) || !validManifest(binding.sourceManifest)
    || canonicalEncode(proof.componentIds)!==canonicalEncode(ids)
    || canonicalEncode(proof.manifest)!==canonicalEncode(binding.sourceManifest)
    || canonicalEncode(selected)!==canonicalEncode(binding.sourceManifest?.components)
    || graph.coverage.length!==binding.sourceManifest?.entryCount
    || graphInventoryDigest(graph.coverage)!==binding.sourceManifest?.coverageDigest
    || q.sourceRegistrationDigest!==hash(registration))
    note('F003_QUALITY_SOURCE_QUALIFICATION_INVALID');
  if(!Array.isArray(binding.technicalVersions) || !Array.isArray(q.technicalVersions)
    || canonicalEncode(q.technicalVersions)!==canonicalEncode(binding.technicalVersions)
    || canonicalEncode(binding.technicalVersions.map(t=>t.versionId))!==canonicalEncode(binding.adoptedVersionIds))
    note('F003_QUALITY_TECHNICAL_BINDING_MISMATCH');
  const artifacts=q.artifacts;
  if(!artifacts || artifacts.referencePackageId!==s.referencePackageId || artifacts.referenceDigest!==s.referenceDigest
    || artifacts.measurementPlanDigest!==s.measurementPlanDigest || artifacts.comparisonPlanDigest!==s.comparisonPlanDigest
    || !['classificationLedgerDigest','measurementLedgerDigest','comparisonPlanDigest','attemptLedgerDigest','runManifestDigest',
      'originalToCanonicalMappingDigest','modelInvocationLedgerDigest'].every(k=>digest(artifacts[k])))note('F003_QUALITY_ARTIFACTS_MISSING');
  let calibration=null;
  try {
    requireF003(authority?.verifyCalibration && hash(q.calibration)===s.calibrationDigest,
      'F003_QUALITY_CALIBRATION_INVALID','校准工件不属于部署选择');
    calibration=authority.verifyCalibration(q.calibration,calibrationBinding(policy));
    requireF003(calibration.issuerId===s.calibratorIssuerId,'F003_QUALITY_CALIBRATION_INVALID','校准身份不匹配');
    calibration=calibration.document.payload.calibration;
    requireF003(calibration?.status==='QUALIFIED' && calibration.contractStatus==='QUALIFIED'
      && calibration.supplementStatus==='QUALIFIED' && calibration.semanticReviewComplete===true
      && calibration.preparedWithoutModelOutputs===true && digest(calibration.artifactDigest)
      && calibration.referenceDigest===s.referenceDigest && calibration.measurementPlanDigest===s.measurementPlanDigest,
    'F003_QUALITY_CALIBRATION_INVALID','独立语义校准资格未闭合');
  } catch {note('F003_QUALITY_CALIBRATION_INVALID');calibration=null;}
  const units=calibration?.unitsBySource?.[q.sourceRevision];
  if(!units || !['semanticClaims','positiveRelations','forbiddenConstraints','unknownObligations'].every(k=>positive(units[k]))
    || !count(units.unknownRelationObligations))note('F003_QUALITY_REFERENCE_UNITS_INVALID');
  const population=q.population;
  if(!population || population.kind!=='FULL_SEMANTIC_CENSUS' || population.unresolved!==0
    || !['classificationBeforeScoring','scopeResolved','allVisibleAssertionsIncluded','duplicatesAudited','retainedCitationsAudited'].every(k=>population[k]===true)
    || !['outputClaims','outputRelations','unknownUnion'].every(k=>positive(population[k])))note('F003_QUALITY_POPULATION_UNQUALIFIED');
  const expected={semanticRecall:units?.semanticClaims,requiredRelations:units?.positiveRelations,
    outputClaimPrecision:population?.outputClaims,sourceSupportClaims:population?.outputClaims,
    outputRelationPrecision:population?.outputRelations,sourceSupportRelations:population?.outputRelations,
    unknownHonesty:population?.unknownUnion,inventoryDisposition:binding.sourceManifest?.entryCount};
  for(const [dimension,[unit,n,d]] of Object.entries(definitions)) {
    const m=q.dimensions?.[dimension];
    if(!m || m.status!=='MEASURED' || m.unit!==unit || !count(m.numerator) || !positive(m.denominator)
      || m.numerator>m.denominator || !exact(m.states,states) || !states.every(k=>count(m.states[k]))
      || Object.values(m.states).reduce((a,b)=>BigInt(a)+BigInt(b),0n)!==BigInt(m.denominator)
      || m.states.SUPPORTED!==m.numerator) {note('F003_QUALITY_DIMENSION_INVALID',dimension);continue;}
    if(m.states.UNRESOLVED!==0)note('F003_QUALITY_DIMENSION_UNRESOLVED',dimension);
    if(BigInt(m.numerator)*BigInt(d)<BigInt(m.denominator)*BigInt(n))note('F003_QUALITY_THRESHOLD',dimension);
    if(expected[dimension]!==undefined && m.denominator!==expected[dimension])note('F003_QUALITY_DENOMINATOR',dimension);
  }
  if(q.dimensions?.sourceSupportClaims?.denominator!==q.dimensions?.outputClaimPrecision?.denominator
    || q.dimensions?.sourceSupportRelations?.denominator!==q.dimensions?.outputRelationPrecision?.denominator)
    note('F003_QUALITY_SUPPORT_POPULATION_MISMATCH');
  if(units && (!(q.dimensions?.unknownHonesty?.denominator>=units.unknownObligations)
    || q.unknownRelationObligations!==units.unknownRelationObligations))note('F003_QUALITY_REFERENCE_UNITS_INVALID');
  const f=q.forbidden;
  if(!f || f.status!=='MEASURED' || f.unit!=='APPLICABLE_FORBIDDEN_CONSTRAINT' || !positive(f.denominator)
    || !['absent','violations','unresolved','criticalViolations'].every(k=>count(f[k]))
    || BigInt(f.absent)+BigInt(f.violations)+BigInt(f.unresolved)!==BigInt(f.denominator)
    || f.denominator!==units?.forbiddenConstraints || f.violations!==0 || f.unresolved!==0 || f.criticalViolations!==0)
    note('F003_QUALITY_FORBIDDEN_NOT_CLEARED');
  const attempts=q.attempts;
  if(!Array.isArray(attempts) || !attempts.length || attempts.length>1000 || new Set(attempts.map(a=>a?.id)).size!==attempts.length
    || attempts.some(a=>!name(a?.id) || !comparisonKinds.includes(a.kind)
      || !['COMPLETED','FAILED','CANCELLED','RUNNING','UNMEASURED','UNRESOLVED'].includes(a.status)
      || !digest(a.artifactDigest) || !digest(a.bindingDigest)))note('F003_QUALITY_COMPARISON_ATTEMPTS_INCOMPLETE');
  else {
    if(artifacts?.attemptLedgerDigest!==hash(attempts))note('F003_QUALITY_ARTIFACT_MISMATCH');
    if(attempts.length!==s.registeredAttempts.length || s.registeredAttempts.some(r=>!attempts.some(a=>a.id===r.id && a.kind===r.kind)))
      note('F003_QUALITY_COMPARISON_REGISTRATION_MISMATCH');
    const expectedConditions=comparisonContractDigest(binding);
    for(const a of attempts) {
      if(a.status!=='COMPLETED')note('F003_QUALITY_COMPARISON_ATTEMPTS_INCOMPLETE',a.kind);
      const valid=expectedConditions && binding.runContractDigest===expectedConditions
        && s.registeredAttempts.find(r=>r.id===a.id && r.kind===a.kind)?.conditionsDigest===expectedConditions
        && a.conditionsDigest===expectedConditions
        && [a.leftBinding,a.rightBinding].every(b=>comparisonContractDigest(b)===expectedConditions && b.runContractDigest===expectedConditions);
      if(!valid || a.bindingDigest!==hash(binding)
        || ![a.leftBinding,a.rightBinding].some(b=>hash(b)===hash(binding)))note('F003_QUALITY_COMPARISON_BINDING_MISMATCH',a.kind);
      const modes=a.kind==='modelRebuild'?['REAL_MODEL_REBUILD','REAL_MODEL_REBUILD']:
        a.kind==='persistenceRecovery'?['PERSISTED','RESTORED']:['INCREMENTAL_A_TO_B','FULL_B'];
      if(a.leftMode!==modes[0] || a.rightMode!==modes[1]
        || (a.kind!=='persistenceRecovery' && a.leftBinding?.investigationId===a.rightBinding?.investigationId)
        || (valid && a.kind==='persistenceRecovery' && hash(a.leftBinding)!==hash(a.rightBinding))
        || (a.kind==='incrementalFull' && (!/^[a-f0-9]{40}$/.test(a.baseSourceRevision??'')
          || a.baseSourceRevision===q.sourceRevision || !digest(a.reusedSemanticResultDigest))))note('F003_QUALITY_COMPARISON_MODE_INVALID',a.kind);
    }
    for(const dimension of comparisonKinds) {
      const completed=attempts.filter(a=>a.kind===dimension && a.status==='COMPLETED');
      if(!completed.length || q.dimensions?.[dimension]?.denominator!==completed.length
        || q.dimensions?.[dimension]?.numerator!==completed.filter(a=>a.equivalent===true).length)
        note('F003_QUALITY_COMPARISON_ATTEMPTS_INCOMPLETE',dimension);
    }
  }
  return missing;
}
