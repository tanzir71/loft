import { describe, expect, it } from "vitest";

import { decryptSecret, encryptSecret } from "@/lib/crypto";

describe("encrypted secrets", () => {
  it("round-trips values with AES-GCM and HKDF-derived keys", () => {
    const encrypted = encryptSecret("sk-test-1234567890", "auth-secret-one");

    expect(encrypted).toMatch(/^v1\./);
    expect(encrypted).not.toContain("sk-test");
    expect(decryptSecret(encrypted, "auth-secret-one")).toBe("sk-test-1234567890");
  });

  it("rejects decryption with a different secret", () => {
    const encrypted = encryptSecret("sk-test-1234567890", "auth-secret-one");

    expect(() => decryptSecret(encrypted, "auth-secret-two")).toThrow("Unable to decrypt");
  });
});
