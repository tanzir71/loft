import { asc, eq } from "drizzle-orm";
import type { Metadata } from "next";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { getDb } from "@/db";
import { courses } from "@/db/schema";
import { Button } from "@/components/ui/button";
import { requireTutor } from "@/lib/authz";
import { createAssignment, listTutorAssignments, updateAssignment } from "@/lib/classroom";
import { renderMarkdown } from "@/lib/markdown";

export const metadata: Metadata = {
  title: "Assignments",
};

function dateStart(value: FormDataEntryValue | null) {
  const raw = String(value ?? "").trim();

  if (!raw) {
    return null;
  }

  const timestamp = Date.parse(`${raw}T00:00:00.000Z`);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function numberValue(value: FormDataEntryValue | null) {
  const raw = String(value ?? "").trim();
  const parsed = Number(raw);
  return raw && Number.isFinite(parsed) ? parsed : null;
}

function statusValue(value: FormDataEntryValue | null) {
  return String(value ?? "") === "published" ? "published" : "draft";
}

function boolValue(value: FormDataEntryValue | null) {
  return String(value ?? "") === "true";
}

async function createAssignmentAction(formData: FormData) {
  "use server";

  await requireTutor();
  await createAssignment(getDb(), {
    allowFile: boolValue(formData.get("allowFile")),
    allowLink: boolValue(formData.get("allowLink")),
    allowText: boolValue(formData.get("allowText")),
    bodyMd: String(formData.get("bodyMd") ?? ""),
    courseId: String(formData.get("courseId") ?? ""),
    dueAt: dateStart(formData.get("dueAt")),
    points: numberValue(formData.get("points")),
    rubricMd: String(formData.get("rubricMd") ?? ""),
    status: statusValue(formData.get("status")),
    title: String(formData.get("title") ?? ""),
  });

  revalidatePath("/assignments");
  redirect("/assignment-builder");
}

async function updateAssignmentAction(formData: FormData) {
  "use server";

  await requireTutor();
  await updateAssignment(getDb(), {
    allowFile: boolValue(formData.get("allowFile")),
    allowLink: boolValue(formData.get("allowLink")),
    allowText: boolValue(formData.get("allowText")),
    bodyMd: String(formData.get("bodyMd") ?? ""),
    courseId: String(formData.get("courseId") ?? ""),
    dueAt: dateStart(formData.get("dueAt")),
    id: String(formData.get("id") ?? ""),
    points: numberValue(formData.get("points")),
    rubricMd: String(formData.get("rubricMd") ?? ""),
    status: statusValue(formData.get("status")),
    title: String(formData.get("title") ?? ""),
  });

  revalidatePath("/assignments");
  redirect("/assignment-builder");
}

export default async function AssignmentsPage() {
  await requireTutor();
  const [courseRows, assignmentRows] = await Promise.all([
    getDb()
      .select({ id: courses.id, title: courses.title })
      .from(courses)
      .where(eq(courses.status, "active"))
      .orderBy(asc(courses.title)),
    listTutorAssignments(getDb()),
  ]);

  return (
    <main className="mx-auto max-w-6xl p-6">
      <h1 className="font-display text-3xl italic">Assignments</h1>
      <div className="mt-8 grid gap-6 lg:grid-cols-[360px_1fr]">
        <section className="rounded-2xl border bg-card p-6 shadow-soft">
          <p className="font-mono text-[10px] uppercase text-muted-foreground">Classroom</p>
          <h2 className="mt-3 text-lg font-semibold">Add assignment</h2>
          <form action={createAssignmentAction} className="mt-5 space-y-4">
            <label className="block text-sm font-medium" htmlFor="assignmentTitle">
              Title
            </label>
            <input className="h-11 w-full rounded-xl border bg-background px-3 text-sm" id="assignmentTitle" name="title" required />
            <label className="block text-sm font-medium" htmlFor="assignmentCourse">
              Course
            </label>
            <select className="h-11 w-full rounded-xl border bg-background px-3 text-sm" id="assignmentCourse" name="courseId" required>
              {courseRows.map((course) => (
                <option key={course.id} value={course.id}>
                  {course.title}
                </option>
              ))}
            </select>
            <label className="block text-sm font-medium" htmlFor="assignmentBody">
              Body
            </label>
            <textarea className="min-h-28 w-full rounded-xl border bg-background px-3 py-2 text-sm" id="assignmentBody" name="bodyMd" />
            <label className="block text-sm font-medium" htmlFor="assignmentRubric">
              Rubric
            </label>
            <textarea className="min-h-24 w-full rounded-xl border bg-background px-3 py-2 text-sm" id="assignmentRubric" name="rubricMd" />
            <div className="grid gap-3 sm:grid-cols-2">
              <input className="h-11 rounded-xl border bg-background px-3 text-sm" name="dueAt" type="date" />
              <input className="h-11 rounded-xl border bg-background px-3 text-sm" name="points" placeholder="Points" type="number" />
              <select className="h-11 rounded-xl border bg-background px-3 text-sm" name="status" defaultValue="draft">
                <option value="draft">Draft</option>
                <option value="published">Published</option>
              </select>
              <select className="h-11 rounded-xl border bg-background px-3 text-sm" name="allowFile" defaultValue="false">
                <option value="false">Files off</option>
                <option value="true">Files on</option>
              </select>
              <input name="allowText" type="hidden" value="true" />
              <input name="allowLink" type="hidden" value="true" />
            </div>
            <Button type="submit" variant="gradient">
              Add assignment
            </Button>
          </form>
        </section>

        <section className="space-y-4">
          <h2 className="text-lg font-semibold">Assignments</h2>
          {assignmentRows.length === 0 ? (
            <div className="rounded-2xl border bg-card p-8 text-center shadow-soft">
              <p className="font-display text-2xl italic">No assignments yet.</p>
            </div>
          ) : (
            assignmentRows.map((assignment) => (
              <article className="rounded-2xl border bg-card p-5 shadow-soft" key={assignment.id}>
                <details>
                  <summary className="cursor-pointer text-lg font-semibold">{assignment.title}</summary>
                  <div
                    className="mt-4 rounded-xl border bg-background p-4"
                    dangerouslySetInnerHTML={{ __html: renderMarkdown(assignment.bodyMd) }}
                  />
                  <form action={updateAssignmentAction} className="mt-5 grid gap-3">
                    <input name="id" type="hidden" value={assignment.id} />
                    <input className="h-10 rounded-xl border bg-background px-3 text-sm" name="title" defaultValue={assignment.title} />
                    <select className="h-10 rounded-xl border bg-background px-3 text-sm" name="courseId" defaultValue={assignment.courseId}>
                      {courseRows.map((course) => (
                        <option key={course.id} value={course.id}>
                          {course.title}
                        </option>
                      ))}
                    </select>
                    <textarea className="min-h-24 rounded-xl border bg-background px-3 py-2 text-sm" name="bodyMd" defaultValue={assignment.bodyMd} />
                    <textarea className="min-h-20 rounded-xl border bg-background px-3 py-2 text-sm" name="rubricMd" defaultValue={assignment.rubricMd ?? ""} />
                    <div className="grid gap-3 sm:grid-cols-2">
                      <input className="h-10 rounded-xl border bg-background px-3 text-sm" name="dueAt" defaultValue={assignment.dueAt ? new Date(assignment.dueAt).toISOString().slice(0, 10) : ""} type="date" />
                      <input className="h-10 rounded-xl border bg-background px-3 text-sm" name="points" defaultValue={assignment.points ?? ""} type="number" />
                      <select className="h-10 rounded-xl border bg-background px-3 text-sm" name="status" defaultValue={assignment.status}>
                        <option value="draft">Draft</option>
                        <option value="published">Published</option>
                      </select>
                      <select className="h-10 rounded-xl border bg-background px-3 text-sm" name="allowFile" defaultValue={String(assignment.allowFile)}>
                        <option value="false">Files off</option>
                        <option value="true">Files on</option>
                      </select>
                      <input name="allowText" type="hidden" value={String(assignment.allowText)} />
                      <input name="allowLink" type="hidden" value={String(assignment.allowLink)} />
                    </div>
                    <Button size="sm" type="submit">
                      Save assignment
                    </Button>
                  </form>
                </details>
              </article>
            ))
          )}
        </section>
      </div>
    </main>
  );
}
