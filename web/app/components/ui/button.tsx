import type { ButtonHTMLAttributes, ReactNode } from "react";

type ButtonVariant = "default" | "primary" | "ghost" | "danger";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
  variant?: ButtonVariant;
}

export function Button({ children, variant = "default", className = "", ...rest }: ButtonProps) {
  const variantClass = variant === "primary" ? "primary" : variant === "ghost" ? "ghost" : variant === "danger" ? "danger" : "";
  return (
    <button className={`button ${variantClass} ${className}`} {...rest}>
      {children}
    </button>
  );
}
