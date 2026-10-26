import { buildBusinessGraph } from '../../src/business-knowledge/semantic-graph.js';
import { createHash } from 'node:crypto';

export const syntheticCitation = materialId => ({ materialId, startLine: 1, endLine: 1, quote: 'Synthetic source only' });
export function associationGraph({ predicate = 'CHECKS_ACCESS', edgeMaterials = ['code'], sourceMaterials = ['code'],
  targetMaterials = ['code'], targetKey = 'rule', unrelatedTest = false, testType = 'TEST_ASSET' } = {}) {
  const materials = [['code', 'CODE'], ['test', testType]].map(([id, assetType]) => ({ id, assetType,
    text: 'Synthetic source only', sourceMaterial: { id, workspaceId: 'w', bundleId: 'b', componentId: 'component',
      contentDigest: createHash('sha256').update('Synthetic source only').digest('hex'), pathBytes: Buffer.from(id+'.txt').toString('base64') } }));
  const node = (key, ids) => ({ key, kind: 'RULE', name: key, statement: 'Synthetic local proposition', scope: 'Synthetic only',
    uncertainties: [], evidence: ids.map(syntheticCitation) });
  const candidates = [node('selected', sourceMaterials), node('rule', targetMaterials)];
  const relations = [{ key: 'selected-edge', sourceKey: 'selected', targetKey, predicate, scope: 'Synthetic local condition',
    evidence: edgeMaterials.map(syntheticCitation) }];
  if (unrelatedTest) {
    candidates.push(node('other-test', ['test']));
    relations.push({ key: 'other-edge', sourceKey: 'selected', targetKey: 'other-test', predicate: 'CHECKS_OTHER_RULE',
      scope: 'Different synthetic relationship', evidence: [syntheticCitation('test')] });
  }
  return buildBusinessGraph({ workspaceId: 'w', investigationId: 'synthetic-run', sourceBundleId: 'b', profileId: 'p',
    materials, inventory: materials.map(m => ({ key: m.id, kind: 'FILE', path: m.id+'.txt', materialId: m.id, disposition: 'VERIFIED' })),
    candidates, relations, reviews: [...candidates, ...relations].map(({ key }) => ({ key, support: 'SUPPORTED',
      rationale: 'Synthetic mechanism only', premises: ['Synthetic only'], unresolvedConflicts: [] })),
    allowedFactIds: [], adoptedVersionIds: [] });
}
