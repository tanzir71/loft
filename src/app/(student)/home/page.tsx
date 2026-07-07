import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { getDb } from "@/db";
import { requireUser } from "@/lib/authz";
import { listStudentCourses } from "@/lib/courses";
import { roleHomePath } from "@/lib/session-routing";

export const metadata: Metadata = {
  title: "Home",
};

export default async function StudentHomePage() {
  const user = await requireUser();

  if (user.role !== "student") {
    redirect(roleHomePath(user.role));
  }

  const courses = await listStudentCourses(getDb(), user.id);

  return (
    <main className="mx-auto max-w-3xl p-6">
      <h1 className="font-display text-3xl italic">Home</h1>
      <section className="mt-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">My courses</h2>
          <span className="font-mono text-[10px] uppercase text-muted-foreground">
            {courses.length} enrolled
          </span>
        </div>
        {courses.length === 0 ? (
          <div className="rounded-2xl border bg-card p-8 text-center shadow-soft">
            <p className="font-display text-2xl italic">No courses yet.</p>
          </div>
        ) : (
          <div className="grid gap-3">
            {courses.map((course) => (
              <article className="rounded-2xl border bg-card p-5 shadow-soft" key={course.id}>
                <p className="font-mono text-[10px] uppercase text-muted-foreground">
                  {course.subject}
                </p>
                <h3 className="mt-2 text-lg font-semibold">{course.title}</h3>
                {course.description ? (
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">
                    {course.description}
                  </p>
                ) : null}
              </article>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
