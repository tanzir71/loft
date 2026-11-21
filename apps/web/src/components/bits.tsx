import type { ReactNode } from "react";
import { formatTime } from "@loft/core";

/** Coloured space code tile ("PRC") used on cards, rows and Today. */
export function SpaceTile({ code, colour, size = "md" }: { code: string; colour: string; size?: "sm" | "md" | "lg" }) {
  return (
    <span className={`space-tile space-tile--${size} sc-${colour}`} aria-hidden="true">
      {code}
    </span>
  );
}

/** "Today 21:00", "Tomorrow 10:00", "Mon 16:00", "Sat 24 Nov". */
export function whenLabel(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(d) - day(now)) / 86_400_000);
  const t = formatTime(iso);
  if (diff === 0) return `Today ${t}`;
  if (diff === 1) return `Tomorrow ${t}`;
  if (diff > 1 && diff < 7) return `${d.toLocaleDateString("en-GB", { weekday: "short" })} ${t}`;
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
}

export function relTime(iso: string, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

export function SectionHead({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <div className="section-head">
      <h2>{title}</h2>
      {action}
    </div>
  );
}

export function Loading({ label = "Loading" }: { label?: string }) {
  return (
    <div className="page" aria-busy="true" aria-label={label}>
      <div className="skeleton skeleton--bar" />
      <div className="skeleton skeleton--hero" style={{ marginTop: 16 }} />
    </div>
  );
}

/** Figma 07 · "Error with a way out": what failed, why if we know, and what to do next. */
export function ErrorState({ what, onRetry, detail }: { what: string; onRetry?: () => void; detail?: string }) {
  return (
    <div className="page">
      <div className="state-error" role="alert">
        <b>Couldn't load {what}</b>
        <p>{detail ?? "Something went wrong on our side or the connection dropped. Your work is saved in this browser."}</p>
        <div className="state-error__actions">
          {onRetry && <button type="button" className="lf-btn lf-btn--secondary lf-btn--sm" onClick={onRetry}>Try again</button>}
          <a className="lf-btn lf-btn--ghost lf-btn--sm" href="./">Go to Home</a>
        </div>
      </div>
    </div>
  );
}
