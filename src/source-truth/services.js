import { SourceMaterialRepository } from "./material-repository.js";
import { SourceUploadService } from "./upload-service.js";
import { SourceCandidateService } from "./candidate-service.js";
import { SourceCaptureService } from "./capture-service.js";
import { SourcePublicationService } from "./publication-service.js";
import { SourceAdmissionService } from "./admission-service.js";
import { SourceRenewalService } from "./renewal-service.js";
import { SourceDeltaService } from "./delta-service.js";
import { SourceQueryService } from "./query-service.js";
import { SourceBackupService } from "./backup-service.js";

// Composition only. Deployment validates/provisions authorization, encrypted
// storage, Git targets and a transaction-capable database before calling this.
export function sourceTruthServices({ repository, blobs, policy, git = null, workerId, backup = null, backupConfiguration = null }) {
  const materials = new SourceMaterialRepository(repository, policy);
  const upload = new SourceUploadService(repository, materials, blobs);
  const candidates = new SourceCandidateService(repository, materials, blobs);
  const options = { policyRevisionId: policy.id };
  return { repository, blobs, policy, git, materials, upload, candidates,
    backup: backup ?? (backupConfiguration ? new SourceBackupService({ repository, blobs, configuration: backupConfiguration }) : null),
    capture: new SourceCaptureService({ repository, blobs, policy, git, materials, upload, candidates, workerId }),
    publication: new SourcePublicationService(repository, candidates, options),
    admission: new SourceAdmissionService(repository, candidates), renewal: new SourceRenewalService(repository, candidates, options),
    delta: new SourceDeltaService(repository), queries: new SourceQueryService(repository, materials) };
}
