import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { getDb } from "@/db";
import { Button } from "@/components/ui/button";
import { requireUser } from "@/lib/authz";
import { listStudentCurriculum, markMaterialComplete } from "@/lib/content";
import { runReadTimeFallbacks } from "@/lib/cron";
import { renderMarkdown } from "@/lib/markdown";
import { roleHomePath } from "@/lib/session-routing";

export const metadata: Metadata = {
  title: "Course",
};

async function markCompleteAction(formData: FormData) {
  "use server";

  const user = await requireUser();

  if (user.role !== "student") {
    redirect(roleHomePath(user.role));
  }

  await markMaterialComplete(getDb(), {
    materialId: String(formData.get("materialId") ?? ""),
    studentId: user.id,
  });

  redirect(`/course/${formData.get("courseId") ?? ""}`);
}

export default async function StudentCoursePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireUser();

  if (user.role !== "student") {
    redirect(roleHomePath(user.role));
  }

  const { id } = await params;
  let curriculum;
  await runReadTimeFallbacks(getDb(), { skipSessions: true });

  try {
    curriculum = await listStudentCurriculum(getDb(), {
      courseId: id,
      studentId: user.id,
    });
  } catch {
    notFound();
  }

  const completedCount = curriculum.filter((entry) => entry.completed).length;
  const progressPercent =
    curriculum.length > 0 ? Math.round((completedCount / curriculum.length) * 100) : 0;

  return (
    <main className="mx-auto max-w-3xl p-6">
      <h1 className="font-display text-3xl italic">Course</h1>
      <section className="mt-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Curriculum</h2>
          <span className="font-mono text-[10px] uppercase text-muted-foreground">
            {curriculum.length} materials
          </span>
        </div>
        {curriculum.length === 0 ? (
          <div className="rounded-2xl border bg-card p-8 text-center shadow-soft">
            <p className="font-display text-2xl italic">No published materials yet.</p>
          </div>
        ) : (
          <div className="grid gap-3">
            <div className="rounded-2xl border bg-card p-5 shadow-soft">
              <div className="mb-3 flex items-center justify-between gap-4 text-sm">
                <span className="font-medium">Progress</span>
                <span className="text-muted-foreground">
                  {completedCount} of {curriculum.length} complete
                </span>
              </div>
              <div
                aria-label="Course progress"
                aria-valuemax={100}
                aria-valuemin={0}
                aria-valuenow={progressPercent}
                className="h-3 overflow-hidden rounded-full bg-muted"
                role="progressbar"
              >
                <div className="h-full bg-primary" style={{ width: `${progressPercent}%` }} />
              </div>
            </div>
            {curriculum.map((entry) => (
              <article
                className="rounded-2xl border bg-card p-5 shadow-soft"
                id={`material-${entry.material.id}`}
                key={entry.material.id}
              >
                <p className="font-mono text-[10px] uppercase text-muted-foreground">
                  {entry.material.type}
                </p>
                <h3 className="mt-2 text-lg font-semibold">{entry.material.title}</h3>
                <div className="mt-3 flex flex-wrap gap-2 text-xs font-medium">
                  <span className="rounded-full bg-muted px-3 py-1">
                    {entry.completed ? "Complete" : "Incomplete"}
                  </span>
                  {entry.locked ? (
                    <span className="rounded-full bg-destructive/10 px-3 py-1 text-destructive">
                      Locked
                    </span>
                  ) : null}
                </div>
                {entry.locked ? null : (
                  <>
                    <div
                      className="mt-4 rounded-xl border bg-background p-4"
                      dangerouslySetInnerHTML={{ __html: renderMarkdown(entry.material.bodyMd) }}
                    />
                    <form action={markCompleteAction} className="mt-4">
                      <input name="courseId" type="hidden" value={id} />
                      <input name="materialId" type="hidden" value={entry.material.id} />
                      <Button type="submit" variant="outline">
                        Mark as complete
                      </Button>
                    </form>
                  </>
                )}
                <div className="mt-4 flex flex-wrap gap-3 text-xs text-muted-foreground">
                  {entry.previousId ? (
                    <a
                      className="underline-offset-4 hover:underline"
                      href={`#material-${entry.previousId}`}
                    >
                      Previous
                    </a>
                  ) : null}
                  {entry.nextId ? (
                    <a
                      className="underline-offset-4 hover:underline"
                      href={`#material-${entry.nextId}`}
                    >
                      Next
                    </a>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
