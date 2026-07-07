import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";

import { schema } from "./schema";

type LibSqlClient = ReturnType<typeof createClient>;
type AppDb = ReturnType<typeof drizzle<typeof schema>>;
type LibSqlConfig = Parameters<typeof createClient>[0];

let client: LibSqlClient | undefined;
let database: AppDb | undefined;

const localFileBusyTimeoutMs = 5_000;

export function databaseClientConfig(
  env: Record<string, string | undefined> = process.env,
): LibSqlConfig {
  const url = env.DATABASE_URL ?? "file:./data/dev.db";
  const config: LibSqlConfig = { url };

  if (env.DATABASE_AUTH_TOKEN) {
    config.authToken = env.DATABASE_AUTH_TOKEN;
  }

  if (url.startsWith("file:")) {
    config.timeout = localFileBusyTimeoutMs;
  }

  return config;
}

export function getClient() {
  if (!client) {
    client = createClient(databaseClientConfig());
  }

  return client;
}

export function getDb() {
  if (!database) {
    database = drizzle(getClient(), { schema });
  }

  return database;
}

export function closeDb() {
  client?.close();
  client = undefined;
  database = undefined;
}
