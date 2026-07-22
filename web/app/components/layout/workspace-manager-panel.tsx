import { Button } from "../ui/button";
import type { LocalWorkspaceProjectSummary } from "../../local-workspace-store";

export interface WorkspaceManagerPanelLabels {
  panelAriaLabel: string;
  eyebrow: string;
  title: string;
  description: string;
  done: string;
  noProjects: string;
  shown: string;
  hidden: string;
  featuresSuffix: string;
}

export interface WorkspaceManagerPanelProps {
  labels: WorkspaceManagerPanelLabels;
  workspaceProjects: LocalWorkspaceProjectSummary[];
  onChangeVisibility: (projectId: string, visible: boolean) => void;
  onClose: () => void;
}

export function WorkspaceManagerPanel({
  labels,
  workspaceProjects,
  onChangeVisibility,
  onClose,
}: WorkspaceManagerPanelProps) {
  return (
    <section
      className="panel workspace-manager-panel"
      aria-label={labels.panelAriaLabel}
    >
      <div className="panel-head">
        <div>
          <p className="eyebrow">{labels.eyebrow}</p>
          <h2>{labels.title}</h2>
          <p>{labels.description}</p>
        </div>
        <Button onClick={onClose}>{labels.done}</Button>
      </div>
      <div className="workspace-visibility-list">
        {workspaceProjects.length === 0 ? (
          <div className="workspace-stat-empty">{labels.noProjects}</div>
        ) : (
          workspaceProjects.map((project) => (
            <label key={project.id} className={project.visible ? "visible" : ""}>
              <input
                type="checkbox"
                checked={project.visible}
                onChange={(event) =>
                  void onChangeVisibility(project.id, event.currentTarget.checked)
                }
              />
              <span>
                <b>{project.name}</b>
                <small>
                  {project.id} · {project.featureCount} {labels.featuresSuffix} ·{" "}
                  {project.rootName}
                </small>
              </span>
              <em>{project.visible ? labels.shown : labels.hidden}</em>
            </label>
          ))
        )}
      </div>
    </section>
  );
}
