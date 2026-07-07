import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";

import { schema } from "@/db/schema";

const databaseUrl = process.env.DATABASE_URL ?? "file:./data/dev.db";

export const client = createClient({
  url: databaseUrl,
  authToken: process.env.DATABASE_AUTH_TOKEN,
});

export const db = drizzle(client, { schema });
