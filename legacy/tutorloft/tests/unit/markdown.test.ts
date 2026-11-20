import { describe, expect, it } from "vitest";

import { renderMarkdown } from "@/lib/markdown";

describe("markdown rendering", () => {
  it("escapes raw HTML and drops unsafe link protocols", () => {
    const html = renderMarkdown(
      [
        "# Lesson",
        "<img src=x onerror=alert(1)>",
        "[unsafe](javascript:alert(1))",
        "[safe](https://example.com/resource)",
      ].join("\n"),
    );

    expect(html).toContain("Lesson");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("javascript:");
    expect(html).toContain('href="https://example.com/resource"');
  });
});
