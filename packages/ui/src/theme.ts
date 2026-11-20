export const THEME_MODES = ["loft", "sunrise", "northwind", "aurelian"] as const;
export type ThemeMode = (typeof THEME_MODES)[number];

/** Apply a brand mode. A branded org is a different mode (Figma variable modes → CSS). */
export function applyTheme(mode: ThemeMode, el: HTMLElement = document.documentElement): void {
  if (mode === "loft") el.removeAttribute("data-theme");
  else el.setAttribute("data-theme", mode);
}
