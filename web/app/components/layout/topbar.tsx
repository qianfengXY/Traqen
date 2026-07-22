import { Button } from "../ui/button";
import { Badge } from "../ui/badge";
import type { AnalysisModelProfile } from "../../analysis-model-client";

type View = "workspace" | "trace" | "graph" | "review" | "impact" | "metrics";
type Language = "zh-CN" | "en";

export interface TopbarLabels {
  breadcrumb: Record<View, string>;
  selfWorkspace: string;
  initialized: string;
  liveApi: string;
  backToSelfWorkspace: string;
  configureModel: string;
  connectApi: string;
  chinese: string;
  english: string;
}

export interface TopbarProps {
  labels: TopbarLabels;
  workspaceName: string;
  view: View;
  language: Language;
  liveScenario: unknown;
  workspaceAnalysis: unknown;
  analysisModelReady: boolean;
  activeAnalysisModelProfile: AnalysisModelProfile | null;
  onSetLanguage: (language: Language) => void;
  onClearLiveScenario: () => void;
  onToggleAnalysisSettings: () => void;
  onToggleConnection: () => void;
  "aria-label"?: string;
}

export function Topbar({
  labels,
  workspaceName,
  view,
  language,
  liveScenario,
  workspaceAnalysis,
  analysisModelReady,
  activeAnalysisModelProfile,
  onSetLanguage,
  onClearLiveScenario,
  onToggleAnalysisSettings,
  onToggleConnection,
  "aria-label": languageGroupAriaLabel,
}: TopbarProps) {
  const modeLabel = liveScenario
    ? labels.liveApi
    : workspaceAnalysis
      ? labels.initialized
      : labels.selfWorkspace;

  return (
    <header className="topbar">
      <div className="breadcrumb">
        {workspaceName}&nbsp; / &nbsp;
        <b>{labels.breadcrumb[view]}</b>
      </div>
      <div className="top-actions">
        <Badge variant={liveScenario || workspaceAnalysis ? "success" : "muted"}>
          {modeLabel}
        </Badge>
        <div
          className="language-switch"
          role="group"
          aria-label={languageGroupAriaLabel}
        >
          <Button
            aria-pressed={language === "zh-CN"}
            className={language === "zh-CN" ? "active" : ""}
            onClick={() => onSetLanguage("zh-CN")}
          >
            {labels.chinese}
          </Button>
          <Button
            aria-pressed={language === "en"}
            className={language === "en" ? "active" : ""}
            onClick={() => onSetLanguage("en")}
          >
            {labels.english}
          </Button>
        </div>
        {liveScenario && (
          <Button variant="ghost" onClick={onClearLiveScenario}>
            {labels.backToSelfWorkspace}
          </Button>
        )}
        <Button
          className={`model-connection-button ${analysisModelReady ? "ready" : ""}`}
          onClick={onToggleAnalysisSettings}
        >
          <span aria-hidden="true">{analysisModelReady ? "●" : "○"}</span>
          {analysisModelReady ? activeAnalysisModelProfile?.model : labels.configureModel}
        </Button>
        <Button onClick={onToggleConnection}>{labels.connectApi}</Button>
      </div>
    </header>
  );
}
