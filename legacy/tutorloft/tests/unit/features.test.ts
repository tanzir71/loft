import { describe, expect, it } from "vitest";

import { aiEnabled, hasBlob, hasEmail } from "@/lib/features";

describe("runtime feature flags", () => {
  it("detects optional email and blob integrations from environment variables", () => {
    expect(hasEmail({ RESEND_API_KEY: "" })).toBe(false);
    expect(hasEmail({ RESEND_API_KEY: "  resend-key  " })).toBe(true);
    expect(hasBlob({ BLOB_READ_WRITE_TOKEN: undefined })).toBe(false);
    expect(hasBlob({ BLOB_READ_WRITE_TOKEN: "blob-token" })).toBe(true);
  });

  it("only enables AI when both provider and encrypted key settings exist", () => {
    expect(aiEnabled({ ai_provider: "openrouter", ai_key_encrypted: "ciphertext" })).toBe(
      true,
    );
    expect(aiEnabled({ ai_provider: "openrouter" })).toBe(false);
    expect(aiEnabled({ ai_key_encrypted: "ciphertext" })).toBe(false);
  });
});
