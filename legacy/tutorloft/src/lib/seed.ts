import { hash } from "bcryptjs";
import { eq } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { randomBytes } from "node:crypto";

import { schema, settings, users } from "../db/schema";

type AppDb = LibSQLDatabase<typeof schema>;

export type SeedTutorInput = {
  email: string;
  password: string;
  name?: string;
  now?: () => number;
  makeId?: () => string;
};

const defaultSettings = [
  ["currency", "BDT"],
  ["invoice_prefix", "TL"],
  ["timezone", "Asia/Dhaka"],
] as const;

function createId() {
  return randomBytes(12).toString("base64url");
}

function normalizeSeedInput(input: SeedTutorInput) {
  const email = input.email.trim().toLowerCase();
  const password = input.password;
  const name = input.name?.trim() || "Tutor";

  if (!email) {
    throw new Error("TUTOR_EMAIL is required.");
  }

  if (!password || password.length < 8) {
    throw new Error("TUTOR_PASSWORD must be at least 8 characters.");
  }

  return { email, password, name };
}

export async function seedTutor(database: AppDb, input: SeedTutorInput) {
  const { email, password, name } = normalizeSeedInput(input);
  const now = input.now?.() ?? Date.now();
  const makeId = input.makeId ?? createId;
  const passwordHash = await hash(password, 12);

  await database
    .insert(users)
    .values({
      id: makeId(),
      name,
      email,
      passwordHash,
      role: "tutor",
      status: "active",
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: users.email,
      set: {
        name,
        passwordHash,
        role: "tutor",
        status: "active",
        updatedAt: now,
      },
    });

  for (const [key, value] of defaultSettings) {
    await database
      .insert(settings)
      .values({ key, value })
      .onConflictDoUpdate({
        target: settings.key,
        set: { value },
      });
  }

  const [tutor] = await database.select().from(users).where(eq(users.email, email));

  if (!tutor) {
    throw new Error("Tutor seed did not create an account.");
  }

  return tutor;
}
