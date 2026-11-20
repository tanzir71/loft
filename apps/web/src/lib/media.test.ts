import { describe, expect, it } from "vitest";
import { breakpointFor } from "./media";

describe("breakpoints (Figma 07 · Responsive spec)", () => {
  it("maps widths", () => {
    expect(breakpointFor(1440)).toBe("desktop");
    expect(breakpointFor(1200)).toBe("desktop");
    expect(breakpointFor(1199)).toBe("tablet");
    expect(breakpointFor(768)).toBe("tablet");
    expect(breakpointFor(767)).toBe("phone");
    expect(breakpointFor(390)).toBe("phone");
  });
});
