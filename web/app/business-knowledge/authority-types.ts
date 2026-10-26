import type {PublicationBinding,Proposition} from "./types.ts";
export type ExecutionTarget={testSpecId:string;testSpecVersion:number;snapshotManifestId:string;deploymentId:string};
export type AuthorityTarget={featureId:string;featureVersion:number;claimId:string;claimVersion:number;scopeId:string;scopeVersion:number;verificationTargets:ExecutionTarget[]};
export type ScopeSnapshot={id:string;version:number;scope:unknown;effectiveFrom?:string|null;effectiveTo?:string|null};
export type SavedTarget=AuthorityTarget&{scope:ScopeSnapshot};
export type BindingSet={id:string;workspaceId:string;graphRevisionId:string;graphDigest:string;sourceBundleId:string;objectKey:string;version:number;actorId:string;rationale:string;targets:SavedTarget[];createdAt:string};
export type BindingInput={operationId:string;expectedGraphDigest:string;objectKey:string;expectedVersion:number;rationale:string;targets:AuthorityTarget[]};
export type DecisionRecord={id:string;type:string;content:string;actorId:string;actorRole:string;validUntil:string|null;createdAt:string;evidenceRefs:string[]};
export type VerificationProjection=ExecutionTarget&{status:string;testSpecApproved:boolean;ordering:string;truncated:boolean;
  history:{id:string;receivedAt:string;status:string;trusted:boolean;evidenceRefs:string[]}[]};
export type ProjectedTarget=SavedTarget&{authority:{status:string;latestDecision:DecisionRecord|null;history:DecisionRecord[];historyTruncated:boolean;scopeActive:boolean;versionCurrent:boolean;applies:boolean};verification:VerificationProjection[]};
export type AuthorityResponse={bindingSet:BindingSet|null;currentBindingVersion:number;projection:{kind:"DERIVED_AUTHORITY_AND_EXECUTION";workspaceId:string;graphRevisionId:string;graphDigest:string;objectKey:string;analysisState:string;evaluatedAt:string;targets:ProjectedTarget[]}};
export type Publication={workspaceId:string;investigationId:string;graphDigest:string;graphRevisionId:string;headVersion:number;publishedAt:string;binding:PublicationBinding};
export type PublishedVersion={publication:Publication;revision:{id:string;projectId:string;status:string;analysisRunId:string;graphArtifactDigest:string};
  graph:{digest:string;sourceBundleId:string;profileId:string;adoptedVersionIds:string[];candidates:Proposition[];relations:Proposition[]}};
export type AuthorityFixed={graphDigest:string;sourceBundleId:string};

const positive=(v:number)=>Number.isSafeInteger(v)&&v>0;
const nonempty=(v:string)=>typeof v==="string"&&v.length>0;
const targetIdentity=(t:AuthorityTarget)=>JSON.stringify([t.featureId,t.featureVersion,t.claimId,t.claimVersion,t.scopeId,t.scopeVersion,t.verificationTargets]);
const scopeMatches=(t:SavedTarget)=>!!t.scope&&t.scope.id===t.scopeId&&t.scope.version===t.scopeVersion;
const decisionMatches=(d:DecisionRecord)=>!!d&&[d.id,d.type,d.actorId,d.actorRole,d.createdAt].every(nonempty)
  &&typeof d.content==="string"&&(d.validUntil===null||nonempty(d.validUntil))&&Array.isArray(d.evidenceRefs)&&d.evidenceRefs.every(nonempty);
export function bindingMatches(value:BindingSet,workspace:string,revision:string,key:string,fixed:AuthorityFixed) {
  return !!value&&value.workspaceId===workspace&&value.graphRevisionId===revision&&value.graphDigest===fixed.graphDigest
    &&value.sourceBundleId===fixed.sourceBundleId&&value.objectKey===key&&positive(value.version)&&typeof value.rationale==="string"&&Array.isArray(value.targets)&&value.targets.length<=50
    &&value.targets.every(t=>t&&[t.featureId,t.claimId,t.scopeId].every(nonempty)&&[t.featureVersion,t.claimVersion,t.scopeVersion].every(positive)
      &&scopeMatches(t)&&Array.isArray(t.verificationTargets)&&t.verificationTargets.length<=20&&t.verificationTargets.every(v=>v&&nonempty(v.testSpecId)&&positive(v.testSpecVersion)&&nonempty(v.snapshotManifestId)&&nonempty(v.deploymentId)));
}
export function authorityMatches(value:AuthorityResponse,workspace:string,revision:string,key:string,fixed:AuthorityFixed,history?:number) {
  const p=value?.projection,b=value?.bindingSet;
  if(!p||p.kind!=="DERIVED_AUTHORITY_AND_EXECUTION"||p.workspaceId!==workspace||p.graphRevisionId!==revision
    ||p.graphDigest!==fixed.graphDigest||p.objectKey!==key||!Array.isArray(p.targets)||typeof p.analysisState!=="string"
    ||!Number.isSafeInteger(value.currentBindingVersion)||value.currentBindingVersion<0)return false;
  if(b===null)return history===undefined&&value.currentBindingVersion===0&&p.targets.length===0;
  if(!bindingMatches(b,workspace,revision,key,fixed)||b.version>value.currentBindingVersion
    ||b.version!==(history??value.currentBindingVersion)||p.targets.length!==b.targets.length)return false;
  return p.targets.every((t,i)=>t&&targetIdentity(t)===targetIdentity(b.targets[i])&&scopeMatches(t)&&JSON.stringify(t.scope)===JSON.stringify(b.targets[i].scope)&&t.authority
    &&[t.authority.scopeActive,t.authority.versionCurrent,t.authority.applies,t.authority.historyTruncated].every(v=>typeof v==="boolean")
    &&(!t.authority.applies||(t.authority.scopeActive&&t.authority.versionCurrent&&["CONFIRMED","EXCEPTION_RECORDED"].includes(t.authority.status)))
    &&Array.isArray(t.authority.history)&&t.authority.history.length<=100
    &&t.authority.history.every(decisionMatches)
    &&(t.authority.latestDecision===null?t.authority.history.length===0&&t.authority.status==="UNREVIEWED":decisionMatches(t.authority.latestDecision)&&JSON.stringify(t.authority.latestDecision)===JSON.stringify(t.authority.history.at(-1)))
    &&Array.isArray(t.verification)&&t.verification.length===t.verificationTargets.length
    &&t.verification.every((v,n)=>v&&JSON.stringify([v.testSpecId,v.testSpecVersion,v.snapshotManifestId,v.deploymentId])===JSON.stringify([t.verificationTargets[n].testSpecId,t.verificationTargets[n].testSpecVersion,t.verificationTargets[n].snapshotManifestId,t.verificationTargets[n].deploymentId])
      &&typeof v.status==="string"&&typeof v.testSpecApproved==="boolean"&&typeof v.truncated==="boolean"
      &&["SERVER_RECEIPT_TIME","UNDETERMINED_RECEIPT_ORDER"].includes(v.ordering)
      &&Array.isArray(v.history)&&v.history.length<=20&&v.history.every(h=>h&&nonempty(h.id)&&typeof h.trusted==="boolean"&&typeof h.status==="string"&&Array.isArray(h.evidenceRefs)&&h.evidenceRefs.every(nonempty))
      &&(v.status!=="NOT_RUN"||v.history.length===0)
      &&(["NOT_RUN","UNKNOWN"].includes(v.status)||(v.history[0]?.trusted&&v.history[0]?.status===v.status))));
}
export function publicationMatches(value:Publication,workspace:string){
  return !!value&&value.workspaceId===workspace&&nonempty(value.graphRevisionId)&&nonempty(value.investigationId)&&positive(value.headVersion)
    &&value.binding?.workspaceId===workspace&&value.binding.investigationId===value.investigationId&&value.binding.graphDigest===value.graphDigest
    &&nonempty(value.binding.sourceInput?.sourceBundleSnapshotId)&&nonempty(value.binding.sourceInput?.receiptId)
    &&nonempty(value.binding.profileId)&&Array.isArray(value.binding.adoptedVersionIds);
}
export function mappedTargetsMatch(left:AuthorityTarget[],right:AuthorityTarget[]){return left.length===right.length&&left.every((t,i)=>targetIdentity(t)===targetIdentity(right[i]));}
