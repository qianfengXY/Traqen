export class TraceabilityStore {
  async appendProjectFoundation(_foundation) {
    throw new Error("appendProjectFoundation must be implemented");
  }

  async getProjectFoundation(_projectId) {
    throw new Error("getProjectFoundation must be implemented");
  }

  async listProjectFoundations() {
    throw new Error("listProjectFoundations must be implemented");
  }

  async appendCapabilityTemplateRevision(_template) {
    throw new Error("appendCapabilityTemplateRevision must be implemented");
  }

  async listCapabilityTemplateRevisions() {
    throw new Error("listCapabilityTemplateRevisions must be implemented");
  }

  async appendSnapshotManifest(_projectId, _manifest) {
    throw new Error("appendSnapshotManifest must be implemented");
  }

  async getSnapshotManifest(_projectId, _snapshotManifestId) {
    throw new Error("getSnapshotManifest must be implemented");
  }

  async listSnapshotManifests(_projectId) {
    throw new Error("listSnapshotManifests must be implemented");
  }

  async getPlatformOperationObservations(_projectId) {
    throw new Error("getPlatformOperationObservations must be implemented");
  }

  async appendTraceChainRevision(_projectId, _chain, _options = {}) {
    throw new Error("appendTraceChainRevision must be implemented");
  }

  async getCurrentTraceChain(_projectId, _chainId) {
    throw new Error("getCurrentTraceChain must be implemented");
  }

  async listCurrentTraceChains(_projectId) {
    throw new Error("listCurrentTraceChains must be implemented");
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

  async appendFeatureAlias(_projectId, _alias) {
    throw new Error("appendFeatureAlias must be implemented");
  }

  async listFeatureAliases(_projectId, _featureId) {
    throw new Error("listFeatureAliases must be implemented");
  }

  async appendFeatureLineage(_projectId, _lineage) {
    throw new Error("appendFeatureLineage must be implemented");
  }

  async listFeatureLineages(_projectId, _featureId = null) {
    throw new Error("listFeatureLineages must be implemented");
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

  async getEvidence(_projectId, _evidenceId) {
    throw new Error("getEvidence must be implemented");
  }

  async appendEvidenceRetentionPolicy(_projectId, _policy) {
    throw new Error("appendEvidenceRetentionPolicy must be implemented");
  }

  async getEvidenceRetentionPolicy(_projectId, _policyId, _version = null) {
    throw new Error("getEvidenceRetentionPolicy must be implemented");
  }

  async appendEvidenceLifecycleEvent(_projectId, _event) {
    throw new Error("appendEvidenceLifecycleEvent must be implemented");
  }

  async listEvidenceLifecycleEvents(_projectId, _evidenceId) {
    throw new Error("listEvidenceLifecycleEvents must be implemented");
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

  async appendReverseRunJob(_projectId, _job, _event) {
    throw new Error("appendReverseRunJob must be implemented");
  }

  async appendReverseRunJobEvent(_projectId, _event) {
    throw new Error("appendReverseRunJobEvent must be implemented");
  }

  async getReverseRunJob(_projectId, _jobId) {
    throw new Error("getReverseRunJob must be implemented");
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

  async saveAnalysisCheckpoint(_projectId, _checkpoint) {
    throw new Error("saveAnalysisCheckpoint must be implemented");
  }

  async getAnalysisCheckpoint(_projectId, _runId) {
    throw new Error("getAnalysisCheckpoint must be implemented");
  }

  async appendAnalysisResult(_projectId, _result) {
    throw new Error("appendAnalysisResult must be implemented");
  }

  async getAnalysisResult(_projectId, _runId) {
    throw new Error("getAnalysisResult must be implemented");
  }

  async listAnalysisResults(_projectId) {
    throw new Error("listAnalysisResults must be implemented");
  }

  async getLatestAnalysisResult(_projectId) {
    throw new Error("getLatestAnalysisResult must be implemented");
  }

  async appendUnderstandingRecord(_projectId, _recordType, _record) {
    throw new Error("appendUnderstandingRecord must be implemented");
  }

  async appendUnderstandingRecordWithCas(_projectId, _recordType, _record, _options) {
    throw new Error("appendUnderstandingRecordWithCas must be implemented");
  }

  async getUnderstandingHead(_projectId, _headKey) {
    throw new Error("getUnderstandingHead must be implemented");
  }

  async appendWorkspaceCapabilityBundle(_projectId, _bundle) {
    throw new Error("appendWorkspaceCapabilityBundle must be implemented");
  }

  async applyWorkspaceModelReplacement(_changes) {
    throw new Error("applyWorkspaceModelReplacement must be implemented");
  }

  async ensureGlobalModelLifecycle(_profileId) {
    throw new Error("ensureGlobalModelLifecycle must be implemented");
  }

  async getGlobalModelLifecycle(_profileId) {
    throw new Error("getGlobalModelLifecycle must be implemented");
  }

  async setGlobalModelLifecycle(_profileId, _lifecycle) {
    throw new Error("setGlobalModelLifecycle must be implemented");
  }

  async getGlobalModelProfileRevision(_profileId) {
    throw new Error("getGlobalModelProfileRevision must be implemented");
  }

  async ensureGlobalModelProfileRevision(_profile) {
    throw new Error("ensureGlobalModelProfileRevision must be implemented");
  }

  async listGlobalModelProfileRevisions() {
    throw new Error("listGlobalModelProfileRevisions must be implemented");
  }

  async mutateGlobalModelProfile(_profileId, _expectedRevision, _operation) {
    throw new Error("mutateGlobalModelProfile must be implemented");
  }

  async createModelReplacementPlan(_plan) {
    throw new Error("createModelReplacementPlan must be implemented");
  }

  async getModelReplacementPlan(_planId) {
    throw new Error("getModelReplacementPlan must be implemented");
  }

  async applyModelReplacementPlan(_planId, _expectedVersion) {
    throw new Error("applyModelReplacementPlan must be implemented");
  }

  async recordModelReplacementFailureDiagnostic(_diagnostic) {
    throw new Error("recordModelReplacementFailureDiagnostic must be implemented");
  }

  async listModelReplacementFailureDiagnostics(_planId) {
    throw new Error("listModelReplacementFailureDiagnostics must be implemented");
  }

  async appendWorkspaceAnalysisJobCheckpoint(projectId, checkpoint) {
    return this.appendUnderstandingRecord(projectId, "WORKSPACE_ANALYSIS_JOB", checkpoint);
  }

  async getUnderstandingRecord(_projectId, _recordType, _recordId) {
    throw new Error("getUnderstandingRecord must be implemented");
  }

  async listUnderstandingRecords(_projectId, _recordType) {
    throw new Error("listUnderstandingRecords must be implemented");
  }

  async consumeSourceSliceWorkerCredential(_projectId, _consumption) {
    throw new Error("consumeSourceSliceWorkerCredential must be implemented");
  }

  async getCurrentGraphHead(_projectId) {
    throw new Error("getCurrentGraphHead must be implemented");
  }

  async publishGraphRevision(_projectId, _revisionId, _expectedHeadVersion = 0) {
    throw new Error("publishGraphRevision must be implemented");
  }

  async publishHistoricalGraphRevision(_projectId, _revisionId, _sourceRevisionId) {
    throw new Error("publishHistoricalGraphRevision must be implemented");
  }
}
