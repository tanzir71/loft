import { asc, eq } from "drizzle-orm";
import type { Metadata } from "next";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { getDb } from "@/db";
import { courses } from "@/db/schema";
import { Button } from "@/components/ui/button";
import { requireTutor } from "@/lib/authz";
import { createAnnouncement, listTutorAnnouncements, updateAnnouncement } from "@/lib/classroom";
import { renderMarkdown } from "@/lib/markdown";

export const metadata: Metadata = {
  title: "Announcements",
};

function dateStart(value: FormDataEntryValue | null) {
  const raw = String(value ?? "").trim();

  if (!raw) {
    return null;
  }

  const timestamp = Date.parse(`${raw}T00:00:00.000Z`);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function publishStatus(value: FormDataEntryValue | null) {
  return String(value ?? "") === "published" ? "published" : "draft";
}

async function createAnnouncementAction(formData: FormData) {
  "use server";

  await requireTutor();
  await createAnnouncement(getDb(), {
    allowComments: String(formData.get("allowComments") ?? "") === "true",
    bodyMd: String(formData.get("bodyMd") ?? ""),
    courseId: String(formData.get("courseId") ?? "") || null,
    publishAt: dateStart(formData.get("publishAt")),
    status: publishStatus(formData.get("status")),
    title: String(formData.get("title") ?? ""),
  });

  revalidatePath("/announcements");
  revalidatePath("/home");
  revalidatePath("/overview");
  redirect("/announcements");
}

async function updateAnnouncementAction(formData: FormData) {
  "use server";

  await requireTutor();
  await updateAnnouncement(getDb(), {
    allowComments: String(formData.get("allowComments") ?? "") === "true",
    bodyMd: String(formData.get("bodyMd") ?? ""),
    courseId: String(formData.get("courseId") ?? "") || null,
    id: String(formData.get("id") ?? ""),
    publishAt: dateStart(formData.get("publishAt")),
    status: publishStatus(formData.get("status")),
    title: String(formData.get("title") ?? ""),
  });

  revalidatePath("/announcements");
  revalidatePath("/home");
  revalidatePath("/overview");
  redirect("/announcements");
}

export default async function AnnouncementsPage() {
  await requireTutor();
  const [courseRows, announcementRows] = await Promise.all([
    getDb()
      .select({ id: courses.id, title: courses.title })
      .from(courses)
      .where(eq(courses.status, "active"))
      .orderBy(asc(courses.title)),
    listTutorAnnouncements(getDb()),
  ]);

  return (
    <main className="mx-auto max-w-6xl p-6">
      <h1 className="font-display text-3xl italic">Announcements</h1>
      <div className="mt-8 grid gap-6 lg:grid-cols-[360px_1fr]">
        <section className="rounded-2xl border bg-card p-6 shadow-soft">
          <p className="font-mono text-[10px] uppercase text-muted-foreground">Classroom feed</p>
          <h2 className="mt-3 text-lg font-semibold">Add announcement</h2>
          <form action={createAnnouncementAction} className="mt-5 space-y-4">
            <label className="block text-sm font-medium" htmlFor="announcementTitle">
              Title
            </label>
            <input className="h-11 w-full rounded-xl border bg-background px-3 text-sm" id="announcementTitle" name="title" required />
            <label className="block text-sm font-medium" htmlFor="announcementCourse">
              Course
            </label>
            <select className="h-11 w-full rounded-xl border bg-background px-3 text-sm" id="announcementCourse" name="courseId">
              <option value="">Global</option>
              {courseRows.map((course) => (
                <option key={course.id} value={course.id}>
                  {course.title}
                </option>
              ))}
            </select>
            <label className="block text-sm font-medium" htmlFor="announcementBody">
              Body
            </label>
            <textarea className="min-h-32 w-full rounded-xl border bg-background px-3 py-2 text-sm" id="announcementBody" name="bodyMd" />
            <input className="h-11 w-full rounded-xl border bg-background px-3 text-sm" name="publishAt" type="date" />
            <select className="h-11 w-full rounded-xl border bg-background px-3 text-sm" name="status" defaultValue="draft">
              <option value="draft">Draft</option>
              <option value="published">Published</option>
            </select>
            <select className="h-11 w-full rounded-xl border bg-background px-3 text-sm" name="allowComments" defaultValue="false">
              <option value="false">Comments off</option>
              <option value="true">Comments on</option>
            </select>
            <Button type="submit" variant="gradient">
              Add announcement
            </Button>
          </form>
        </section>

        <section className="space-y-4">
          <h2 className="text-lg font-semibold">Published and scheduled</h2>
          {announcementRows.length === 0 ? (
            <div className="rounded-2xl border bg-card p-8 text-center shadow-soft">
              <p className="font-display text-2xl italic">No announcements yet.</p>
            </div>
          ) : (
            announcementRows.map((announcement) => (
              <article className="rounded-2xl border bg-card p-5 shadow-soft" key={announcement.id}>
                <details>
                  <summary className="cursor-pointer text-lg font-semibold">{announcement.title}</summary>
                  <div
                    className="mt-4 rounded-xl border bg-background p-4"
                    dangerouslySetInnerHTML={{ __html: renderMarkdown(announcement.bodyMd) }}
                  />
                  <form action={updateAnnouncementAction} className="mt-5 grid gap-3">
                    <input name="id" type="hidden" value={announcement.id} />
                    <input className="h-10 rounded-xl border bg-background px-3 text-sm" name="title" defaultValue={announcement.title} />
                    <select className="h-10 rounded-xl border bg-background px-3 text-sm" name="courseId" defaultValue={announcement.courseId ?? ""}>
                      <option value="">Global</option>
                      {courseRows.map((course) => (
                        <option key={course.id} value={course.id}>
                          {course.title}
                        </option>
                      ))}
                    </select>
                    <textarea className="min-h-24 rounded-xl border bg-background px-3 py-2 text-sm" name="bodyMd" defaultValue={announcement.bodyMd} />
                    <input
                      className="h-10 rounded-xl border bg-background px-3 text-sm"
                      defaultValue={announcement.publishAt ? new Date(announcement.publishAt).toISOString().slice(0, 10) : ""}
                      name="publishAt"
                      type="date"
                    />
                    <div className="grid gap-3 sm:grid-cols-2">
                      <select className="h-10 rounded-xl border bg-background px-3 text-sm" name="status" defaultValue={announcement.status}>
                        <option value="draft">Draft</option>
                        <option value="published">Published</option>
                      </select>
                      <select className="h-10 rounded-xl border bg-background px-3 text-sm" name="allowComments" defaultValue={String(announcement.allowComments)}>
                        <option value="false">Comments off</option>
                        <option value="true">Comments on</option>
                      </select>
                    </div>
                    <Button size="sm" type="submit">
                      Save announcement
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
