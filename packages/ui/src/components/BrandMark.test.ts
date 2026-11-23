import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BrandIcon, BrandMark } from "./BrandMark";

describe("product and organisation branding", () => {
  it("uses the current product artwork for Loft rather than a text L", () => {
    const html = renderToStaticMarkup(createElement(BrandIcon));
    expect(html).toContain("<img");
    expect(html).toContain("loft-logo");
    expect(html).toContain('alt=""');
    expect(html).not.toContain(">L<");
  });

  it("retains custom organisation monograms, including organisations using L", () => {
    for (const [name, monogram] of [["Sunrise Academy", "SA"], ["Lumen Labs", "L"], ["Loft", "CUSTOM"]]) {
      const html = renderToStaticMarkup(createElement(BrandIcon, { name, monogram }));
      expect(html).not.toContain("<img");
      expect(html).toContain(`>${monogram}</span>`);
    }
  });

  it("keeps labelled menu controls and a text wordmark", () => {
    const html = renderToStaticMarkup(createElement(BrandMark, { name: "Loft", onClick() {}, label: "Open Loft menu" }));
    expect(html).toContain('aria-label="Open Loft menu"');
    expect(html).toContain('class="lf-wordmark">Loft</span>');
    expect(html).toContain("lf-mark--logo");
  });
});
