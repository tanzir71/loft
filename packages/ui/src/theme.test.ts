import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { THEME_MODES } from "./theme";
import { initialsOf, toneFor } from "./components/Avatar";
import { isCurrent } from "./components/nav";

const css = readFileSync(join(__dirname, "tokens.css"), "utf8");
const tokens = JSON.parse(readFileSync(join(__dirname, "..", "tokens.json"), "utf8"));

describe("tokens.css", () => {
  it("has a block for every Figma mode", () => {
    for (const m of THEME_MODES) expect(css).toContain(`[data-theme="${m}"]`);
    expect(Object.keys(tokens.modes)).toEqual([...THEME_MODES]);
  });
  it("defines every colour token on :root", () => {
    for (const name of Object.keys(tokens.color)) expect(css).toMatch(new RegExp(`--color-${name}:`));
  });
  it("never uses italics or serif fonts", () => {
    expect(css).not.toMatch(/italic/i);
    // "sans-serif" is fine; a bare serif family is not.
    expect(css).not.toMatch(/(?<!-)\bserif\b/);
    expect(css).not.toMatch(/Georgia|Times|Garamond|Merriweather/i);
  });
  it("keeps the board dot grid subtle (canvas-dot close to bg)", () => {
    const hex = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
    for (const m of THEME_MODES) {
      const bg = hex(tokens.color.bg[m]);
      const dot = hex(tokens.color["canvas-dot"][m]);
      const diff = Math.max(...bg.map((v, i) => Math.abs(v - (dot[i] ?? 0))));
      expect(diff).toBeLessThan(24);
    }
  });
});

describe("avatar helpers", () => {
  it("makes initials", () => {
    expect(initialsOf("Nusrat Rahman")).toBe("NR");
    expect(initialsOf("leena")).toBe("L");
    expect(initialsOf("  ")).toBe("?");
    expect(initialsOf("Shirin Ara Karim")).toBe("SK");
  });
  it("gives a stable tone", () => {
    expect(toneFor("Nusrat Rahman")).toBe(toneFor("Nusrat Rahman"));
  });
});

describe("isCurrent", () => {
  it("matches root only exactly", () => {
    expect(isCurrent("/", "/")).toBe(true);
    expect(isCurrent("/money", "/")).toBe(false);
    expect(isCurrent("/spaces/abc/stream", "/spaces/abc")).toBe(true);
    expect(isCurrent("/spaces/abcd", "/spaces/abc")).toBe(false);
  });
});
