import type { ReactNode } from "react";

interface EmptyStateProps {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
}

export function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <div style={{ padding: "40px 24px", textAlign: "center", color: "var(--muted)" }}>
      {icon ? <div style={{ fontSize: 32, marginBottom: 12 }}>{icon}</div> : null}
      <div style={{ fontWeight: 600, color: "var(--ink)", marginBottom: 6 }}>{title}</div>
      {description ? <div style={{ fontSize: 13, maxWidth: 420, margin: "0 auto 16px" }}>{description}</div> : null}
      {action ? <div>{action}</div> : null}
    </div>
  );
}
