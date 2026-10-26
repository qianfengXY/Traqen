import assert from 'node:assert/strict';
import test from 'node:test';
import {PublicationAuthority,publicationDigest,loadPublicationAuthority} from '../src/business-knowledge/publication-authority.js';
import {F003PublicationService} from '../src/business-knowledge/publication-service.js';
import {assessGraphQuality,calibrationBinding} from '../src/business-knowledge/quality-contract-adapter.js';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {qualityContractFixture} from './support/f003-quality-contract-fixture.js';

// Synthetic metadata only. No real semantic measurement, signing authority,
// hidden reference, model invocation or accepted production policy.

test('F003 trusted deployment may explicitly select the allowlisted graph-native contract; absence remains deny by default',()=>{
  assert.equal(new PublicationAuthority().qualityPolicy??null,null);
  const f=qualityContractFixture(),configured=f.authority();
  assert.equal(configured.qualityPolicy?.adapterId,f.policy.adapterId,
    'runtime needs a server-selected graph-native adapter, not permanent null or a signed report choosing its own policy');
});

test('F003 signed population and preregistered attempts cannot shrink, change mode or lose exact run bindings',()=>{
  for(const [label,mutate] of [
    ['population does not match denominators',q=>{q.population.outputClaims++;}],
    ['classification after scoring',q=>{q.population.classificationBeforeScoring=false;}],
    ['unresolved scope',q=>{q.population.scopeResolved=false;}],
    ['failed attempt cannot disappear',q=>{q.attempts[0].status='FAILED';}],
    ['wrong attempt binding',q=>{q.attempts[0].bindingDigest='0'.repeat(64);}],
    ['wrong comparison source',q=>{q.attempts[0].leftBinding.sourceInput.receiptId='different-receipt';}],
    ['wrong comparison model',q=>{q.attempts[0].rightBinding.modelRevisionIds=['different-model'];}],
    ['two full B runs are not incremental',q=>{q.attempts[2].leftMode='FULL_B';}],
    ['missing semantic reuse',q=>{delete q.attempts[2].reusedSemanticResultDigest;}],
    ['one run cannot be its own model rebuild',q=>{q.attempts[0].rightBinding=structuredClone(q.attempts[0].leftBinding);}],
    ['one run cannot be both incremental and full',q=>{q.attempts[2].rightBinding=structuredClone(q.attempts[2].leftBinding);}],
    ['different comparison plan',q=>{q.artifacts.comparisonPlanDigest='0'.repeat(64);}],
  ]) {
    const f=qualityContractFixture(),q=structuredClone(f.quality);mutate(q);
    q.artifacts.attemptLedgerDigest=publicationDigest(q.attempts);
    assert.ok(f.assess(q).length,label);
  }
  const f=qualityContractFixture();
  f.policy.scope.registeredAttempts.push({id:'preregistered-but-omitted',kind:'modelRebuild',conditionsDigest:f.binding.runContractDigest});
  assert.ok(f.assess().length,'report must account for every deployment-registered attempt');
});

test('F003 independently signed calibration must qualify both contract and supplement with complete semantic review',()=>{
  for(const override of [{contractStatus:'PENDING'},{supplementStatus:'UNRESOLVED'},
    {semanticReviewComplete:false},{preparedWithoutModelOutputs:false}]) {
    const f=qualityContractFixture(),q=structuredClone(f.quality);
    q.calibration=f.signed({...f.calibration.payload,calibration:{...f.calibration.payload.calibration,...override}},f.calibrator.privateKey);
    f.policy.scope.calibrationDigest=publicationDigest(q.calibration);
    assert.ok(f.assess(q).some(e=>e.code==='F003_QUALITY_CALIBRATION_INVALID'));
  }
});

test('F003 a trusted preregistered manual source retains DIRECTORY_UPLOAD rather than requiring a fabricated Git identity',()=>{
  const f=qualityContractFixture();
  assert.equal(f.binding.sourceInput.components[0].kind,'DIRECTORY_UPLOAD');
  assert.deepEqual(f.assess(),[]);
});

test('F003 source preregistration fixes actual scope, manifest and every file digest; an unrelated Git component cannot qualify an upload',()=>{
  assert.deepEqual(qualityContractFixture({sourceKind:'GIT'}).assess(),[],'native Git is supported without changing manual identities');
  for(const mutate of [
    f=>{const c=f.policy.scope.sources[0].sourceProof.manifest.components[0];c.manifestId='0'.repeat(64);c.nativeIdentity.manifestDigest=c.manifestId;},
    f=>{f.policy.scope.sources[0].sourceProof.manifest.entriesDigest='0'.repeat(64);},
    f=>{f.policy.scope.sources[0].sourceProof.manifest.entryCount++;},
    f=>{f.quality.sourceRevision='0'.repeat(40);},
    f=>{f.binding.investigationScope={componentIds:['0'.repeat(64)]};},
    f=>{f.binding.sourceInput.components[0].nativeIdentity={manifestDigest:'0'.repeat(64)};},
    f=>{f.binding.sourceManifest=null;},
  ]) {
    const f=qualityContractFixture();mutate(f);
    f.quality.sourceRegistrationDigest=publicationDigest(f.policy.scope.sources[0]);
    assert.ok(f.assess().some(r=>r.code==='F003_QUALITY_SOURCE_QUALIFICATION_INVALID'));
  }
  const f=qualityContractFixture(),git={componentSnapshotId:'0'.repeat(64),kind:'GIT',manifestId:'a'.repeat(64),
    nativeIdentity:{objectFormat:'sha1',resolvedCommit:f.quality.sourceRevision}};
  f.binding.sourceInput.components.push(git);
  for(const a of f.quality.attempts) {
    a.leftBinding=structuredClone(f.binding);a.rightBinding={...structuredClone(f.binding),investigationId:a.rightBinding.investigationId};
    a.bindingDigest=publicationDigest(f.binding);
  }
  f.quality.artifacts.attemptLedgerDigest=publicationDigest(f.quality.attempts);
  assert.deepEqual(f.assess(),[],'unselected bundle metadata cannot change the correctly registered upload scope');
  f.policy.scope.sources[0].sourceProof.manifest.entriesDigest='0'.repeat(64);
  f.quality.sourceRegistrationDigest=publicationDigest(f.policy.scope.sources[0]);
  assert.ok(f.assess().some(r=>r.code==='F003_QUALITY_SOURCE_QUALIFICATION_INVALID'),'out-of-scope Git does not rescue a wrong manual file map');
  for(const mutate of [p=>{delete p.sourceProof;},p=>{delete p.sourceProof.registrationArtifactDigest;},
    p=>{p.sourceProof.componentIds=['0'.repeat(64)];}]) {
    const f=qualityContractFixture();mutate(f.policy.scope.sources[0]);
    assert.throws(()=>f.authority(),{code:'F003_QUALITY_POLICY_INVALID'},'missing or malformed trusted source proof cannot be supplied by a report');
  }
});

test('F003 exact integer thresholds reject a rounded-up near miss and never award partial or unresolved credit',()=>{
  const f=qualityContractFixture(),q=structuredClone(f.quality),denominator=Number.MAX_SAFE_INTEGER;
  q.population.outputClaims=denominator;
  const bad=Number(BigInt(denominator)*9n/10n);
  for(const n of [bad,bad+1]) {
    q.dimensions.outputClaimPrecision={...q.dimensions.outputClaimPrecision,numerator:n,denominator,
      states:{SUPPORTED:n,CONTRADICTED:denominator-n,PARTIAL:0,UNRESOLVED:0,OMITTED:0}};
    q.dimensions.sourceSupportClaims={...q.dimensions.sourceSupportClaims,numerator:denominator,denominator,
      states:{SUPPORTED:denominator,CONTRADICTED:0,PARTIAL:0,UNRESOLVED:0,OMITTED:0}};
    const reasons=f.assess(q);
    assert.equal(reasons.some(e=>e.dimension==='outputClaimPrecision' && e.code==='F003_QUALITY_THRESHOLD'),n===bad);
    if(n!==bad)assert.deepEqual(reasons,[]);
  }
});

test('F003 private deployment configuration reaches publication policy; no deployment selection stays blocked',async t=>{
  const f=qualityContractFixture(),directory=await mkdtemp(join(tmpdir(),'traqen-quality-config-mechanism-'));
  t.after(()=>rm(directory,{recursive:true,force:true}));
  const filename=join(directory,'authority.json');
  await writeFile(filename,JSON.stringify({version:1,...f.config}),{mode:0o600});
  const loaded=await loadPublicationAuthority(filename);
  assert.equal(loaded.qualityPolicy.adapterId,f.policy.adapterId);
  assert.equal(new F003PublicationService({sources:{},authority:loaded}).qualityPolicy?.adapterId,f.policy.adapterId);
  assert.equal(new F003PublicationService({sources:{}}).qualityPolicy,null);
});

test('F003 inventory disposition denominator is fixed by actual F001 entries, not a shorter graph coverage projection',()=>{
  const f=qualityContractFixture(),q=structuredClone(f.quality);f.graph.coverage.pop();
  const m=q.dimensions.inventoryDisposition;m.numerator--;m.denominator--;m.states.SUPPORTED--;
  assert.ok(f.assess(q).some(r=>r.code==='F003_QUALITY_DENOMINATOR'));
  const complete=qualityContractFixture();assert.deepEqual(complete.assess(),[]);
  complete.graph.coverage.push({materialId:'invented-extra'});
  assert.ok(complete.assess().some(r=>r.code==='F003_QUALITY_SOURCE_QUALIFICATION_INVALID'));
});

test('F003 duplicate or wrong-scope inventory entries cannot replace missing entries at the same count',()=>{
  for(const mutate of [
    rows=>{rows[0]=structuredClone(rows[1]);},rows=>{rows[0].componentId='0'.repeat(64);},
    rows=>{rows[0].pathBytes=Buffer.from('not-in-scope.txt').toString('base64url');},
    rows=>{rows[0].materialId='0'.repeat(64);},rows=>{rows[0].reasonCode='fabricated-disposition';},
  ]) {
    const f=qualityContractFixture();mutate(f.graph.coverage);
    assert.ok(f.assess().some(r=>r.code==='F003_QUALITY_SOURCE_QUALIFICATION_INVALID'));
  }
  const f=qualityContractFixture();f.graph.coverage.reverse();
  assert.deepEqual(f.assess(),[],'array display order is not an added semantic identity requirement');
});

test('F003 signed but incomplete comparison bindings remain typed denials rather than throwing past later quality reports',()=>{
  const f=qualityContractFixture(),q=structuredClone(f.quality);
  delete q.attempts[0].leftBinding.sourceInput.receiptId;
  assert.ok(f.assess(q).some(r=>r.code==='F003_QUALITY_COMPARISON_BINDING_MISMATCH'));
});

test('F003 selection requires independently configured signer purposes and keys, never a bare policy or aliases of one signer',()=>{
  const f=qualityContractFixture();
  assert.throws(()=>new PublicationAuthority({qualityPolicy:f.policy}),{code:'F003_AUTHORITY_INVALID'});
  assert.equal(f.authority().qualityPolicy.scope.id,f.policy.scope.id);
  const wrong=structuredClone(f.config);wrong.issuers[1].publicKey=wrong.issuers[0].publicKey;
  assert.throws(()=>new PublicationAuthority(wrong),{code:'F003_AUTHORITY_INVALID'});
});

test('F003 graph-native counts support semantic units, not graph node denominators, and require every calibrated dimension',()=>{
  const f=qualityContractFixture();
  assert.deepEqual(f.assess(),[],'one node does not limit a calibrated 25-claim/37-positive-relation reference');
  for(const [label,mutate] of [
    ['wrong units',q=>{q.dimensions.semanticRecall.unit='GRAPH_NODE';}],
    ['zero denominator',q=>{q.dimensions.outputClaimPrecision.denominator=0;}],
    ['missing dimension',q=>{delete q.dimensions.incrementalFull;}],
    ['unmeasured',q=>{q.dimensions.modelRebuild.status='UNMEASURED';}],
    ['unresolved',q=>{q.dimensions.semanticRecall.states.SUPPORTED--;q.dimensions.semanticRecall.numerator--;q.dimensions.semanticRecall.states.UNRESOLVED++;}],
    ['unknown R inflation',q=>{q.dimensions.requiredRelations.denominator+=3;q.dimensions.requiredRelations.numerator+=3;q.dimensions.requiredRelations.states.SUPPORTED+=3;}],
    ['wrong source',q=>{q.sourceRevision='0'.repeat(40);}],
    ['wrong implementation',q=>{q.finalImplementation={...q.finalImplementation,commitSha:'0'.repeat(40)};}],
    ['missing implementation',q=>{delete q.finalImplementation;}],
    ['policy self-selection',q=>{q.contract={...q.contract,contractHash:'0'.repeat(64)};}],
    ['self-selected threshold',q=>{q.contract={...q.contract,threshold:0};}],
    ['wrong report version',q=>{q.version=2;}],
    ['legacy measurement is not semantic graph measurement',q=>{q.measurementKind='INDEPENDENT_REVIEW';}],
    ['missing calibration',q=>{delete q.calibration;}],
    ['missing artifact',q=>{delete q.artifacts.modelInvocationLedgerDigest;}],
    ['wrong adopted technical profile',q=>{q.technicalVersions=[{...q.technicalVersions[0],profileId:'0'.repeat(64)}];}],
    ['omitted adopted technical context',q=>{q.technicalVersions=[];}],
    ['shrunk support population',q=>{q.dimensions.sourceSupportRelations.denominator--;q.dimensions.sourceSupportRelations.numerator--;q.dimensions.sourceSupportRelations.states.SUPPORTED--;}],
    ['forbidden unresolved',q=>{q.forbidden.absent--;q.forbidden.unresolved++;}],
    ['forbidden critical',q=>{q.forbidden.criticalViolations=1;}],
  ]) {
    const q=structuredClone(f.quality);mutate(q);
    assert.ok(f.assess(q).length,label);
  }
});

test('F003 independent calibration identity, purpose, signature, expiry and logical source binding cannot be self-certified',()=>{
  for(const change of [
    p=>({...p,version:2}),p=>({...p,kind:'QUALITY'}),p=>({...p,issuerId:'unknown-calibrator'}),
    p=>({...p,validUntil:'2000-01-01T00:00:00Z'}),p=>({...p,binding:{...p.binding,scope:{...p.binding.scope,id:'another-scope'}}}),
  ]) {
    const f=qualityContractFixture(),q=structuredClone(f.quality);
    q.calibration=f.signed(change(f.calibration.payload),f.calibrator.privateKey);
    f.policy.scope.calibrationDigest=publicationDigest(q.calibration);
    assert.ok(f.assess(q).some(e=>e.code==='F003_QUALITY_CALIBRATION_INVALID'));
  }
  const f=qualityContractFixture(),q=structuredClone(f.quality);
  q.calibration=f.signed(f.calibration.payload,f.evaluator.privateKey);f.policy.scope.calibrationDigest=publicationDigest(q.calibration);
  assert.ok(f.assess(q).some(e=>e.code==='F003_QUALITY_CALIBRATION_INVALID'));
  assert.throws(()=>new PublicationAuthority({...f.config,implementationAuthors:[f.policy.scope.calibratorIssuerId]}),{code:'F003_AUTHORITY_INVALID'});
  assert.throws(()=>f.authority().verify(f.calibration,calibrationBinding(f.policy)),{code:'F003_EVIDENCE_UNTRUSTED'},'calibration cannot be imported as publication quality/recovery');
});

test('F003 graph measurement rechecks signed exact run/source/profile/model/version identity rather than wrapper claims',()=>{
  const f=qualityContractFixture(),a=f.authority();
  for(const binding of [
    {...f.binding,workspaceId:'another-workspace'}, {...f.binding,investigationId:'another-run'},
    {...f.binding,graphDigest:'0'.repeat(64)}, {...f.binding,sourceInput:{...f.binding.sourceInput,receiptId:'other-receipt'}},
    {...f.binding,adoptedVersionIds:[]}, {...f.binding,profileId:'other-profile'}, {...f.binding,modelRevisionIds:['other-model']},
  ]) {
    const document=f.document(f.quality,{binding});
    assert.ok(assessGraphQuality({issuerId:f.policy.scope.evaluatorIssuerId,document},f.graph,f.binding,f.policy,a)
      .some(e=>e.code==='F003_QUALITY_REPORT_UNTRUSTED'));
  }
});
