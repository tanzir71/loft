import type { AuthenticatedUser, UserRole } from "@/lib/user-types";

type SessionUser =
  | {
      id?: string;
      name?: string | null;
      email?: string | null;
      role?: UserRole;
    }
  | null
  | undefined;

export class AuthzError extends Error {
  constructor(
    message: string,
    readonly status: 401 | 403,
  ) {
    super(message);
    this.name = "AuthzError";
  }
}

function toAuthenticatedUser(user: SessionUser): AuthenticatedUser | null {
  if (!user?.id || !user.email || !user.role) {
    return null;
  }

  return {
    id: user.id,
    name: user.name ?? "",
    email: user.email,
    role: user.role,
  };
}

async function resolveUser(user?: SessionUser) {
  if (user !== undefined) {
    return toAuthenticatedUser(user);
  }

  const { auth } = await import("@/auth");
  const session = await auth();
  return toAuthenticatedUser(session?.user);
}

export async function requireUser(user?: SessionUser) {
  const resolved = await resolveUser(user);

  if (!resolved) {
    throw new AuthzError("Authentication required", 401);
  }

  return resolved;
}

export async function requireTutor(user?: SessionUser) {
  const resolved = await requireUser(user);

  if (resolved.role !== "tutor") {
    throw new AuthzError("Tutor access required", 403);
  }

  return resolved;
}

export async function scopeToStudent(user?: SessionUser, requestedStudentId?: string) {
  const resolved = await requireUser(user);

  if (resolved.role === "tutor") {
    return requestedStudentId;
  }

  if (resolved.role === "student") {
    if (requestedStudentId && requestedStudentId !== resolved.id) {
      throw new AuthzError("Student scope forbidden", 403);
    }

    return resolved.id;
  }

  if (!requestedStudentId) {
    throw new AuthzError("Student scope required", 403);
  }

  return requestedStudentId;
}
