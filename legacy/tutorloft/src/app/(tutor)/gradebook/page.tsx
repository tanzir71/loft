import { asc, eq } from "drizzle-orm";
import type { Metadata } from "next";

import { Button } from "@/components/ui/button";
import { getDb } from "@/db";
import { courses } from "@/db/schema";
import { requireTutor } from "@/lib/authz";
import { getCourseGradebook } from "@/lib/gradebook";

export const metadata: Metadata = {
  title: "Gradebook",
};

type GradebookPageProps = {
  searchParams: Promise<{ courseId?: string }>;
};

function cellText(cell: { earned: number | null; possible: number | null; status: string }) {
  if (cell.status === "missing") {
    return "Missing";
  }

  if (cell.status === "pending") {
    return "Pending";
  }

  return cell.possible === null ? String(cell.earned ?? "") : `${cell.earned}/${cell.possible}`;
}

function cellClass(status: string) {
  if (status === "missing") {
    return "border-b bg-destructive/10 px-3 py-3 font-semibold text-destructive";
  }

  if (status === "pending") {
    return "border-b bg-secondary px-3 py-3 font-semibold";
  }

  return "border-b px-3 py-3";
}

export default async function GradebookPage({ searchParams }: GradebookPageProps) {
  await requireTutor();
  const params = await searchParams;
  const courseRows = await getDb()
    .select({ id: courses.id, title: courses.title })
    .from(courses)
    .where(eq(courses.status, "active"))
    .orderBy(asc(courses.title));
  const selectedCourseId = params.courseId ?? courseRows[0]?.id ?? null;
  const gradebook = selectedCourseId
    ? await getCourseGradebook(getDb(), { courseId: selectedCourseId })
    : null;

  return (
    <main className="mx-auto max-w-6xl p-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl italic">Gradebook</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Course marks across assignments and quizzes.
          </p>
        </div>
        {gradebook ? (
          <Button asChild variant="outline">
            <a href={`/gradebook/results.csv?courseId=${gradebook.course.id}`}>Export CSV</a>
          </Button>
        ) : null}
      </div>

      <section className="mt-6 rounded-2xl border bg-card p-5 shadow-soft">
        <form className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <label className="block text-sm font-medium">
            Course
            <select
              className="mt-1 h-11 min-w-64 rounded-xl border bg-background px-3 text-sm"
              defaultValue={selectedCourseId ?? ""}
              name="courseId"
            >
              {courseRows.map((course) => (
                <option key={course.id} value={course.id}>
                  {course.title}
                </option>
              ))}
            </select>
          </label>
          <Button type="submit">View gradebook</Button>
        </form>
      </section>

      {!gradebook ? (
        <section className="mt-6 rounded-2xl border bg-card p-8 text-center shadow-soft">
          <p className="font-display text-2xl italic">Create a course before using the gradebook.</p>
        </section>
      ) : (
        <section className="mt-6 rounded-2xl border bg-card p-5 shadow-soft">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="font-mono text-[10px] uppercase text-muted-foreground">
                {gradebook.rows.length} students / {gradebook.columns.length} marks
              </p>
              <h2 className="mt-2 text-lg font-semibold">{gradebook.course.title}</h2>
            </div>
            <div className="flex gap-2 text-xs font-semibold uppercase">
              <span className="rounded-full border bg-destructive/10 px-3 py-1 text-destructive">
                Missing
              </span>
              <span className="rounded-full border bg-secondary px-3 py-1">Pending</span>
            </div>
          </div>
          {gradebook.rows.length === 0 || gradebook.columns.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Enroll students and publish assignments or quizzes to populate this table.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full border-collapse text-left text-sm">
                <thead className="text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="border-b px-3 py-2">Student</th>
                    {gradebook.columns.map((column) => (
                      <th className="border-b px-3 py-2" key={column.id}>
                        {column.title}
                        {column.points !== null ? (
                          <span className="ml-1 font-normal">/{column.points}</span>
                        ) : null}
                      </th>
                    ))}
                    <th className="border-b px-3 py-2">Average</th>
                  </tr>
                </thead>
                <tbody>
                  {gradebook.rows.map((row) => (
                    <tr key={row.studentId}>
                      <td className="border-b px-3 py-3 font-semibold">{row.studentName}</td>
                      {row.cells.map((cell) => (
                        <td className={cellClass(cell.status)} key={cell.columnId}>
                          {cellText(cell)}
                        </td>
                      ))}
                      <td className="border-b px-3 py-3 font-mono">
                        {row.averagePercent === null ? "" : `${row.averagePercent}%`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </main>
  );
}
