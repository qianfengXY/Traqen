import { Button } from "../ui/button";
import type { AnalysisModelProfile } from "../../analysis-model-client";

type AnalysisModelStatus = "IDLE" | "CHECKING" | "READY" | "ERROR";

export interface AnalysisModelPanelLabels {
  panelAriaLabel: string;
  eyebrow: string;
  title: string;
  description: string;
  statusLabel: (status: AnalysisModelStatus) => string;
  addModel: string;
  savedModelsAriaLabel: string;
  noProfiles: string;
  activeState: string;
  verifiedState: string;
  verifyState: string;
  use: string;
  edit: string;
  delete: string;
  environmentDeleteTitle: string;
  profileIdLabel: string;
  modelLabel: string;
  modelPlaceholder: string;
  endpointLabel: string;
  endpointPlaceholder: string;
  endpointHint: string;
  apiKeyLabel: string;
  apiKeyPlaceholderEnvironment: string;
  apiKeyPlaceholderExisting: string;
  apiKeyPlaceholderNew: string;
  streamLabel: string;
  streamHint: string;
  verifying: string;
  saveChangesAndVerify: string;
  saveAndVerify: string;
  refreshServerStatus: string;
}

export interface AnalysisModelPanelProps {
  labels: AnalysisModelPanelLabels;
  analysisModelProfiles: AnalysisModelProfile[];
  analysisModelProfileId: string;
  analysisModelName: string;
  analysisModelEndpoint: string;
  analysisModelApiKey: string;
  analysisModelStream: boolean;
  analysisModelStatus: AnalysisModelStatus;
  analysisModelMessage: string;
  editedAnalysisModelProfile: AnalysisModelProfile | null;
  canReuseAnalysisModelCredential: boolean;
  onProfileIdChange: (value: string) => void;
  onNameChange: (value: string) => void;
  onEndpointChange: (value: string) => void;
  onApiKeyChange: (value: string) => void;
  onStreamChange: (value: boolean) => void;
  onConnect: () => void;
  onRefresh: () => void;
  onNew: () => void;
  onEdit: (profile: AnalysisModelProfile) => void;
  onChoose: (profileId: string) => void;
  onDelete: (profile: AnalysisModelProfile) => void;
}

export function AnalysisModelPanel({
  labels,
  analysisModelProfiles,
  analysisModelProfileId,
  analysisModelName,
  analysisModelEndpoint,
  analysisModelApiKey,
  analysisModelStream,
  analysisModelStatus,
  analysisModelMessage,
  editedAnalysisModelProfile,
  canReuseAnalysisModelCredential,
  onProfileIdChange,
  onNameChange,
  onEndpointChange,
  onApiKeyChange,
  onStreamChange,
  onConnect,
  onRefresh,
  onNew,
  onEdit,
  onChoose,
  onDelete,
}: AnalysisModelPanelProps) {
  const apiKeyPlaceholder = editedAnalysisModelProfile?.source === "ENVIRONMENT"
    ? labels.apiKeyPlaceholderEnvironment
    : editedAnalysisModelProfile
      ? labels.apiKeyPlaceholderExisting
      : labels.apiKeyPlaceholderNew;

  const verifyButtonLabel = analysisModelStatus === "CHECKING"
    ? labels.verifying
    : editedAnalysisModelProfile
      ? labels.saveChangesAndVerify
      : labels.saveAndVerify;

  return (
    <section
      className="panel analysis-model-panel"
      aria-label={labels.panelAriaLabel}
    >
      <div className="panel-head">
        <div>
          <p className="eyebrow">{labels.eyebrow}</p>
          <h2>{labels.title}</h2>
          <p>{labels.description}</p>
        </div>
        <div className="model-panel-actions">
          <span className={`model-status ${analysisModelStatus.toLowerCase()}`}>
            {labels.statusLabel(analysisModelStatus)}
          </span>
          <Button onClick={onNew}>{labels.addModel}</Button>
        </div>
      </div>
      <div className="analysis-model-list" aria-label={labels.savedModelsAriaLabel}>
        {analysisModelProfiles.length === 0 ? (
          <div className="workspace-stat-empty">{labels.noProfiles}</div>
        ) : (
          analysisModelProfiles.map((profile) => (
            <article
              className={`analysis-model-card ${profile.active ? "active" : ""}`}
              key={profile.id}
            >
              <div>
                <span className="model-card-state">
                  {profile.active
                    ? labels.activeState
                    : profile.ready
                      ? labels.verifiedState
                      : labels.verifyState}
                </span>
                <strong>{profile.model}</strong>
                <small>
                  {profile.id} · {profile.stream ? "Stream/SSE" : "JSON"} ·{" "}
                  {profile.endpoint}
                </small>
              </div>
              <div className="model-card-actions">
                {!profile.active && (
                  <Button
                    variant="primary"
                    disabled={!profile.ready}
                    onClick={() => void onChoose(profile.id)}
                  >
                    {labels.use}
                  </Button>
                )}
                <Button onClick={() => onEdit(profile)}>{labels.edit}</Button>
                <Button
                  variant="danger"
                  disabled={profile.source === "ENVIRONMENT"}
                  title={
                    profile.source === "ENVIRONMENT"
                      ? labels.environmentDeleteTitle
                      : undefined
                  }
                  onClick={() => void onDelete(profile)}
                >
                  {labels.delete}
                </Button>
              </div>
            </article>
          ))
        )}
      </div>
      <div className="analysis-model-grid">
        <div className="field">
          <label htmlFor="analysis-profile-id">{labels.profileIdLabel}</label>
          <input
            id="analysis-profile-id"
            value={analysisModelProfileId}
            onChange={(event) => onProfileIdChange(event.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="analysis-model-name">{labels.modelLabel}</label>
          <input
            id="analysis-model-name"
            placeholder={labels.modelPlaceholder}
            value={analysisModelName}
            onChange={(event) => onNameChange(event.target.value)}
          />
        </div>
        <div className="field full">
          <label htmlFor="analysis-model-endpoint">{labels.endpointLabel}</label>
          <input
            id="analysis-model-endpoint"
            placeholder={labels.endpointPlaceholder}
            value={analysisModelEndpoint}
            onChange={(event) => onEndpointChange(event.target.value)}
          />
          <small>{labels.endpointHint}</small>
        </div>
        <div className="field full">
          <label htmlFor="analysis-model-key">{labels.apiKeyLabel}</label>
          <input
            id="analysis-model-key"
            type="password"
            autoComplete="off"
            placeholder={apiKeyPlaceholder}
            value={analysisModelApiKey}
            onChange={(event) => onApiKeyChange(event.target.value)}
          />
        </div>
        <label
          className="model-stream-toggle full"
          htmlFor="analysis-model-stream"
        >
          <input
            id="analysis-model-stream"
            type="checkbox"
            checked={analysisModelStream}
            onChange={(event) => onStreamChange(event.currentTarget.checked)}
          />
          <span>
            <b>{labels.streamLabel}</b>
            <small>{labels.streamHint}</small>
          </span>
        </label>
      </div>
      <div className="connection-actions">
        <Button
          variant="primary"
          disabled={
            analysisModelStatus === "CHECKING" ||
            !analysisModelProfileId.trim() ||
            !analysisModelEndpoint.trim() ||
            !analysisModelName.trim() ||
            (!analysisModelApiKey.trim() && !canReuseAnalysisModelCredential)
          }
          onClick={() => void onConnect()}
        >
          {verifyButtonLabel}
        </Button>
        <Button onClick={() => void onRefresh()}>{labels.refreshServerStatus}</Button>
        {analysisModelMessage && (
          <span
            className={`form-message ${
              analysisModelStatus === "ERROR" ? "error" : ""
            }`}
          >
            {analysisModelMessage}
          </span>
        )}
      </div>
    </section>
  );
}
