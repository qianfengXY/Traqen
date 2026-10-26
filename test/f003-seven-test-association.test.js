import test from 'node:test';
import assert from 'node:assert/strict';
import { businessSevenQuestions, traceBusinessGraph } from '../src/business-knowledge/queries.js';
import { associationGraph, syntheticCitation } from './support/f003-seven-association-fixture.js';
import { F003PublishedReadService } from '../src/business-knowledge/published-read-service.js';

test('production CODE check/verify/assert/test words cannot establish a Q5 test relationship', () => {
  for (const predicate of ['CHECKS_ACCESS', 'VERIFIES_PERMISSION', 'ASSERTS_STATE', 'TESTS_FLAG']) {
    const graph = associationGraph({ predicate }), before = structuredClone(graph);
    const answer = businessSevenQuestions(graph, 'selected');
    assert.deepEqual(answer.sections[4].relations, [], predicate);
    assert.deepEqual(answer.sections[4].testAssets, []);
    assert.equal(answer.sections[2].relations[0].predicate, predicate);
    assert.equal(traceBusinessGraph(graph, { key: 'selected' }).edges[0].predicate, predicate);
    assert.equal(answer.sections[4].executionStatus, 'NO_LINKED_EXECUTION_RECORD');
    assert.deepEqual(graph, before);
  }
});

test('a test asset in the same trace supports only its own relationship, never a neighbouring CODE check', () => {
  const graph = associationGraph({ unrelatedTest: true }), before = structuredClone(graph);
  const answer = businessSevenQuestions(graph, 'selected');
  assert.deepEqual(answer.sections[4].testAssets.map(m => m.id), ['test']);
  assert.deepEqual(answer.sections[4].relations.map(r => r.key), ['other-edge']);
  assert.deepEqual(answer.sections[2].relations.map(r => r.key), ['selected-edge', 'other-edge']);
  assert.deepEqual(graph, before);
});

test('direct test evidence, either endpoint evidence and a test material endpoint establish a traceable association', () => {
  for (const options of [{ edgeMaterials: ['test'] }, { sourceMaterials: ['test'] }, { targetMaterials: ['test'] },
    { targetKey: 'test' }, { predicate: 'COVERS', edgeMaterials: ['test'] }]) {
    const graph = associationGraph(options), before = structuredClone(graph);
    const section = businessSevenQuestions(graph, 'selected').sections[4];
    assert.deepEqual(section.relations, [graph.relations[0]], JSON.stringify(options));
    assert.deepEqual(section.testAssets.map(m => m.id), ['test']);
    assert.equal(section.executionStatus, 'NO_LINKED_EXECUTION_RECORD');
    assert.equal('passed' in section, false);
    assert.deepEqual(graph, before);
  }
});

test('missing or legacy test classification never becomes a test from its path or predicate', () => {
  for (const testType of [undefined, 'OTHER', 'CODE', 'test_asset']) {
    const graph = associationGraph({ edgeMaterials: ['test'], testType: testType ?? 'OTHER' });
    if (testType === undefined) delete graph.materials.find(m => m.id === 'test').assetType;
    const before = structuredClone(graph), section = businessSevenQuestions(graph, 'selected').sections[4];
    assert.deepEqual(section.relations, []);
    assert.deepEqual(section.testAssets, []);
    assert.deepEqual(graph, before);
  }
});

test('no evidence and unknown material references do not borrow an unrelated known test asset', () => {
  for (const evidence of [[], [syntheticCitation('not-a-known-test')]]) {
    const graph = associationGraph();
    for (const item of [...graph.candidates, ...graph.relations]) item.evidence = structuredClone(evidence);
    const before = structuredClone(graph), section = businessSevenQuestions(graph, 'selected').sections[4];
    assert.deepEqual(section.relations, []);
    assert.deepEqual(section.testAssets, []);
    assert.deepEqual(graph, before);
  }
});

test('association is a derived group and preserves UNKNOWN, quarantine, verification and graph identity', () => {
  const graph = associationGraph({ edgeMaterials: ['test'] });
  for (const state of ['RETAINED_UNKNOWN', 'NEEDS_EVIDENCE', 'QUARANTINED', 'HUMAN_REVIEW']) {
    graph.relations[0].state = state;
    const before = structuredClone(graph), answer = businessSevenQuestions(graph, 'selected');
    assert.equal(answer.sections[4].relations[0].state, state);
    assert.equal(answer.graphDigest, graph.digest);
    assert.deepEqual(answer.sections[4].relations[0].verification, graph.relations[0].verification);
    assert.deepEqual(graph, before);
    answer.sections[4].relations[0].evidence[0].quote = 'Caller changed its clone';
    assert.deepEqual(graph, before);
  }
});

test('actual published node derivation matches private classification while explicit relation execution stays independent', async () => {
  for (const options of [{}, { unrelatedTest: true }, { edgeMaterials: ['test'], predicate: 'CHECKS_RULE' }]) {
    const graph = associationGraph(options), before = structuredClone(graph);
    const version = { graph, publication: { graphRevisionId: 'revision', binding: { profileId: graph.profileId,
      sourceInput: { sourceBundleSnapshotId: graph.sourceBundleId, receiptId: 'receipt' }, adoptedVersionIds: [] } } };
    // Only external storage/source/mapping ports are synthetic. Exercise the
    // real published service's node and relation branches, not a copy of them.
    const service = new F003PublishedReadService({ sources: {}, admission: { candidates: {} },
      publications: { withPublishedVersion: (_a, _w, _r, _maintain, read) => read({}, version) },
      authorityBindings: { projectManyInVersion: async (_tx, _w, _r, _v, keys) => Object.fromEntries(keys.map(key => [key,
        { currentBindingVersion: 1, projection: { evaluatedAt: 'synthetic-time', targets: key === 'selected-edge' ? [{
          claimId: 'claim', claimVersion: 1, scopeId: 'scope', scopeVersion: 1,
          authority: { applies: false, status: 'UNCONFIRMED', scopeActive: true, versionCurrent: true },
          verification: [{ status: 'FAIL', testSpecId: 'explicit-test', testSpecVersion: 1,
            snapshotManifestId: 'snapshot', deploymentId: 'environment', history: [{ id: 'trusted-failure', status: 'FAIL', trusted: true }] }]
        }] : [] } }])) } });
    service.reader.records = async () => ({ bundle: { payload: { components: [{ id: 'component' }] } } });
    const original = businessSevenQuestions(graph, 'selected');
    const published = await service.sevenQuestions({}, 'w', 'revision', 'selected');
    assert.deepEqual(published.sections[4].relations, original.sections[4].relations);
    assert.deepEqual(published.sections[4].testAssets, original.sections[4].testAssets);
    assert.equal(published.sections[4].executionStatus, 'NOT_RUN', 'neighbour execution is not selected-node execution');
    const relation = await service.sevenQuestions({}, 'w', 'revision', 'selected-edge');
    assert.equal(relation.sections[4].question, '独立真实执行');
    assert.equal(relation.sections[4].executionStatus, 'FAIL');
    assert.equal(relation.sections[4].executionTargets[0].history[0].id, 'trusted-failure');
    assert.equal(relation.currentProjection.edges[0].predicate, graph.relations[0].predicate);
    assert.deepEqual(graph, before);
  }
});
