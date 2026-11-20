import { hash } from "bcryptjs";
import { and, eq } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { randomBytes } from "node:crypto";

import { invites, parentLinks, schema, users } from "@/db/schema";

type AppDb = LibSQLDatabase<typeof schema>;

type InviteRole = "student" | "parent";

type CreateInviteInput = {
  role: InviteRole;
  studentId?: string;
  now?: () => number;
  makeId?: () => string;
  makeCode?: () => string;
};

type RegisterWithInviteInput = {
  code: string;
  name: string;
  email: string;
  password: string;
  now?: () => number;
  makeId?: () => string;
};

const inviteLifetimeMs = 7 * 24 * 60 * 60 * 1000;

function createId() {
  return randomBytes(12).toString("base64url");
}

function createCode() {
  return randomBytes(9).toString("base64url").toUpperCase();
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function normalizeCode(code: string) {
  return code.trim().toUpperCase();
}

export async function createInvite(database: AppDb, input: CreateInviteInput) {
  if (input.role === "parent" && !input.studentId) {
    throw new Error("Parent invites require a linked student.");
  }

  if (input.role === "parent") {
    const studentId = input.studentId;

    if (!studentId) {
      throw new Error("Parent invites require a linked student.");
    }

    const [student] = await database
      .select({ id: users.id })
      .from(users)
      .where(
        and(
          eq(users.id, studentId),
          eq(users.role, "student"),
          eq(users.status, "active"),
        ),
      );

    if (!student) {
      throw new Error("Parent invites require an active student.");
    }
  }

  const now = input.now?.() ?? Date.now();
  const invite = {
    id: input.makeId?.() ?? createId(),
    code: normalizeCode(input.makeCode?.() ?? createCode()),
    role: input.role,
    studentId: input.studentId ?? null,
    expiresAt: now + inviteLifetimeMs,
    usedBy: null,
    createdAt: now,
    updatedAt: now,
  };

  await database.insert(invites).values(invite);

  return invite;
}

export async function listInvites(database: AppDb) {
  return database.select().from(invites);
}

export async function getInviteByCode(database: AppDb, code: string) {
  const [invite] = await database
    .select()
    .from(invites)
    .where(eq(invites.code, normalizeCode(code)));

  return invite ?? null;
}

export function inviteUnavailable(
  invite: Awaited<ReturnType<typeof getInviteByCode>>,
  now = Date.now(),
) {
  return !invite || Boolean(invite.usedBy) || invite.expiresAt < now;
}

export async function registerWithInvite(database: AppDb, input: RegisterWithInviteInput) {
  const now = input.now?.() ?? Date.now();
  const code = normalizeCode(input.code);
  const email = normalizeEmail(input.email);
  const name = input.name.trim();

  if (!code) {
    throw new Error("Invite code is required.");
  }

  if (!name) {
    throw new Error("Name is required.");
  }

  if (!email) {
    throw new Error("Email is required.");
  }

  if (!input.password || input.password.length < 8) {
    throw new Error("Password must be at least 8 characters.");
  }

  const [invite] = await database.select().from(invites).where(eq(invites.code, code));

  if (!invite) {
    throw new Error("Invite not found");
  }

  if (invite.usedBy) {
    throw new Error("Invite has already been used");
  }

  if (invite.expiresAt < now) {
    throw new Error("Invite has expired");
  }

  const user = {
    id: input.makeId?.() ?? createId(),
    name,
    email,
    passwordHash: await hash(input.password, 12),
    role: invite.role,
    status: "active" as const,
    icsToken: null,
    createdAt: now,
    updatedAt: now,
  };

  await database.insert(users).values(user);

  if (invite.role === "parent" && invite.studentId) {
    await database.insert(parentLinks).values({
      parentId: user.id,
      studentId: invite.studentId,
    });
  }

  await database
    .update(invites)
    .set({ usedBy: user.id, updatedAt: now })
    .where(eq(invites.id, invite.id));

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
  };
}
