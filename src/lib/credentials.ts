import { compare } from "bcryptjs";
import { eq } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";

import { schema, users } from "@/db/schema";
import type { AuthenticatedUser } from "@/lib/user-types";

type AppDb = LibSQLDatabase<typeof schema>;

export type CredentialInput = {
  email: string;
  password: string;
};

export async function verifyCredentials(
  database: AppDb,
  credentials: CredentialInput,
): Promise<AuthenticatedUser | null> {
  const email = credentials.email.trim().toLowerCase();
  const password = credentials.password;

  if (!email || !password) {
    return null;
  }

  const [user] = await database.select().from(users).where(eq(users.email, email));

  if (!user || user.status !== "active") {
    return null;
  }

  const passwordMatches = await compare(password, user.passwordHash);

  if (!passwordMatches) {
    return null;
  }

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
  };
}
