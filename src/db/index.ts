import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";

import { schema } from "./schema";

type LibSqlClient = ReturnType<typeof createClient>;
type AppDb = ReturnType<typeof drizzle<typeof schema>>;

let client: LibSqlClient | undefined;
let database: AppDb | undefined;

export function getClient() {
  if (!client) {
    client = createClient({
      url: process.env.DATABASE_URL ?? "file:./data/dev.db",
      authToken: process.env.DATABASE_AUTH_TOKEN,
    });
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
