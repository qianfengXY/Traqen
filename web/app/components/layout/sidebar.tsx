import type { LocalWorkspaceAnalysis } from "../../local-workspace-analysis";
import type { LocalWorkspaceProjectSummary } from "../../local-workspace-store";

type View = "workspace" | "trace" | "graph" | "review" | "impact" | "metrics";

export interface SidebarLabels {
  manageVisibilityAriaLabel: string;
  createWorkspaceAriaLabel: string;
  workspaceLabel: string;
  candidatesSuffix: string;
  self: string;
  shownProjectsAriaLabel: string;
  removeProjectAriaLabel: (name: string) => string;
  removeProjectTitle: string;
  hide: string;
  navAriaLabel: string;
  northStarTitle: string;
  northStarBody: string;
  navItems: Array<{ key: View; icon: string; label: string }>;
}

export interface SidebarProps {
  labels: SidebarLabels;
  language: string;
  workspaceName: string;
  currentProjectId: string;
  visibleWorkspaceAnalysis: LocalWorkspaceAnalysis | null;
  visibleWorkspaceProjects: LocalWorkspaceProjectSummary[];
  workspaceAnalysis: LocalWorkspaceAnalysis | null;
  workspaceProjectLoading: boolean;
  view: View;
  onSetView: (view: View) => void;
  onToggleWorkspaceManager: () => void;
  onStartNewWorkspace: () => void;
  onOpenStoredWorkspace: (projectId: string) => void;
  onChangeWorkspaceVisibility: (projectId: string, visible: boolean) => void;
}

export function Sidebar({
  labels,
  language,
  workspaceName,
  currentProjectId,
  visibleWorkspaceAnalysis,
  visibleWorkspaceProjects,
  workspaceAnalysis,
  workspaceProjectLoading,
  view,
  onSetView,
  onToggleWorkspaceManager,
  onStartNewWorkspace,
  onOpenStoredWorkspace,
  onChangeWorkspaceVisibility,
}: SidebarProps) {
  return (
    <aside className="sidebar">
      <div className="brand">
        <span className="brand-mark">TQ</span>Traqen
      </div>
      <div>
        <div className="workspace-switcher-head">
          <p className="workspace-label">{labels.workspaceLabel}</p>
          <div>
            <button
              aria-label={labels.manageVisibilityAriaLabel}
              onClick={onToggleWorkspaceManager}
            >
              ☷
            </button>
            <button aria-label={labels.createWorkspaceAriaLabel} onClick={onStartNewWorkspace}>
              ＋
            </button>
          </div>
        </div>
        <div className="workspace active-workspace">
          <strong>{workspaceName}</strong>
          <small>
            {currentProjectId} ·{" "}
            {visibleWorkspaceAnalysis
              ? `${visibleWorkspaceAnalysis.features.length} ${labels.candidatesSuffix}`
              : labels.self}
          </small>
        </div>
        {visibleWorkspaceProjects.length > 0 && (
          <div
            className="workspace-project-list"
            aria-label={labels.shownProjectsAriaLabel}
          >
            {visibleWorkspaceProjects.map((project) => (
              <div
                className={`workspace-project-row ${
                  workspaceAnalysis?.projectId === project.id ? "active" : ""
                }`}
                key={project.id}
              >
                <button
                  className="workspace-project-open"
                  disabled={workspaceProjectLoading}
                  onClick={() => void onOpenStoredWorkspace(project.id)}
                >
                  <strong>{project.name}</strong>
                  <small>
                    {project.candidateCount} {labels.candidatesSuffix} ·{" "}
                    {new Date(project.updatedAt).toLocaleDateString(language)}
                  </small>
                </button>
                <button
                  className="workspace-project-remove"
                  aria-label={labels.removeProjectAriaLabel(project.name)}
                  title={labels.removeProjectTitle}
                  onClick={() => void onChangeWorkspaceVisibility(project.id, false)}
                >
                  {labels.hide}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
      <nav className="nav" aria-label={labels.navAriaLabel}>
        {labels.navItems.map((item) => (
          <button
            key={item.key}
            className={`nav-button ${view === item.key ? "active" : ""}`}
            onClick={() => onSetView(item.key)}
          >
            <span className="nav-icon" aria-hidden="true">{item.icon}</span>
            <span>{item.label}</span>
          </button>
        ))}
      </nav>
      <div className="sidebar-note">
        <b>{labels.northStarTitle}</b>
        <br />
        {labels.northStarBody}
      </div>
    </aside>
  );
}
