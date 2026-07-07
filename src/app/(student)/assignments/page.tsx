import type { Metadata } from "next";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { getDb } from "@/db";
import { Button } from "@/components/ui/button";
import { requireUser } from "@/lib/authz";
import { listStudentAssignments, submitAssignment } from "@/lib/classroom";
import { renderMarkdown } from "@/lib/markdown";
import { roleHomePath } from "@/lib/session-routing";

export const metadata: Metadata = {
  title: "Assignments",
};

async function submitAssignmentAction(formData: FormData) {
  "use server";

  const user = await requireUser();

  if (user.role !== "student") {
    redirect(roleHomePath(user.role));
  }

  const fileUrl = String(formData.get("fileUrl") ?? "").trim();
  await submitAssignment(getDb(), {
    assignmentId: String(formData.get("assignmentId") ?? ""),
    bodyText: String(formData.get("bodyText") ?? ""),
    file: fileUrl
      ? {
          blobUrl: fileUrl,
          filename: String(formData.get("filename") ?? "") || "submission file",
          size: 0,
        }
      : null,
    linkUrl: String(formData.get("linkUrl") ?? "") || null,
    studentId: user.id,
  });

  revalidatePath("/assignments");
  redirect("/assignments");
}

export default async function StudentAssignmentsPage() {
  const user = await requireUser();

  if (user.role !== "student") {
    redirect(roleHomePath(user.role));
  }

  const assignments = await listStudentAssignments(getDb(), { studentId: user.id });

  return (
    <main className="mx-auto max-w-4xl p-6">
      <h1 className="font-display text-3xl italic">Assignments</h1>
      <section className="mt-6 grid gap-4">
        {assignments.length === 0 ? (
          <div className="rounded-2xl border bg-card p-8 text-center shadow-soft">
            <p className="font-display text-2xl italic">No assignments yet.</p>
          </div>
        ) : (
          assignments.map((assignment) => (
            <article className="rounded-2xl border bg-card p-5 shadow-soft" key={assignment.id}>
              <h2 className="text-lg font-semibold">{assignment.title}</h2>
              <div
                className="mt-3 text-sm leading-6 text-muted-foreground"
                dangerouslySetInnerHTML={{ __html: renderMarkdown(assignment.bodyMd) }}
              />
              {assignment.rubricMd ? (
                <div className="mt-4 rounded-xl border bg-background p-4">
                  <p className="text-sm font-semibold">Rubric</p>
                  <div
                    className="mt-2 text-sm text-muted-foreground"
                    dangerouslySetInnerHTML={{ __html: renderMarkdown(assignment.rubricMd) }}
                  />
                </div>
              ) : null}
              <form action={submitAssignmentAction} className="mt-5 grid gap-3">
                <input name="assignmentId" type="hidden" value={assignment.id} />
                {assignment.allowText ? (
                  <textarea className="min-h-28 rounded-xl border bg-background px-3 py-2 text-sm" name="bodyText" placeholder="Submission text" />
                ) : null}
                {assignment.allowLink ? (
                  <input className="h-10 rounded-xl border bg-background px-3 text-sm" name="linkUrl" placeholder="Submission link" type="url" />
                ) : null}
                {assignment.allowFile ? (
                  <div className="grid gap-2 sm:grid-cols-2">
                    <input className="h-10 rounded-xl border bg-background px-3 text-sm" name="fileUrl" placeholder="File URL" type="url" />
                    <input className="h-10 rounded-xl border bg-background px-3 text-sm" name="filename" placeholder="Filename" />
                  </div>
                ) : null}
                <Button type="submit" variant="gradient">
                  Submit assignment
                </Button>
              </form>
            </article>
          ))
        )}
      </section>
    </main>
  );
}
