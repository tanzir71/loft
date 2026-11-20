import { describe, expect, it } from "vitest";

import { databaseClientConfig } from "@/db";

describe("database client config", () => {
  it("adds a busy timeout for local SQLite files", () => {
    expect(databaseClientConfig({ DATABASE_URL: "file:./data/e2e.db" })).toEqual({
      timeout: 5_000,
      url: "file:./data/e2e.db",
    });
  });

  it("keeps remote configuration free of local-only timeout", () => {
    expect(
      databaseClientConfig({
        DATABASE_AUTH_TOKEN: "secret",
        DATABASE_URL: "libsql://example.turso.io",
      }),
    ).toEqual({
      authToken: "secret",
      url: "libsql://example.turso.io",
    });
  });
});
