import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { BrandWordmark } from "@/components/brand-wordmark";

describe("TutorLoft branding", () => {
  it("renders the locked serif italic wordmark with the Loft accent", () => {
    const markup = renderToStaticMarkup(createElement(BrandWordmark));

    expect(markup).toContain("font-display");
    expect(markup).toContain("italic");
    expect(markup).toContain("Tutor");
    expect(markup).toContain("text-primary");
    expect(markup).toContain("Loft");
  });

  it("uses the TutorLoft product name in the README", () => {
    const readme = readFileSync("README.md", "utf8");

    expect(readme).toContain("# TutorLoft");
    expect(readme).toContain("TutorLoft");
  });
});
