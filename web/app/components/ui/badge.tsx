import type { ReactNode } from "react";

type BadgeVariant = "success" | "warning" | "danger" | "info" | "muted";

interface BadgeProps {
  children: ReactNode;
  variant?: BadgeVariant;
}

export function Badge({ children, variant = "muted" }: BadgeProps) {
  return <span className={`badge ${variant}`}>{children}</span>;
}
