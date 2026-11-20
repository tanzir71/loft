export type AvatarTone = "lilac" | "peach" | "mint" | "pink" | "green" | "blue";
export type Presence = "available" | "away" | "busy" | "offline";

const TONES: AvatarTone[] = ["lilac", "peach", "mint", "pink", "green", "blue"];

/** Stable tone per name so the same person always gets the same colour. */
export function toneFor(seed: string): AvatarTone {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return TONES[h % TONES.length] ?? "lilac";
}

export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
  return (first + last).toUpperCase();
}

/** Figma Foundations · Avatar (SM 24 / MD 32 / LG 40), optional presence dot. */
export function Avatar({ name, size = "md", tone, presence }: { name: string; size?: "sm" | "md" | "lg"; tone?: AvatarTone; presence?: Presence }) {
  const t = tone ?? toneFor(name);
  return (
    <span className={`lf-avatar lf-avatar--${t}${size !== "md" ? ` lf-avatar--${size}` : ""}`} title={name} aria-label={name} role="img">
      <span aria-hidden="true">{initialsOf(name)}</span>
      {presence && <span className={`lf-presence lf-presence--${presence}`} aria-hidden="true" />}
    </span>
  );
}
