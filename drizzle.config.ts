import { defineConfig } from "drizzle-kit";

const databaseUrl = process.env.DATABASE_URL ?? "file:./data/dev.db";
const baseConfig = {
  schema: "./src/db/schema.ts",
  out: "./drizzle",
} as const;

export default databaseUrl.startsWith("libsql://")
  ? defineConfig({
      ...baseConfig,
      dialect: "turso",
      dbCredentials: {
        url: databaseUrl,
        authToken: process.env.DATABASE_AUTH_TOKEN,
      },
    })
  : defineConfig({
      ...baseConfig,
      dialect: "sqlite",
      dbCredentials: {
        url: databaseUrl,
      },
    });
