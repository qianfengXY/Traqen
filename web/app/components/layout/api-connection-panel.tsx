import { Button } from "../ui/button";

export interface ApiConnectionPanelLabels {
  panelAriaLabel: string;
  apiBaseLabel: string;
  projectIdLabel: string;
  featureIdLabel: string;
  snapshotIdLabel: string;
  apiTokenLabel: string;
  loading: string;
  discoverAndLoad: string;
  loadSpecifiedIds: string;
  loadedMessagePrefixes: [string, string];
}

export interface ApiConnectionPanelProps {
  labels: ApiConnectionPanelLabels;
  apiBase: string;
  projectId: string;
  featureId: string;
  snapshotId: string;
  apiToken: string;
  loading: boolean;
  message: string;
  onApiBaseChange: (value: string) => void;
  onProjectIdChange: (value: string) => void;
  onFeatureIdChange: (value: string) => void;
  onSnapshotIdChange: (value: string) => void;
  onApiTokenChange: (value: string) => void;
  onDiscoverAndLoad: () => void;
  onLoad: () => void;
}

export function ApiConnectionPanel({
  labels,
  apiBase,
  projectId,
  featureId,
  snapshotId,
  apiToken,
  loading,
  message,
  onApiBaseChange,
  onProjectIdChange,
  onFeatureIdChange,
  onSnapshotIdChange,
  onApiTokenChange,
  onDiscoverAndLoad,
  onLoad,
}: ApiConnectionPanelProps) {
  const isSuccessMessage =
    message.startsWith(labels.loadedMessagePrefixes[0]) ||
    message.startsWith(labels.loadedMessagePrefixes[1]);

  return (
    <section className="panel connection-panel" aria-label={labels.panelAriaLabel}>
      <div className="connection-grid">
        <div className="field full">
          <label htmlFor="api-base">{labels.apiBaseLabel}</label>
          <input
            id="api-base"
            value={apiBase}
            onChange={(event) => onApiBaseChange(event.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="project-id">{labels.projectIdLabel}</label>
          <input
            id="project-id"
            value={projectId}
            onChange={(event) => onProjectIdChange(event.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="feature-id">{labels.featureIdLabel}</label>
          <input
            id="feature-id"
            value={featureId}
            onChange={(event) => onFeatureIdChange(event.target.value)}
          />
        </div>
        <div className="field full">
          <label htmlFor="snapshot-id">{labels.snapshotIdLabel}</label>
          <input
            id="snapshot-id"
            value={snapshotId}
            onChange={(event) => onSnapshotIdChange(event.target.value)}
          />
        </div>
        <div className="field full">
          <label htmlFor="api-token">{labels.apiTokenLabel}</label>
          <input
            id="api-token"
            type="password"
            autoComplete="off"
            value={apiToken}
            onChange={(event) => onApiTokenChange(event.target.value)}
          />
        </div>
      </div>
      <div className="connection-actions">
        <Button
          variant="primary"
          disabled={loading}
          onClick={() => void onDiscoverAndLoad()}
        >
          {loading ? labels.loading : labels.discoverAndLoad}
        </Button>
        <Button disabled={loading} onClick={() => void onLoad()}>
          {labels.loadSpecifiedIds}
        </Button>
        {message && (
          <span className={`form-message ${isSuccessMessage ? "" : "error"}`}>
            {message}
          </span>
        )}
      </div>
    </section>
  );
}
