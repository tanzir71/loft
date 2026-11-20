import { describe, expect, it } from "vitest";

import { landingContent } from "@/lib/landing-content";

describe("landingContent", () => {
  it("brands the public entry point as TutorLoft with the private tutor offer", () => {
    expect(landingContent.productName).toBe("TutorLoft");
    expect(landingContent.seo.title).toMatch(/· TutorLoft$/);
    expect(landingContent.hero.title).toContain("classes, materials, and billing");
    expect(landingContent.hero.primaryCta.href).toBe("/login");
    expect(landingContent.hero.secondaryCta.href).toMatch(/^mailto:/);
  });

  it("keeps the landing page small and focused on the three locked product areas", () => {
    expect(landingContent.features.map((feature) => feature.title)).toEqual([
      "Classes & Materials",
      "Quizzes & Assignments",
      "Billing for Parents",
    ]);
    expect(landingContent.howItWorks).toHaveLength(3);
  });
});
