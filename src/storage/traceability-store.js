export class TraceabilityStore {
  async appendProjectFoundation(_foundation) {
    throw new Error("appendProjectFoundation must be implemented");
  }

  async getProjectFoundation(_projectId) {
    throw new Error("getProjectFoundation must be implemented");
  }

  async appendSnapshotManifest(_projectId, _manifest) {
    throw new Error("appendSnapshotManifest must be implemented");
  }

  async getSnapshotManifest(_projectId, _snapshotManifestId) {
    throw new Error("getSnapshotManifest must be implemented");
  }

  async appendTraceChainRevision(_projectId, _chain, _options = {}) {
    throw new Error("appendTraceChainRevision must be implemented");
  }

  async getCurrentTraceChain(_projectId, _chainId) {
    throw new Error("getCurrentTraceChain must be implemented");
  }

  async appendFeatureVersion(_projectId, _feature) {
    throw new Error("appendFeatureVersion must be implemented");
  }

  async appendClaimScope(_projectId, _scope) {
    throw new Error("appendClaimScope must be implemented");
  }

  async appendClaim(_projectId, _claim) {
    throw new Error("appendClaim must be implemented");
  }

  async appendDecision(_projectId, _decision) {
    throw new Error("appendDecision must be implemented");
  }

  async appendBusinessProcessModel(_projectId, _processModel) {
    throw new Error("appendBusinessProcessModel must be implemented");
  }

  async getLatestBusinessProcessModel(_projectId, _featureId) {
    throw new Error("getLatestBusinessProcessModel must be implemented");
  }

  async appendDecisionReviewCase(_projectId, _reviewCase) {
    throw new Error("appendDecisionReviewCase must be implemented");
  }

  async getDecisionReviewCase(_projectId, _caseId) {
    throw new Error("getDecisionReviewCase must be implemented");
  }

  async appendDecisionReviewEvent(_projectId, _reviewPackage) {
    throw new Error("appendDecisionReviewEvent must be implemented");
  }

  async getFeatureBaseline(_projectId, _featureId) {
    throw new Error("getFeatureBaseline must be implemented");
  }

  async listFeatureIds(_projectId) {
    throw new Error("listFeatureIds must be implemented");
  }

  async appendTestSpec(_projectId, _testSpec) {
    throw new Error("appendTestSpec must be implemented");
  }

  async getTestSpec(_projectId, _testSpecId, _version = null) {
    throw new Error("getTestSpec must be implemented");
  }

  async appendExecutionEvidenceBundle(_projectId, _bundle) {
    throw new Error("appendExecutionEvidenceBundle must be implemented");
  }

  async getExecutionEvidence(_projectId, _executionId) {
    throw new Error("getExecutionEvidence must be implemented");
  }

  async appendFactBundle(_projectId, _bundle) {
    throw new Error("appendFactBundle must be implemented");
  }

  async queryFacts(_projectId, _filters = {}) {
    throw new Error("queryFacts must be implemented");
  }

  async getFactBundles(_projectId, _bundleIds) {
    throw new Error("getFactBundles must be implemented");
  }

  async getFactGraphByReferences(_projectId, _snapshotManifestId, _factRefs) {
    throw new Error("getFactGraphByReferences must be implemented");
  }

  async getSnapshotFactGraph(_projectId, _snapshotManifestId, _maxNodes = 100000) {
    throw new Error("getSnapshotFactGraph must be implemented");
  }

  async listImplementationMappings(_projectId) {
    throw new Error("listImplementationMappings must be implemented");
  }

  async appendImplementationAnalysis(_projectId, _analysisPackage) {
    throw new Error("appendImplementationAnalysis must be implemented");
  }

  async appendReverseSkillRegistration(_registration) {
    throw new Error("appendReverseSkillRegistration must be implemented");
  }

  async listReverseSkills() {
    throw new Error("listReverseSkills must be implemented");
  }

  async getReverseSkillRegistration(_skillId, _version = null) {
    throw new Error("getReverseSkillRegistration must be implemented");
  }

  async appendReverseRun(_projectId, _run) {
    throw new Error("appendReverseRun must be implemented");
  }

  async getReverseRun(_projectId, _runId) {
    throw new Error("getReverseRun must be implemented");
  }

  async appendReverseCandidateReview(_projectId, _reviewPackage) {
    throw new Error("appendReverseCandidateReview must be implemented");
  }

  async getReverseCandidateReview(_projectId, _runId, _candidateId) {
    throw new Error("getReverseCandidateReview must be implemented");
  }

  async listReverseCandidateReviews(_projectId, _runId) {
    throw new Error("listReverseCandidateReviews must be implemented");
  }

  async appendChangeImpact(_projectId, _changeImpact) {
    throw new Error("appendChangeImpact must be implemented");
  }

  async getChangeImpact(_projectId, _changeSetId) {
    throw new Error("getChangeImpact must be implemented");
  }
}
