import type { ButtonHTMLAttributes, ReactNode } from "react";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "soft" | "dark" | "danger";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: "md" | "sm";
  icon?: ReactNode;
  block?: boolean;
}

export function buttonClass(variant: ButtonVariant = "primary", size: "md" | "sm" = "md", block = false, extra = ""): string {
  return ["lf-btn", `lf-btn--${variant}`, size === "sm" && "lf-btn--sm", block && "lf-btn--block", extra].filter(Boolean).join(" ");
}

/** Figma Foundations · Button (Primary / Secondary / Ghost / Soft / Dark × MD / SM). */
export function Button({ variant = "primary", size = "md", icon, block = false, className = "", children, type = "button", ...rest }: ButtonProps) {
  return (
    <button type={type} className={buttonClass(variant, size, block, className)} {...rest}>
      {icon}
      {children}
    </button>
  );
}
