import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {largeStorageFixture} from './support/f003-large-storage-fixture.js';
import {isolatedPostgres} from './support/source-truth-postgres.js';
import {owner,reader} from './support/source-truth-database.js';
import {SourceTruthRepository} from '../src/source-truth/repository.js';
import {SourceMaterialRepository} from '../src/source-truth/material-repository.js';
import {SourceCandidateService} from '../src/source-truth/candidate-service.js';
import {SourceAdmissionService} from '../src/source-truth/admission-service.js';
import {InvestigationService} from '../src/business-knowledge/investigation-service.js';
import {F003PublicationService} from '../src/business-knowledge/publication-service.js';
import {resolveF003ImplementationVersion} from '../src/business-knowledge/implementation-version.js';
import {createF003HttpHandler} from '../src/business-knowledge/http-handler.js';
import {queryBusinessGraph,traceBusinessGraph} from '../src/business-knowledge/queries.js';

// Model/F006/identity boundary is an explicit mechanism double. SQL, F001,
// owning service/Worker, HTTP handler and stop/start PG are actual production.
test('F003 native aggregate checkpoint and nonempty directed graph survive fresh offline service and keep publication denied',
  {timeout:120000},async t=>{
    assert.ok(process.env.F001_TEST_PG_BIN,'native path is required, not skipped');
    const pg=await isolatedPostgres(t);let databaseName;
    const implementation=await resolveF003ImplementationVersion();
    const f=await largeStorageFixture(t,{database:async()=>{const db=await pg.createDatabase();databaseName=db.name;return db;},implementationVersion:implementation});
    await f.worker.run(owner,'workspace',f.run.id,{workerId:'native-large'});
    const graph=await f.service.graph(owner,'workspace',f.run.id),history=await f.service.checkpoints(owner,'workspace',f.run.id),events=await f.service.events(owner,'workspace',f.run.id),run=await f.service.get(owner,'workspace',f.run.id);
    assert.ok(Buffer.byteLength(JSON.stringify(graph))>2*1024*1024);assert.equal(graph.candidates.length,160);assert.equal(graph.relations.length,140);
    assert.deepEqual(run.implementationVersion,implementation);assert.equal(run.analysisContractVersion,12);
    const business=queryBusinessGraph(graph,{includeUncertain:true}),forward=traceBusinessGraph(graph,{key:graph.candidates[0].key}),reverse=traceBusinessGraph(graph,{materialId:graph.materials[0].id});
    assert.ok(business.edges.length>0);assert.ok(forward.edges.length>0);assert.equal(reverse.nodes.length,160);
    const physical=(await f.db.query('SELECT payload FROM f003_checkpoint WHERE investigation_id=$1',[f.run.id])).rows;
    assert.ok(physical.every(p=>Buffer.byteLength(JSON.stringify(p.payload))<=2*1024*1024));
    const calls=f.calls.length;await pg.restart();
    const db=pg.pool(databaseName),sources=new SourceTruthRepository(db),materials=new SourceMaterialRepository(sources),
      candidates=new SourceCandidateService(sources,materials,f.blobs),admission=new SourceAdmissionService(sources,candidates);
    const offline={resolveActive:async()=>{throw Error('no model/config for offline read');},assertUsable:async()=>{throw Error('no model/config for offline read');}};
    const service=new InvestigationService({sources,sourceAdmission:admission,profiles:offline,implementationVersion:{status:'UNVERIFIED'}});
    assert.deepEqual(await service.graph(owner,'workspace',run.id),graph);assert.deepEqual(await service.checkpoints(owner,'workspace',run.id),history);
    assert.deepEqual(await service.events(owner,'workspace',run.id),events);assert.deepEqual((await service.evidenceMaterial(owner,'workspace',run.id,graph.materials[0].id)).bytes,f.bytes);
    assert.deepEqual((await service.get(owner,'workspace',run.id)).implementationVersion,implementation);
    assert.equal((await service.start(owner,'workspace',f.input)).id,run.id);
    assert.deepEqual(queryBusinessGraph(await service.graph(owner,'workspace',run.id),{includeUncertain:true}),business);
    assert.deepEqual(traceBusinessGraph(await service.graph(owner,'workspace',run.id),{key:graph.candidates[0].key}),forward);
    assert.deepEqual(traceBusinessGraph(await service.graph(owner,'workspace',run.id),{materialId:graph.materials[0].id}),reverse);
    const publications=new F003PublicationService({sources,sourceReader:admission});
    const handler=createF003HttpHandler({services:{investigations:service,publications},authenticate:req=>req.headers['x-fixture-actor']==='reader'?reader:owner,allowedOrigins:[]});
    const server=createServer(async(req,res)=>{if(!await handler(req,res)){res.writeHead(404);res.end();}});
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));
    const url=`http://127.0.0.1:${server.address().port}/v1/workspaces/workspace/business-knowledge/investigations/${run.id}`;
    const counts=()=>db.query(`SELECT (SELECT count(*) FROM f003_checkpoint)::int checkpoints,(SELECT count(*) FROM f003_investigation_event)::int events,
      (SELECT count(*) FROM f003_publication)::int publications,(SELECT count(*) FROM f003_publication_evidence)::int evidence`).then(r=>r.rows);
    await db.query("UPDATE source_truth_workspace SET backup_barrier=true WHERE workspace_id='workspace'");
    const before=await counts();
    const read=await fetch(url+'/graph?includeUncertain=true');assert.equal(read.status,200);assert.equal((await read.json()).graph.graphDigest,graph.digest);
    const readiness=await fetch(url+'/publication-readiness');assert.equal(readiness.status,200);
    const ready=(await readiness.json()).readiness;assert.equal(ready.binding.graphDigest,graph.digest);assert.equal(ready.binding.implementationVersion.sourceDigest,implementation.sourceDigest);
    assert.equal(ready.status,'BLOCKED');assert.ok(ready.missing.some(m=>m.code==='F003_QUALITY_POLICY_UNCONFIRMED'));
    assert.deepEqual(await counts(),before);
    assert.equal((await fetch(url+'/graph',{headers:{'x-fixture-actor':'reader'}})).status,403);
    await db.query("UPDATE source_truth_workspace SET backup_barrier=false WHERE workspace_id='workspace'");
    const publish=await fetch(url+'/publish',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({operationId:'must-stay-denied',expectedGraphDigest:graph.digest,expectedHeadVersion:0})});
    assert.equal(publish.status,409);assert.equal((await publish.json()).error.code,'F003_PUBLICATION_BLOCKED');
    assert.deepEqual(await counts(),before);assert.equal(f.calls.length,calls);
    console.log(JSON.stringify({kind:'NATIVE_LARGE_CHECKPOINT_OFFLINE_MECHANISM_ONLY',nativeRestart:true,graphBytes:Buffer.byteLength(JSON.stringify(graph)),
      candidates:160,relations:140,originals:300,physicalRows:physical.length,actualImplementation:implementation,readModelCalls:0,realModel:false,realQuality:false}));
  });
