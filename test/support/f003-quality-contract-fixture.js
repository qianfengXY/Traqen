import {generateKeyPairSync,sign} from 'node:crypto';
import {canonicalEncode,structureDigest} from '../../src/source-truth/identity.js';
import {publicationDigest,PublicationAuthority} from '../../src/business-knowledge/publication-authority.js';
import {graphQualityContract,calibrationBinding,assessGraphQuality,graphInventoryDigest,comparisonContractDigest} from '../../src/business-knowledge/quality-contract-adapter.js';

// Public synthetic counter metadata only. No private answers, real measurement,
// model execution, production policy or protected physical-media attestation.
export function qualityContractFixture({binding:inputBinding=null,inventorySize=24,sourceKind='DIRECTORY_UPLOAD'}={}) {
  const evaluator=generateKeyPairSync('ed25519'),calibrator=generateKeyPairSync('ed25519');
  const sourceRevision=inputBinding?.sourceInput?.components?.find(c=>c.kind==='GIT')?.nativeIdentity?.resolvedCommit??'1'.repeat(40);
  const defaultSource={workspaceId:'workspace',sourceBundleSnapshotId:'2'.repeat(64),
    bundleId:'2'.repeat(64),receiptId:'synthetic-receipt',inventoryId:'3'.repeat(64),inventoryDigest:'4'.repeat(64)};
  defaultSource.components=[{componentSnapshotId:'f'.repeat(64),kind:'DIRECTORY_UPLOAD',manifestId:'d'.repeat(64),
    nativeIdentity:{manifestDigest:'d'.repeat(64)}}];
  if(sourceKind==='GIT')Object.assign(defaultSource.components[0],{kind:'GIT',nativeIdentity:{objectFormat:'sha1',resolvedCommit:sourceRevision}});
  const coverage=Array.from({length:inventorySize},(_,i)=>{
    const locator={componentId:defaultSource.components[0].componentSnapshotId,pathBytes:Buffer.from(`synthetic-${i}.txt`).toString('base64url')};
    return {...locator,key:publicationDigest(locator),kind:'FILE',disposition:'VERIFIED',reasonCode:'SYNTHETIC_ONLY',sizeBytes:'1',
      materialId:structureDigest('material',{workspaceId:'workspace',bundleId:defaultSource.sourceBundleSnapshotId,...locator,contentDigest:'e'.repeat(64)})};
  });
  const binding=inputBinding?structuredClone(inputBinding):{workspaceId:'workspace',investigationId:'synthetic-run',graphDigest:'5'.repeat(64),sourceInput:defaultSource,
    questionDigest:publicationDigest('same fixed question'),admittedAt:'2026-01-01T00:00:00.000Z',
    budget:{maxReadBytes:403345,maxModelCalls:12,deadline:'2026-01-01T00:20:00.000Z'},
    supplementBudget:{maxMaterials:24,maxBytes:403345,maxRuleApplications:1000000,maximumAttempts:1,deadline:'2026-01-01T00:20:00.000Z'},
    investigationScope:{componentIds:defaultSource.components.map(c=>c.componentSnapshotId)},
    sourceManifest:{version:1,components:structuredClone(defaultSource.components),entryCount:inventorySize,entriesDigest:'b'.repeat(64),coverageDigest:graphInventoryDigest(coverage)},
    adoptedVersionIds:['6'.repeat(64)],profileId:'synthetic-profile',modelRevisionIds:['main-r1','child-r1'],
    technicalVersions:[{versionId:'6'.repeat(64),profileId:'f'.repeat(64),recordDigest:'e'.repeat(64)}],
    implementationVersion:{status:'VERIFIED',commitSha:'7'.repeat(40),sourceDigest:'8'.repeat(64)}};
  binding.runContractDigest=comparisonContractDigest(binding);
  const sourceInput=binding.sourceInput;
  const registeredAttempts=['modelRebuild','persistenceRecovery','incrementalFull'].map((kind,i)=>({id:`synthetic-attempt-${i}`,kind,
    conditionsDigest:binding.runContractDigest}));
  const policy={...graphQualityContract,scope:{id:'SYNTHETIC_MECHANISM_ONLY',
    sources:[{workspaceId:'workspace',sourceRevision,sourceBundleSnapshotId:sourceInput.sourceBundleSnapshotId,
      receiptId:sourceInput.receiptId,inventoryId:sourceInput.inventoryId,inventoryDigest:sourceInput.inventoryDigest,
      sourceProof:{componentIds:[...binding.investigationScope.componentIds],manifest:structuredClone(binding.sourceManifest),registrationArtifactDigest:'d'.repeat(64)}}],
    referencePackageId:'SYNTHETIC_REFERENCE_NOT_PRIVATE',referenceDigest:'9'.repeat(64),measurementPlanDigest:'a'.repeat(64),
    comparisonPlanDigest:'b'.repeat(64),registeredAttempts,calibrationDigest:'c'.repeat(64),
    evaluatorIssuerId:'test-independent-evaluator',calibratorIssuerId:'test-independent-calibrator'}};
  const signed=(payload,key)=>({issuerId:payload.issuerId,payload,signature:sign(null,Buffer.from(canonicalEncode(payload)),key).toString('base64url')});
  const calibration=signed({version:1,kind:'CALIBRATION',issuerId:policy.scope.calibratorIssuerId,
    evidenceClass:'INDEPENDENT_REFERENCE_CALIBRATION',binding:calibrationBinding(policy),observedAt:'2026-01-01T00:00:00Z',
    calibration:{status:'QUALIFIED',contractStatus:'QUALIFIED',supplementStatus:'QUALIFIED',semanticReviewComplete:true,
      preparedWithoutModelOutputs:true,artifactDigest:'d'.repeat(64),referenceDigest:policy.scope.referenceDigest,
      measurementPlanDigest:policy.scope.measurementPlanDigest,
      unitsBySource:{[sourceRevision]:{semanticClaims:25,positiveRelations:37,forbiddenConstraints:12,unknownObligations:5,unknownRelationObligations:3}}}},calibrator.privateKey);
  policy.scope.calibrationDigest=publicationDigest(calibration);
  const config={implementationAuthors:['test-implementation-author'],qualityPolicy:policy,issuers:[
    {id:policy.scope.evaluatorIssuerId,kind:'QUALITY',publicKey:evaluator.publicKey.export({type:'spki',format:'pem'})},
    {id:policy.scope.calibratorIssuerId,kind:'CALIBRATION',publicKey:calibrator.publicKey.export({type:'spki',format:'pem'})}]};
  const metric=(unit,denominator)=>({unit,status:'MEASURED',numerator:denominator,denominator,
    states:{SUPPORTED:denominator,CONTRADICTED:0,PARTIAL:0,UNRESOLVED:0,OMITTED:0}});
  const attempts=registeredAttempts.map(a=>({...a,status:'COMPLETED',equivalent:true,artifactDigest:'e'.repeat(64),
    bindingDigest:publicationDigest(binding),leftBinding:structuredClone(binding),rightBinding:{...structuredClone(binding),
      investigationId:a.kind==='persistenceRecovery'?binding.investigationId:`synthetic-independent-${a.kind}`},
    leftMode:a.kind==='incrementalFull'?'INCREMENTAL_A_TO_B':a.kind==='persistenceRecovery'?'PERSISTED':'REAL_MODEL_REBUILD',
    rightMode:a.kind==='incrementalFull'?'FULL_B':a.kind==='persistenceRecovery'?'RESTORED':'REAL_MODEL_REBUILD',
    ...(a.kind==='incrementalFull'?{baseSourceRevision:'f'.repeat(40),reusedSemanticResultDigest:'0'.repeat(64)}:{})}));
  const quality={version:1,measurementKind:'INDEPENDENT_GRAPH_SEMANTIC_MEASUREMENT',evidenceClass:'REAL_PROJECT',
    contract:graphQualityContract,scopeId:policy.scope.id,sourceRevision,inventoryDigest:sourceInput.inventoryDigest,
    sourceRegistrationDigest:publicationDigest(policy.scope.sources[0]),
    finalImplementation:binding.implementationVersion,calibration,
    technicalVersions:binding.technicalVersions,
    artifacts:{referencePackageId:policy.scope.referencePackageId,referenceDigest:policy.scope.referenceDigest,
      measurementPlanDigest:policy.scope.measurementPlanDigest,comparisonPlanDigest:policy.scope.comparisonPlanDigest,
      classificationLedgerDigest:'a'.repeat(64),measurementLedgerDigest:'b'.repeat(64),attemptLedgerDigest:publicationDigest(attempts),
      runManifestDigest:'c'.repeat(64),originalToCanonicalMappingDigest:'d'.repeat(64),modelInvocationLedgerDigest:'e'.repeat(64)},
    population:{kind:'FULL_SEMANTIC_CENSUS',classificationBeforeScoring:true,scopeResolved:true,allVisibleAssertionsIncluded:true,
      duplicatesAudited:true,retainedCitationsAudited:true,unresolved:0,outputClaims:50,outputRelations:40,unknownUnion:5},
    dimensions:{semanticRecall:metric('SEMANTIC_CLAIM',25),outputClaimPrecision:metric('AFFIRMATIVE_SEMANTIC_CLAIM',50),
      outputRelationPrecision:metric('AFFIRMATIVE_DIRECTED_RELATION',40),requiredRelations:metric('REQUIRED_POSITIVE_DIRECTED_RELATION',37),
      sourceSupportClaims:metric('AFFIRMATIVE_SEMANTIC_CLAIM',50),sourceSupportRelations:metric('AFFIRMATIVE_DIRECTED_RELATION',40),
      unknownHonesty:metric('INDEPENDENT_UNKNOWN_OBLIGATION_OR_DECLARATION',5),inventoryDisposition:metric('F001_INVENTORY_ENTRY',inventorySize),
      modelRebuild:metric('COMPLETED_REAL_MODEL_REBUILD_PAIR',1),persistenceRecovery:metric('COMPLETED_PERSISTENT_RECOVERY_PAIR',1),
      incrementalFull:metric('COMPLETED_A_TO_B_VS_FULL_B_PAIR',1)},
    unknownRelationObligations:3,forbidden:{status:'MEASURED',unit:'APPLICABLE_FORBIDDEN_CONSTRAINT',denominator:12,
      absent:12,violations:0,unresolved:0,criticalViolations:0},attempts};
  const graph={candidates:[{key:'one-node-can-express-many-independent-claims'}],coverage};
  const document=(q=quality,overrides={})=>signed({version:1,kind:'QUALITY',issuerId:policy.scope.evaluatorIssuerId,evidenceClass:'REAL_PROJECT',
    binding,observedAt:'2026-01-01T00:00:00Z',quality:q,...overrides},evaluator.privateKey);
  const authority=()=>new PublicationAuthority(config);
  const assess=(q=quality)=>{const a=authority();return assessGraphQuality(a.verify(document(q),binding),graph,binding,policy,a);};
  return {config,policy,binding,graph,quality,calibration,evaluator,calibrator,signed,document,authority,assess};
}
