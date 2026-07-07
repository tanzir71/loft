import type { Metadata } from "next";
import { Archive, BookOpen, Save, UserMinus, UserPlus } from "lucide-react";
import { redirect } from "next/navigation";

import { getDb } from "@/db";
import { Button } from "@/components/ui/button";
import { requireTutor } from "@/lib/authz";
import {
  archiveCourse,
  createCourse,
  enrollStudent,
  listCoursesWithEnrollments,
  unenrollStudent,
  updateCourse,
} from "@/lib/courses";
import { listStudentsWithParents } from "@/lib/students";

export const metadata: Metadata = {
  title: "Courses",
};

async function createCourseAction(formData: FormData) {
  "use server";

  await requireTutor();
  await createCourse(getDb(), {
    title: String(formData.get("title") ?? ""),
    subject: String(formData.get("subject") ?? ""),
    description: String(formData.get("description") ?? ""),
  });

  redirect("/courses?created=1");
}

async function updateCourseAction(formData: FormData) {
  "use server";

  await requireTutor();
  await updateCourse(getDb(), {
    id: String(formData.get("id") ?? ""),
    title: String(formData.get("title") ?? ""),
    subject: String(formData.get("subject") ?? ""),
    description: String(formData.get("description") ?? ""),
    status: String(formData.get("status")) === "archived" ? "archived" : "active",
  });

  redirect("/courses?updated=1");
}

async function archiveCourseAction(formData: FormData) {
  "use server";

  await requireTutor();
  await archiveCourse(getDb(), {
    id: String(formData.get("courseId") ?? ""),
  });

  redirect("/courses?archived=1");
}

async function enrollStudentAction(formData: FormData) {
  "use server";

  await requireTutor();
  await enrollStudent(getDb(), {
    courseId: String(formData.get("courseId") ?? ""),
    studentId: String(formData.get("studentId") ?? ""),
  });

  redirect("/courses?enrolled=1");
}

async function unenrollStudentAction(formData: FormData) {
  "use server";

  await requireTutor();
  await unenrollStudent(getDb(), {
    courseId: String(formData.get("courseId") ?? ""),
    studentId: String(formData.get("studentId") ?? ""),
  });

  redirect("/courses?unenrolled=1");
}

export default async function CoursesPage() {
  await requireTutor();

  const [courses, students] = await Promise.all([
    listCoursesWithEnrollments(getDb()),
    listStudentsWithParents(getDb()),
  ]);
  const activeStudents = students.filter((student) => student.status === "active");

  return (
    <main className="mx-auto max-w-6xl p-6">
      <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
        <section className="w-full max-w-md rounded-2xl border bg-card p-6 shadow-soft">
          <p className="font-mono text-[10px] uppercase text-muted-foreground">Catalog</p>
          <h1 className="mt-3 font-display text-3xl italic">Courses</h1>
          <form action={createCourseAction} className="mt-6 space-y-4">
            <label className="block text-sm font-medium" htmlFor="title">
              Course title
            </label>
            <input
              className="h-11 w-full rounded-xl border bg-background px-3 text-sm"
              id="title"
              name="title"
              required
            />
            <label className="block text-sm font-medium" htmlFor="subject">
              Subject
            </label>
            <input
              className="h-11 w-full rounded-xl border bg-background px-3 text-sm"
              id="subject"
              name="subject"
              required
            />
            <label className="block text-sm font-medium" htmlFor="description">
              Description
            </label>
            <textarea
              className="min-h-24 w-full rounded-xl border bg-background px-3 py-2 text-sm"
              id="description"
              name="description"
            />
            <Button type="submit" variant="gradient">
              <BookOpen className="h-4 w-4" aria-hidden="true" />
              Add course
            </Button>
          </form>
        </section>

        <section className="flex-1">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold">Course list</h2>
            <span className="font-mono text-[10px] uppercase text-muted-foreground">
              {courses.length} total
            </span>
          </div>
          <div className="grid gap-3">
            {courses.length === 0 ? (
              <div className="rounded-2xl border bg-card p-8 text-center shadow-soft">
                <p className="font-display text-2xl italic">No courses yet.</p>
              </div>
            ) : (
              courses.map((course) => (
                <article className="rounded-2xl border bg-card p-4 shadow-soft" key={course.id}>
                  <div className="mb-4 flex flex-wrap items-center gap-2">
                    <span
                      className={
                        course.status === "active"
                          ? "rounded-full bg-accent/10 px-3 py-1 text-xs font-medium text-accent"
                          : "rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground"
                      }
                    >
                      {course.status === "active" ? "Active" : "Archived"}
                    </span>
                    <span className="font-mono text-xs text-muted-foreground">
                      {course.students.length} enrolled
                    </span>
                  </div>

                  <form
                    action={updateCourseAction}
                    className="grid gap-3 md:grid-cols-[1fr_150px_120px_auto]"
                  >
                    <input name="id" type="hidden" value={course.id} />
                    <input
                      aria-label={`Title for ${course.title}`}
                      className="h-10 rounded-xl border bg-background px-3 text-sm"
                      name="title"
                      defaultValue={course.title}
                      required
                    />
                    <input
                      aria-label={`Subject for ${course.title}`}
                      className="h-10 rounded-xl border bg-background px-3 text-sm"
                      name="subject"
                      defaultValue={course.subject}
                      required
                    />
                    <select
                      aria-label={`Status for ${course.title}`}
                      className="h-10 rounded-xl border bg-background px-3 text-sm"
                      name="status"
                      defaultValue={course.status}
                    >
                      <option value="active">Active</option>
                      <option value="archived">Archived</option>
                    </select>
                    <Button aria-label={`Save ${course.title}`} size="sm" type="submit">
                      <Save className="h-4 w-4" aria-hidden="true" />
                      Save
                    </Button>
                    <textarea
                      aria-label={`Description for ${course.title}`}
                      className="min-h-20 rounded-xl border bg-background px-3 py-2 text-sm md:col-span-4"
                      name="description"
                      defaultValue={course.description}
                    />
                  </form>

                  <div className="mt-4 grid gap-4 border-t pt-4">
                    <form
                      action={enrollStudentAction}
                      className="grid gap-3 md:grid-cols-[1fr_auto]"
                    >
                      <input name="courseId" type="hidden" value={course.id} />
                      <select
                        aria-label={`Enroll student in ${course.title}`}
                        className="h-10 rounded-xl border bg-background px-3 text-sm"
                        name="studentId"
                        required
                      >
                        <option value="">Choose student</option>
                        {activeStudents.map((student) => (
                          <option key={student.id} value={student.id}>
                            {student.name} ({student.email})
                          </option>
                        ))}
                      </select>
                      <Button
                        aria-label={`Enroll selected student in ${course.title}`}
                        size="sm"
                        type="submit"
                        variant="outline"
                      >
                        <UserPlus className="h-4 w-4" aria-hidden="true" />
                        Enroll
                      </Button>
                    </form>

                    <div>
                      <p className="font-mono text-[10px] uppercase text-muted-foreground">
                        Enrolled students
                      </p>
                      {course.students.length === 0 ? (
                        <p className="mt-2 text-sm text-muted-foreground">
                          No enrolled students
                        </p>
                      ) : (
                        <ul className="mt-2 grid gap-2">
                          {course.students.map((student) => (
                            <li
                              className="flex flex-col gap-2 rounded-xl border bg-background px-3 py-2 text-sm sm:flex-row sm:items-center sm:justify-between"
                              key={student.enrollmentId}
                            >
                              <span>
                                {student.name} ({student.email})
                              </span>
                              <form action={unenrollStudentAction}>
                                <input name="courseId" type="hidden" value={course.id} />
                                <input name="studentId" type="hidden" value={student.id} />
                                <Button
                                  aria-label={`Unenroll ${student.email} from ${course.title}`}
                                  size="sm"
                                  type="submit"
                                  variant="ghost"
                                >
                                  <UserMinus className="h-4 w-4" aria-hidden="true" />
                                  Unenroll
                                </Button>
                              </form>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>

                    <form action={archiveCourseAction}>
                      <input name="courseId" type="hidden" value={course.id} />
                      <Button
                        aria-label={`Archive ${course.title}`}
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
