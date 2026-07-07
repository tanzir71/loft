import type { Metadata } from "next";
import { Archive, Save, UserPlus } from "lucide-react";
import { redirect } from "next/navigation";

import { getDb } from "@/db";
import { Button } from "@/components/ui/button";
import { requireTutor } from "@/lib/authz";
import {
  archiveStudent,
  createStudent,
  listStudentsWithParents,
  updateStudent,
} from "@/lib/students";

export const metadata: Metadata = {
  title: "Students",
};

async function createStudentAction(formData: FormData) {
  "use server";

  await requireTutor();
  await createStudent(getDb(), {
    name: String(formData.get("name") ?? ""),
    email: String(formData.get("email") ?? ""),
  });

  redirect("/students?created=1");
}

async function updateStudentAction(formData: FormData) {
  "use server";

  await requireTutor();
  await updateStudent(getDb(), {
    id: String(formData.get("id") ?? ""),
    name: String(formData.get("name") ?? ""),
    email: String(formData.get("email") ?? ""),
    status: String(formData.get("status")) === "archived" ? "archived" : "active",
  });

  redirect("/students?updated=1");
}

async function archiveStudentAction(formData: FormData) {
  "use server";

  await requireTutor();
  await archiveStudent(getDb(), {
    id: String(formData.get("id") ?? ""),
  });

  redirect("/students?archived=1");
}

export default async function StudentsPage() {
  await requireTutor();

  const students = await listStudentsWithParents(getDb());

  return (
    <main className="mx-auto max-w-6xl p-6">
      <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
        <section className="w-full max-w-md rounded-2xl border bg-card p-6 shadow-soft">
          <p className="font-mono text-[10px] uppercase text-muted-foreground">Roster</p>
          <h1 className="mt-3 font-display text-3xl italic">Students</h1>
          <form action={createStudentAction} className="mt-6 space-y-4">
            <label className="block text-sm font-medium" htmlFor="name">
              Student name
            </label>
            <input
              className="h-11 w-full rounded-xl border bg-background px-3 text-sm"
              id="name"
              name="name"
              required
            />
            <label className="block text-sm font-medium" htmlFor="email">
              Student email
            </label>
            <input
              className="h-11 w-full rounded-xl border bg-background px-3 text-sm"
              id="email"
              name="email"
              required
              type="email"
            />
            <Button type="submit" variant="gradient">
              <UserPlus className="h-4 w-4" aria-hidden="true" />
              Add student
            </Button>
          </form>
        </section>

        <section className="flex-1">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold">Student list</h2>
            <span className="font-mono text-[10px] uppercase text-muted-foreground">
              {students.length} total
            </span>
          </div>
          <div className="grid gap-3">
            {students.length === 0 ? (
              <div className="rounded-2xl border bg-card p-8 text-center shadow-soft">
                <p className="font-display text-2xl italic">No students yet.</p>
              </div>
            ) : (
              students.map((student) => (
                <article className="rounded-2xl border bg-card p-4 shadow-soft" key={student.id}>
                  <div className="mb-4 flex flex-wrap items-center gap-2">
                    <span
                      className={
                        student.status === "active"
                          ? "rounded-full bg-accent/10 px-3 py-1 text-xs font-medium text-accent"
                          : "rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground"
                      }
                    >
                      {student.status === "active" ? "Active" : "Archived"}
                    </span>
                    <span className="font-mono text-xs text-muted-foreground">BDT 0</span>
                  </div>

                  <form
                    action={updateStudentAction}
                    className="grid gap-3 md:grid-cols-[1fr_1fr_140px_auto]"
                  >
                    <input name="id" type="hidden" value={student.id} />
                    <input
                      aria-label={`Name for ${student.email}`}
                      className="h-10 rounded-xl border bg-background px-3 text-sm"
                      name="name"
                      defaultValue={student.name}
                      required
                    />
                    <input
                      aria-label={`Email for ${student.email}`}
                      className="h-10 rounded-xl border bg-background px-3 text-sm"
                      name="email"
                      defaultValue={student.email}
                      required
                      type="email"
                    />
                    <select
                      aria-label={`Status for ${student.email}`}
                      className="h-10 rounded-xl border bg-background px-3 text-sm"
                      name="status"
                      defaultValue={student.status}
                    >
                      <option value="active">Active</option>
                      <option value="archived">Archived</option>
                    </select>
                    <Button aria-label={`Save ${student.email}`} size="sm" type="submit">
                      <Save className="h-4 w-4" aria-hidden="true" />
                      Save
                    </Button>
                  </form>

                  <div className="mt-4 flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="font-mono text-[10px] uppercase text-muted-foreground">
                        Parents
                      </p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {student.parents.length > 0
                          ? student.parents
                              .map((parent) => `${parent.name} (${parent.email})`)
                              .join(", ")
                          : "No linked parents"}
                      </p>
                    </div>
                    <form action={archiveStudentAction}>
                      <input name="id" type="hidden" value={student.id} />
                      <Button
                        aria-label={`Archive ${student.email}`}
                        size="sm"
                        type="submit"
                        variant="outline"
                      >
                        <Archive className="h-4 w-4" aria-hidden="true" />
                        Archive
                      </Button>
                    </form>
                  </div>
                </article>
              ))
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
