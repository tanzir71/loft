import { expect, it } from "vitest";
import { afterAuth, directRoomStart } from "./auth";
it("retains room options and rejects external or looping auth destinations", () => {
  expect(afterAuth("/r/new?name=Workshop&guests=1")).toBe("/r/new?name=Workshop&guests=1");
  for (const value of [null, "https://example.test", "//example.test", "/\\example.test", "/signin?next=/signin", "/install"]) expect(afterAuth(value)).toBe("/");
});
it("maps the public shortcut without confusing it with the new-space wizard", () => {
  expect(directRoomStart("/spaces/new", "/spaces/")).toBe(true);
  expect(directRoomStart("/spaces/new/", "/spaces/")).toBe(true);
  expect(directRoomStart("/spaces/spaces/new", "/spaces/")).toBe(false);
});
