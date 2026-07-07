import { asc, eq } from "drizzle-orm";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { getDb } from "@/db";
import { courses } from "@/db/schema";
import { Button } from "@/components/ui/button";
import { MarkdownEditor } from "@/components/markdown-editor";
import { requireTutor } from "@/lib/authz";
import { createMaterial, createModule, listCourseContent, updateMaterial, updateModule } from "@/lib/content";
import { renderMarkdown } from "@/lib/markdown";

export const metadata: Metadata = {
  title: "Content",
};

function numberValue(value: FormDataEntryValue | null, fallback = 0) {
  const parsed = Number(value ?? fallback);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function publishStatus(value: FormDataEntryValue | null) {
  return String(value ?? "") === "published" ? "published" : "draft";
}

function materialType(value: FormDataEntryValue | null) {
  const raw = String(value ?? "");
  return raw === "study" || raw === "lesson_plan" || raw === "worksheet" ? raw : "lecture";
}

function visibility(value: FormDataEntryValue | null) {
  return String(value ?? "") === "tutor_only" ? "tutor_only" : "students";
}

async function createModuleAction(formData: FormData) {
  "use server";

  await requireTutor();
  await createModule(getDb(), {
    courseId: String(formData.get("courseId") ?? ""),
    description: String(formData.get("description") ?? ""),
    sortOrder: numberValue(formData.get("sortOrder")),
    title: String(formData.get("title") ?? ""),
  });

  redirect(`/content?courseId=${formData.get("courseId") ?? ""}`);
}

async function updateModuleAction(formData: FormData) {
  "use server";

  await requireTutor();
  await updateModule(getDb(), {
    description: String(formData.get("description") ?? ""),
    id: String(formData.get("id") ?? ""),
    sortOrder: numberValue(formData.get("sortOrder")),
    status: publishStatus(formData.get("status")),
    title: String(formData.get("title") ?? ""),
  });

  redirect(`/content?courseId=${formData.get("courseId") ?? ""}`);
}

async function createMaterialAction(formData: FormData) {
  "use server";

  await requireTutor();
  await createMaterial(getDb(), {
    bodyMd: String(formData.get("bodyMd") ?? ""),
    courseId: String(formData.get("courseId") ?? ""),
    moduleId: String(formData.get("moduleId") ?? "") || null,
    sortOrder: numberValue(formData.get("sortOrder")),
    status: publishStatus(formData.get("status")),
    title: String(formData.get("title") ?? ""),
    type: materialType(formData.get("type")),
    visibility: visibility(formData.get("visibility")),
  });

  redirect(`/content?courseId=${formData.get("courseId") ?? ""}`);
}

async function updateMaterialAction(formData: FormData) {
  "use server";

  await requireTutor();
  await updateMaterial(getDb(), {
    bodyMd: String(formData.get("bodyMd") ?? ""),
    courseId: String(formData.get("courseId") ?? ""),
    id: String(formData.get("id") ?? ""),
    moduleId: String(formData.get("moduleId") ?? "") || null,
    sortOrder: numberValue(formData.get("sortOrder")),
    status: publishStatus(formData.get("status")),
    title: String(formData.get("title") ?? ""),
    type: materialType(formData.get("type")),
    visibility: visibility(formData.get("visibility")),
  });

  redirect(`/content?courseId=${formData.get("courseId") ?? ""}`);
}

export default async function ContentPage({
  searchParams,
}: {
  searchParams: Promise<{ courseId?: string }>;
}) {
  await requireTutor();
  const params = await searchParams;
  const courseRows = await getDb()
    .select({ id: courses.id, title: courses.title })
    .from(courses)
    .where(eq(courses.status, "active"))
    .orderBy(asc(courses.title));
  const selectedCourseId = params.courseId ?? courseRows[0]?.id ?? "";
  const content = selectedCourseId
    ? await listCourseContent(getDb(), selectedCourseId)
    : { materials: [], modules: [] };

  return (
    <main className="mx-auto max-w-6xl p-6">
      <h1 className="font-display text-3xl italic">Content</h1>
      <form className="mt-6 flex max-w-md gap-2" method="get">
        <label className="sr-only" htmlFor="courseId">
          Course
        </label>
        <select
          className="h-11 flex-1 rounded-xl border bg-background px-3 text-sm"
          id="courseId"
          name="courseId"
          defaultValue={selectedCourseId}
        >
          {courseRows.map((course) => (
            <option key={course.id} value={course.id}>
              {course.title}
            </option>
          ))}
        </select>
        <Button type="submit" variant="outline">
          Open course
        </Button>
      </form>

      {selectedCourseId ? (
        <div className="mt-8 grid gap-6 lg:grid-cols-[360px_1fr]">
          <div className="space-y-6">
            <section className="rounded-2xl border bg-card p-6 shadow-soft">
              <p className="font-mono text-[10px] uppercase text-muted-foreground">Modules</p>
              <h2 className="mt-3 text-lg font-semibold">Add module</h2>
              <form action={createModuleAction} className="mt-5 space-y-4">
                <input name="courseId" type="hidden" value={selectedCourseId} />
                <label className="block text-sm font-medium" htmlFor="moduleTitle">
                  Module title
                </label>
                <input className="h-11 w-full rounded-xl border bg-background px-3 text-sm" id="moduleTitle" name="title" required />
                <label className="block text-sm font-medium" htmlFor="moduleDescription">
                  Module description
                </label>
                <textarea className="min-h-24 w-full rounded-xl border bg-background px-3 py-2 text-sm" id="moduleDescription" name="description" />
                <label className="block text-sm font-medium" htmlFor="moduleSortOrder">
                  Module sort order
                </label>
                <input className="h-11 w-full rounded-xl border bg-background px-3 text-sm" id="moduleSortOrder" min={0} name="sortOrder" type="number" />
                <Button type="submit" variant="gradient">
                  Add module
                </Button>
              </form>
            </section>

            <section className="rounded-2xl border bg-card p-6 shadow-soft">
              <p className="font-mono text-[10px] uppercase text-muted-foreground">Materials</p>
              <h2 className="mt-3 text-lg font-semibold">Add material</h2>
              <form action={createMaterialAction} className="mt-5 space-y-4">
                <input name="courseId" type="hidden" value={selectedCourseId} />
                <label className="block text-sm font-medium" htmlFor="materialTitle">
                  Material title
                </label>
                <input className="h-11 w-full rounded-xl border bg-background px-3 text-sm" id="materialTitle" name="title" required />
                <label className="block text-sm font-medium" htmlFor="materialModule">
                  Material module
                </label>
                <select className="h-11 w-full rounded-xl border bg-background px-3 text-sm" id="materialModule" name="moduleId">
                  <option value="">Ungrouped</option>
                  {content.modules.map((module) => (
                    <option key={module.id} value={module.id}>
                      {module.title}
                    </option>
                  ))}
                </select>
                <label className="block text-sm font-medium" htmlFor="materialType">
                  Material type
                </label>
                <select className="h-11 w-full rounded-xl border bg-background px-3 text-sm" id="materialType" name="type" defaultValue="lecture">
                  <option value="lecture">Lecture</option>
                  <option value="study">Study</option>
                  <option value="lesson_plan">Lesson plan</option>
                  <option value="worksheet">Worksheet</option>
                </select>
                <label className="block text-sm font-medium" htmlFor="materialVisibility">
                  Material visibility
                </label>
                <select className="h-11 w-full rounded-xl border bg-background px-3 text-sm" id="materialVisibility" name="visibility" defaultValue="students">
                  <option value="students">Students</option>
                  <option value="tutor_only">Tutor only</option>
                </select>
                <input name="status" type="hidden" value="draft" />
                <input name="sortOrder" type="hidden" value={content.materials.length} />
                <MarkdownEditor id="materialBody" label="Material body" name="bodyMd" />
                <Button type="submit" variant="gradient">
                  Add material
                </Button>
              </form>
            </section>
          </div>

          <section className="space-y-4">
            <h2 className="text-lg font-semibold">Course outline</h2>
            {content.modules.map((module) => (
              <article className="rounded-2xl border bg-card p-5 shadow-soft" key={module.id}>
                <form action={updateModuleAction} className="grid gap-3 md:grid-cols-[1fr_90px_120px_auto]">
                  <input name="courseId" type="hidden" value={selectedCourseId} />
                  <input name="id" type="hidden" value={module.id} />
                  <input aria-label={`Title for ${module.title}`} className="h-10 rounded-xl border bg-background px-3 text-sm" name="title" defaultValue={module.title} />
                  <input aria-label={`Sort order for ${module.title}`} className="h-10 rounded-xl border bg-background px-3 text-sm" min={0} name="sortOrder" defaultValue={module.sortOrder} type="number" />
                  <select aria-label={`Status for ${module.title}`} className="h-10 rounded-xl border bg-background px-3 text-sm" name="status" defaultValue={module.status}>
                    <option value="draft">Draft</option>
                    <option value="published">Published</option>
                  </select>
                  <input name="description" type="hidden" value={module.description ?? ""} />
                  <Button size="sm" type="submit">
                    Save module
                  </Button>
                </form>
              </article>
            ))}
            {content.materials.map((material) => (
              <article className="rounded-2xl border bg-card p-5 shadow-soft" key={material.id}>
                <details>
                  <summary className="cursor-pointer text-lg font-semibold">{material.title}</summary>
                  <div className="mt-3 flex flex-wrap gap-2 text-xs font-medium">
                    <span className="rounded-full bg-muted px-3 py-1">{material.type}</span>
                    <span className="rounded-full bg-muted px-3 py-1">{material.status}</span>
                    <span className="rounded-full bg-muted px-3 py-1">{material.visibility}</span>
                  </div>
                  <div
                    className="mt-4 rounded-xl border bg-background p-4"
                    dangerouslySetInnerHTML={{ __html: renderMarkdown(material.bodyMd) }}
                  />
                  <form action={updateMaterialAction} className="mt-5 space-y-4">
                    <input name="courseId" type="hidden" value={selectedCourseId} />
                    <input name="id" type="hidden" value={material.id} />
                    <label className="block text-sm font-medium" htmlFor={`title-${material.id}`}>
                      Material title
                    </label>
                    <input className="h-10 w-full rounded-xl border bg-background px-3 text-sm" id={`title-${material.id}`} name="title" defaultValue={material.title} />
                    <div className="grid gap-3 md:grid-cols-4">
                      <select aria-label={`Module for ${material.title}`} className="h-10 rounded-xl border bg-background px-3 text-sm" name="moduleId" defaultValue={material.moduleId ?? ""}>
                        <option value="">Ungrouped</option>
                        {content.modules.map((module) => (
                          <option key={module.id} value={module.id}>
                            {module.title}
                          </option>
                        ))}
                      </select>
                      <select aria-label={`Type for ${material.title}`} className="h-10 rounded-xl border bg-background px-3 text-sm" name="type" defaultValue={material.type}>
                        <option value="lecture">Lecture</option>
                        <option value="study">Study</option>
                        <option value="lesson_plan">Lesson plan</option>
                        <option value="worksheet">Worksheet</option>
                      </select>
                      <select aria-label={`Visibility for ${material.title}`} className="h-10 rounded-xl border bg-background px-3 text-sm" name="visibility" defaultValue={material.visibility}>
                        <option value="students">Students</option>
                        <option value="tutor_only">Tutor only</option>
                      </select>
                      <input aria-label={`Sort order for ${material.title}`} className="h-10 rounded-xl border bg-background px-3 text-sm" min={0} name="sortOrder" defaultValue={material.sortOrder} type="number" />
                    </div>
                    <select aria-label={`Status for ${material.title}`} className="h-10 rounded-xl border bg-background px-3 text-sm" name="status" defaultValue={material.status}>
                      <option value="draft">Draft</option>
                      <option value="published">Published</option>
                    </select>
                    <MarkdownEditor id={`body-${material.id}`} label="Material body" name="bodyMd" defaultValue={material.bodyMd} />
                    <Button type="submit">Save material</Button>
                  </form>
                </details>
              </article>
            ))}
          </section>
        </div>
      ) : (
        <div className="mt-8 rounded-2xl border bg-card p-8 text-center shadow-soft">
          <p className="font-display text-2xl italic">Create a course before adding content.</p>
        </div>
      )}
    </main>
  );
}
