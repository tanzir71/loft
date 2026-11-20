import type { ReactNode } from "react";

export type BadgeStatus = "neutral" | "info" | "success" | "warning" | "danger" | "live";

/** Figma Foundations · Badge. */
export function Badge({ status = "neutral", dot = true, children }: { status?: BadgeStatus; dot?: boolean; children: ReactNode }) {
  return (
    <span className={`lf-badge lf-badge--${status}`}>
      {dot && <span className="lf-badge__dot" aria-hidden="true" />}
      {children}
    </span>
  );
}

export function Count({ n, tone = "danger", label }: { n: number; tone?: "danger" | "primary"; label?: string }) {
  if (n <= 0) return null;
  return (
    <span className={`lf-count${tone === "primary" ? " lf-count--primary" : ""}`} aria-label={label ?? `${n} new`}>
      {n > 99 ? "99+" : n}
    </span>
  );
}
