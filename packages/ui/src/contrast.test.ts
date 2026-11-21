import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Accessibility pass (handoff M12): text/background pairs the UI uses must reach WCAG AA (4.5:1)
// in every brand mode (Loft, Sunrise, Northwind, Aurelian).
const css = readFileSync(fileURLToPath(new URL("./tokens.css", import.meta.url)), "utf8");

function block(selector: string): Record<string, string> {
  const start = css.indexOf(selector);
  if (start < 0) return {};
  const body = css.slice(css.indexOf("{", start) + 1, css.indexOf("}", start));
  return Object.fromEntries([...body.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{3,8})/g)].map((m) => [m[1]!, m[2]!]));
}

const base = block('[data-theme="loft"]');
const modes: Record<string, Record<string, string>> = {
  loft: base,
  sunrise: { ...base, ...block('[data-theme="sunrise"]') },
  northwind: { ...base, ...block('[data-theme="northwind"]') },
  aurelian: { ...base, ...block('[data-theme="aurelian"]') }
};

function lum(hex: string): number {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h.slice(0, 6);
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}
export function contrast(a: string, b: string): number {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x! + 0.05) / (y! + 0.05);
}

// [text, background] pairs as they appear in the UI.
const PAIRS: [string, string][] = [
  ["color-fg", "color-bg"],
  ["color-fg", "color-card"],
  ["color-ink-2", "color-card"],
  ["color-muted-fg", "color-card"],
  ["color-muted-fg", "color-bg"],
  ["color-white", "color-primary"],
  ["color-primary", "color-card"],
  ["color-primary-ink", "color-primary-soft"],
  ["color-accent-ink", "color-accent-soft"],
  ["color-warning-ink", "color-warning-soft"],
  ["color-destructive-ink", "color-destructive-soft"],
  ["color-white", "color-destructive-ink"],
  ["color-white", "color-dark"]
];

describe("contrast in every brand mode (WCAG AA, 4.5:1)", () => {
  for (const [mode, t] of Object.entries(modes)) {
    it(mode, () => {
      const failures = PAIRS.filter(([fg, bg]) => t[fg] && t[bg] && contrast(t[fg]!, t[bg]!) < 4.5).map(([fg, bg]) => `${fg} on ${bg}: ${contrast(t[fg]!, t[bg]!).toFixed(2)}`);
      expect(failures).toEqual([]);
    });
  }
  it("reads every mode", () => {
    expect(Object.keys(base).length).toBeGreaterThan(20);
    expect(modes.sunrise!["color-primary"]).toBe("#841f30");
  });
});
