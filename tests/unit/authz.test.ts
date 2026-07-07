import { describe, expect, it } from "vitest";

import { AuthzError, requireTutor, requireUser, scopeToStudent } from "@/lib/authz";
import type { AuthenticatedUser } from "@/lib/user-types";

const tutor: AuthenticatedUser = {
  id: "tutor_id",
  name: "Tutor",
  email: "tutor@example.com",
  role: "tutor",
};

const student: AuthenticatedUser = {
  id: "student_a",
  name: "Student A",
  email: "student@example.com",
  role: "student",
};

const parent: AuthenticatedUser = {
  id: "parent_id",
  name: "Parent",
  email: "parent@example.com",
  role: "parent",
};

describe("authz helpers", () => {
  it("requires an authenticated user before continuing", async () => {
    await expect(requireUser(null)).rejects.toMatchObject({
      status: 401,
      message: "Authentication required",
    });
  });

  it("rejects non-tutors from tutor-only actions", async () => {
    await expect(requireTutor(student)).rejects.toMatchObject({
      status: 403,
      message: "Tutor access required",
    });
    await expect(requireTutor(tutor)).resolves.toEqual(tutor);
  });

  it("prevents a student from scoping reads to another student", async () => {
    await expect(scopeToStudent(student, "student_b")).rejects.toBeInstanceOf(AuthzError);
    await expect(scopeToStudent(student, "student_a")).resolves.toBe("student_a");
    await expect(scopeToStudent(student)).resolves.toBe("student_a");
  });

  it("requires parents to request a linked student scope explicitly", async () => {
    await expect(scopeToStudent(parent)).rejects.toMatchObject({
      status: 403,
      message: "Student scope required",
    });
    await expect(scopeToStudent(parent, "student_a")).resolves.toBe("student_a");
  });
});
