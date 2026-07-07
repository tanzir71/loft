import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { getDb } from "@/db";
import { requireUser } from "@/lib/authz";
import { listStudentCourses } from "@/lib/courses";
import { listStudentPortalSessions } from "@/lib/schedule";
import { roleHomePath } from "@/lib/session-routing";

export const metadata: Metadata = {
  title: "Home",
};

function formatSessionTime(timestamp: number) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
  }).format(new Date(timestamp));
}

function attendanceLabel(status: string | null) {
  switch (status) {
    case "present":
      return "Present";
    case "absent":
      return "Absent";
    case "late":
      return "Late";
    case "excused":
      return "Excused";
    default:
      return "Not marked";
  }
}

export default async function StudentHomePage() {
  const user = await requireUser();

  if (user.role !== "student") {
    redirect(roleHomePath(user.role));
  }

  const [courses, sessions] = await Promise.all([
    listStudentCourses(getDb(), user.id),
    listStudentPortalSessions(getDb(), user.id),
  ]);

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

      <section className="mt-8">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Schedule and attendance</h2>
          <span className="font-mono text-[10px] uppercase text-muted-foreground">
            {sessions.length} sessions
          </span>
        </div>
        {sessions.length === 0 ? (
          <div className="rounded-2xl border bg-card p-8 text-center shadow-soft">
            <p className="font-display text-2xl italic">No sessions yet.</p>
          </div>
        ) : (
          <div className="grid gap-3">
            {sessions.map((session) => (
              <article className="rounded-2xl border bg-card p-5 shadow-soft" key={session.id}>
                <p className="font-mono text-[10px] uppercase text-muted-foreground">
                  {formatSessionTime(session.startsAt)}
                </p>
                <h3 className="mt-2 text-lg font-semibold">{session.courseTitle}</h3>
                <div className="mt-3 flex flex-wrap gap-2 text-xs font-medium">
                  <span className="rounded-full bg-muted px-3 py-1">
                    {attendanceLabel(session.attendanceStatus)}
                  </span>
                  <span className="rounded-full bg-muted px-3 py-1">{session.status}</span>
                </div>
                {session.notesShared ? (
                  <p className="mt-3 text-sm leading-6 text-muted-foreground">
                    {session.notesShared}
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
