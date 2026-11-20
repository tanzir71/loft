import { describe, expect, it } from "vitest";

import { safeEmbedUrl, youtubeEmbedUrl } from "@/lib/embeds";

describe("material embeds", () => {
  it("normalizes common YouTube URLs to privacy-friendly nocookie embeds", () => {
    expect(youtubeEmbedUrl("https://youtu.be/abcDEF123_4")).toBe(
      "https://www.youtube-nocookie.com/embed/abcDEF123_4",
    );
    expect(youtubeEmbedUrl("https://www.youtube.com/watch?v=abcDEF123_4")).toBe(
      "https://www.youtube-nocookie.com/embed/abcDEF123_4",
    );
    expect(youtubeEmbedUrl("https://www.youtube.com/shorts/abcDEF123_4")).toBe(
      "https://www.youtube-nocookie.com/embed/abcDEF123_4",
    );
    expect(youtubeEmbedUrl("https://example.com/watch?v=abcDEF123_4")).toBeNull();
  });

  it("only allows http and https inline embed URLs", () => {
    expect(safeEmbedUrl("https://example.com/file.pdf")).toBe("https://example.com/file.pdf");
    expect(safeEmbedUrl("javascript:alert(1)")).toBeNull();
  });
});
