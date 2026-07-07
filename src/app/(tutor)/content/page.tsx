import { asc, eq } from "drizzle-orm";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { getDb } from "@/db";
import { courses } from "@/db/schema";
import { Button } from "@/components/ui/button";
import { MarkdownEditor } from "@/components/markdown-editor";
import { requireTutor } from "@/lib/authz";
import {
  addMaterialLink,
  createMaterial,
  createModule,
  courseProgressMatrix,
  duplicateMaterial,
  duplicateModule,
  lessonPlanSectionDefinitions,
  lessonPlanSections,
  listCourseContent,
  updateMaterial,
  updateModule,
} from "@/lib/content";
import { youtubeEmbedUrl, safeEmbedUrl } from "@/lib/embeds";
import { hasBlob } from "@/lib/features";
import { renderMarkdown } from "@/lib/markdown";
import {
  bulkImportStandards,
  courseCoverageMatrix,
  createStandard,
  listStandards,
  materialStandardIdsByMaterial,
  tagMaterialStandards,
  updateStandard,
} from "@/lib/standards";

export const metadata: Metadata = {
  title: "Content",
};

function numberValue(value: FormDataEntryValue | null, fallback = 0) {
  const parsed = Number(value ?? fallback);
  return Number.isFinite(parsed) ? parsed : fallback;
}

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

function materialType(value: FormDataEntryValue | null) {
  const raw = String(value ?? "");
  return raw === "study" || raw === "lesson_plan" || raw === "worksheet" ? raw : "lecture";
}

function visibility(value: FormDataEntryValue | null) {
  return String(value ?? "") === "tutor_only" ? "tutor_only" : "students";
}

function linkKind(value: FormDataEntryValue | null) {
  const raw = String(value ?? "");
  return raw === "youtube" || raw === "pdf" ? raw : "link";
}

function boolValue(value: FormDataEntryValue | null) {
  return String(value ?? "") === "true";
}

function standardIds(formData: FormData) {
  return formData
    .getAll("standardId")
    .map((value) => String(value))
    .filter(Boolean);
}

function lessonPlanFromForm(formData: FormData) {
  return {
    sections: lessonPlanSectionDefinitions.map((section) => ({
      body: String(formData.get(`planSection:${section.id}:body`) ?? ""),
      enabled: formData.get(`planSection:${section.id}:enabled`) === "on",
      id: section.id,
      title: section.title,
    })),
  };
}

function LessonPlanFields({ idPrefix, planJson }: { idPrefix: string; planJson?: unknown }) {
  const savedSections = new Map(lessonPlanSections(planJson).map((section) => [section.id, section]));

  return (
    <details className="rounded-xl border bg-background p-4" open>
      <summary className="cursor-pointer text-sm font-semibold">Lesson plan sections</summary>
      <div className="mt-4 grid gap-4">
        {lessonPlanSectionDefinitions.map((section) => {
          const saved = savedSections.get(section.id);
          const fieldId = `${idPrefix}-${section.id}`;

          return (
            <div className="grid gap-2" key={section.id}>
              <label className="flex items-center gap-2 text-sm font-medium" htmlFor={fieldId}>
                <input
                  className="h-4 w-4 rounded border"
                  defaultChecked={saved?.enabled ?? section.id !== "notes"}
                  name={`planSection:${section.id}:enabled`}
                  type="checkbox"
                />
                {section.title}
              </label>
              <textarea
                className="min-h-20 w-full rounded-xl border bg-card px-3 py-2 text-sm"
                defaultValue={saved?.body ?? ""}
                id={fieldId}
                name={`planSection:${section.id}:body`}
              />
            </div>
          );
        })}
      </div>
    </details>
  );
}

function StructuredLessonPlan({ planJson }: { planJson: unknown }) {
  const sections = lessonPlanSections(planJson).filter(
    (section) => section.enabled && section.body.trim(),
  );

  if (sections.length === 0) {
    return null;
  }

  return (
    <div className="mt-4 grid gap-3 rounded-xl border bg-background p-4">
      {sections.map((section) => (
        <section key={section.id}>
          <h4 className="text-sm font-semibold">{section.title}</h4>
          <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">{section.body}</p>
        </section>
      ))}
    </div>
  );
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
    planJson: lessonPlanFromForm(formData),
    publishAt: dateStart(formData.get("publishAt")),
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
    planJson: lessonPlanFromForm(formData),
    publishAt: dateStart(formData.get("publishAt")),
    sortOrder: numberValue(formData.get("sortOrder")),
    status: publishStatus(formData.get("status")),
    title: String(formData.get("title") ?? ""),
    type: materialType(formData.get("type")),
    visibility: visibility(formData.get("visibility")),
  });

  redirect(`/content?courseId=${formData.get("courseId") ?? ""}`);
}

async function duplicateModuleAction(formData: FormData) {
  "use server";

  await requireTutor();
  await duplicateModule(getDb(), {
    id: String(formData.get("id") ?? ""),
    targetCourseId: String(formData.get("targetCourseId") ?? ""),
  });

  redirect(`/content?courseId=${formData.get("courseId") ?? ""}`);
}

async function duplicateMaterialAction(formData: FormData) {
  "use server";

  await requireTutor();
  await duplicateMaterial(getDb(), {
    id: String(formData.get("id") ?? ""),
    targetCourseId: String(formData.get("targetCourseId") ?? ""),
  });

  redirect(`/content?courseId=${formData.get("courseId") ?? ""}`);
}

async function addMaterialLinkAction(formData: FormData) {
  "use server";

  await requireTutor();
  await addMaterialLink(getDb(), {
    kind: linkKind(formData.get("kind")),
    label: String(formData.get("label") ?? ""),
    materialId: String(formData.get("materialId") ?? ""),
    url: String(formData.get("url") ?? ""),
  });

  redirect(`/content?courseId=${formData.get("courseId") ?? ""}`);
}

async function createStandardAction(formData: FormData) {
  "use server";

  await requireTutor();
  await createStandard(getDb(), {
    code: String(formData.get("code") ?? ""),
    description: String(formData.get("description") ?? ""),
    framework: String(formData.get("framework") ?? ""),
  });

  redirect(`/content?courseId=${formData.get("courseId") ?? ""}`);
}

async function updateStandardAction(formData: FormData) {
  "use server";

  await requireTutor();
  await updateStandard(getDb(), {
    active: boolValue(formData.get("active")),
    code: String(formData.get("code") ?? ""),
    description: String(formData.get("description") ?? ""),
    framework: String(formData.get("framework") ?? ""),
    id: String(formData.get("id") ?? ""),
  });

  redirect(`/content?courseId=${formData.get("courseId") ?? ""}`);
}

async function bulkImportStandardsAction(formData: FormData) {
  "use server";

  await requireTutor();
  await bulkImportStandards(getDb(), {
    defaultFramework: String(formData.get("defaultFramework") ?? "") || undefined,
    text: String(formData.get("text") ?? ""),
  });

  redirect(`/content?courseId=${formData.get("courseId") ?? ""}`);
}

async function tagMaterialStandardsAction(formData: FormData) {
  "use server";

  await requireTutor();
  await tagMaterialStandards(getDb(), {
    materialId: String(formData.get("materialId") ?? ""),
    standardIds: standardIds(formData),
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
    : { completionCounts: {}, linksByMaterial: {}, materials: [], modules: [] };
  const standardsRows = await listStandards(getDb());
  const activeStandards = standardsRows.filter((standard) => standard.active);
  const coverageRows = selectedCourseId ? await courseCoverageMatrix(getDb(), selectedCourseId) : [];
  const progressMatrix = selectedCourseId
    ? await courseProgressMatrix(getDb(), selectedCourseId)
    : { materials: [], rows: [], students: [] };
  const materialStandardTags: Record<string, string[]> = selectedCourseId
    ? await materialStandardIdsByMaterial(
        getDb(),
        content.materials.map((material) => material.id),
      )
    : {};
  const blobEnabled = hasBlob();

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
                <label className="block text-sm font-medium" htmlFor="materialPublishAt">
                  Material publish date
                </label>
                <input
                  className="h-11 w-full rounded-xl border bg-background px-3 text-sm"
                  id="materialPublishAt"
                  name="publishAt"
                  type="date"
                />
                <input name="status" type="hidden" value="draft" />
                <input name="sortOrder" type="hidden" value={content.materials.length} />
                <LessonPlanFields idPrefix="new-plan" />
                <MarkdownEditor id="materialBody" label="Material body" name="bodyMd" />
                <p className="text-xs text-muted-foreground">
                  {blobEnabled
                    ? "Blob image upload is enabled when @vercel/blob is available; use material links for images until the upload package is installed."
                    : "Set BLOB_READ_WRITE_TOKEN to enable image upload. Until then, add image URLs as material links."}
                </p>
                <Button type="submit" variant="gradient">
                  Add material
                </Button>
              </form>
            </section>

            <section className="rounded-2xl border bg-card p-6 shadow-soft">
              <p className="font-mono text-[10px] uppercase text-muted-foreground">Standards</p>
              <h2 className="mt-3 text-lg font-semibold">Add standard</h2>
              <form action={createStandardAction} className="mt-5 space-y-4">
                <input name="courseId" type="hidden" value={selectedCourseId} />
                <label className="block text-sm font-medium" htmlFor="standardFramework">
                  Framework
                </label>
                <input className="h-11 w-full rounded-xl border bg-background px-3 text-sm" id="standardFramework" name="framework" required />
                <label className="block text-sm font-medium" htmlFor="standardCode">
                  Code
                </label>
                <input className="h-11 w-full rounded-xl border bg-background px-3 text-sm" id="standardCode" name="code" required />
                <label className="block text-sm font-medium" htmlFor="standardDescription">
                  Description
                </label>
                <textarea className="min-h-24 w-full rounded-xl border bg-background px-3 py-2 text-sm" id="standardDescription" name="description" required />
                <Button type="submit" variant="gradient">
                  Add standard
                </Button>
              </form>
              <form action={bulkImportStandardsAction} className="mt-6 space-y-4">
                <input name="courseId" type="hidden" value={selectedCourseId} />
                <label className="block text-sm font-medium" htmlFor="bulkFramework">
                  Default framework
                </label>
                <input className="h-11 w-full rounded-xl border bg-background px-3 text-sm" id="bulkFramework" name="defaultFramework" />
                <label className="block text-sm font-medium" htmlFor="bulkStandards">
                  Bulk import
                </label>
                <textarea className="min-h-28 w-full rounded-xl border bg-background px-3 py-2 text-sm" id="bulkStandards" name="text" required />
                <Button type="submit" variant="outline">
                  Import standards
                </Button>
              </form>
              <div className="mt-6 grid gap-3">
                {standardsRows.map((standard) => (
                  <form action={updateStandardAction} className="grid gap-2 rounded-xl border bg-background p-3" key={standard.id}>
                    <input name="courseId" type="hidden" value={selectedCourseId} />
                    <input name="id" type="hidden" value={standard.id} />
                    <input aria-label={`Framework for ${standard.code}`} className="h-9 rounded-lg border bg-card px-3 text-sm" name="framework" defaultValue={standard.framework} />
                    <input aria-label={`Code for ${standard.code}`} className="h-9 rounded-lg border bg-card px-3 text-sm" name="code" defaultValue={standard.code} />
                    <textarea aria-label={`Description for ${standard.code}`} className="min-h-16 rounded-lg border bg-card px-3 py-2 text-sm" name="description" defaultValue={standard.description} />
                    <select aria-label={`Active state for ${standard.code}`} className="h-9 rounded-lg border bg-card px-3 text-sm" name="active" defaultValue={String(standard.active)}>
                      <option value="true">Active</option>
                      <option value="false">Inactive</option>
                    </select>
                    <Button size="sm" type="submit">
                      Save standard
                    </Button>
                  </form>
                ))}
              </div>
            </section>
          </div>

          <section className="space-y-4">
            <section className="rounded-2xl border bg-card p-5 shadow-soft">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-lg font-semibold">Coverage matrix</h2>
                <span className="font-mono text-[10px] uppercase text-muted-foreground">
                  {coverageRows.filter((row) => row.gap).length} gaps
                </span>
              </div>
              {coverageRows.length === 0 ? (
                <p className="text-sm text-muted-foreground">No active standards.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-left text-sm">
                    <thead className="text-xs uppercase text-muted-foreground">
                      <tr>
                        <th className="border-b py-2 pr-3">Standard</th>
                        <th className="border-b py-2 pr-3">Materials</th>
                        <th className="border-b py-2 pr-3">Quizzes</th>
                        <th className="border-b py-2">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {coverageRows.map((row) => (
                        <tr className={row.gap ? "bg-destructive/10" : ""} key={row.id}>
                          <td className="border-b py-3 pr-3 align-top">
                            <span className="font-semibold">
                              {row.framework} {row.code}
                            </span>
                            <p className="mt-1 text-xs text-muted-foreground">{row.description}</p>
                          </td>
                          <td className="border-b py-3 pr-3 align-top">
                            {row.materialTitles.join(", ") || "-"}
                          </td>
                          <td className="border-b py-3 pr-3 align-top">
                            {row.quizTitles.join(", ") || "-"}
                          </td>
                          <td className="border-b py-3 align-top">
                            <span className={row.gap ? "font-semibold text-destructive" : "font-semibold text-primary"}>
                              {row.gap ? "Gap" : "Covered"}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
            <section className="rounded-2xl border bg-card p-5 shadow-soft">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-lg font-semibold">Progress matrix</h2>
                <span className="font-mono text-[10px] uppercase text-muted-foreground">
                  {progressMatrix.rows.length} students
                </span>
              </div>
              {progressMatrix.rows.length === 0 || progressMatrix.materials.length === 0 ? (
                <p className="text-sm text-muted-foreground">No student progress yet.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full border-collapse text-left text-sm">
                    <thead className="text-xs uppercase text-muted-foreground">
                      <tr>
                        <th className="border-b py-2 pr-3">Student</th>
                        {progressMatrix.materials.map((material) => (
                          <th className="border-b py-2 pr-3" key={material.id}>
                            {material.title}
                          </th>
                        ))}
                        <th className="border-b py-2">Complete</th>
                      </tr>
                    </thead>
                    <tbody>
                      {progressMatrix.rows.map((row) => {
                        const percent =
                          row.totalCount > 0
                            ? Math.round((row.completedCount / row.totalCount) * 100)
                            : 0;

                        return (
                          <tr key={row.student.id}>
                            <td className="border-b py-3 pr-3 align-top font-medium">
                              {row.student.name}
                            </td>
                            {row.cells.map((cell) => (
                              <td className="border-b py-3 pr-3 align-top" key={cell.materialId}>
                                <span
                                  className={
                                    cell.completed
                                      ? "font-semibold text-primary"
                                      : "text-muted-foreground"
                                  }
                                >
                                  {cell.completed ? "Done" : "Open"}
                                </span>
                              </td>
                            ))}
                            <td className="border-b py-3 align-top font-semibold">{percent}%</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
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
                <form action={duplicateModuleAction} className="mt-3 flex flex-wrap gap-2">
                  <input name="courseId" type="hidden" value={selectedCourseId} />
                  <input name="id" type="hidden" value={module.id} />
                  <label className="sr-only" htmlFor={`duplicate-module-${module.id}`}>
                    Duplicate module target
                  </label>
                  <select
                    className="h-9 rounded-lg border bg-background px-3 text-sm"
                    id={`duplicate-module-${module.id}`}
                    name="targetCourseId"
                    defaultValue={selectedCourseId}
                  >
                    {courseRows.map((course) => (
                      <option key={course.id} value={course.id}>
                        {course.title}
                      </option>
                    ))}
                  </select>
                  <Button
                    aria-label={`Duplicate module ${module.title}`}
                    size="sm"
                    type="submit"
                    variant="outline"
                  >
                    Duplicate module
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
                    <span className="rounded-full bg-muted px-3 py-1">
                      {content.completionCounts[material.id] ?? 0} completed
                    </span>
                  </div>
                  <div
                    className="mt-4 rounded-xl border bg-background p-4"
                    dangerouslySetInnerHTML={{ __html: renderMarkdown(material.bodyMd) }}
                  />
                  {material.type === "lesson_plan" ? (
                    <>
                      <StructuredLessonPlan planJson={material.planJson} />
                      <div className="mt-4 flex flex-wrap gap-2">
                        <Button asChild size="sm" variant="outline">
                          <a href={`/content/materials/${material.id}/print`}>Print</a>
                        </Button>
                        <Button asChild size="sm" variant="outline">
                          <a href={`/content/materials/${material.id}/download`}>Download .md</a>
                        </Button>
                      </div>
                    </>
                  ) : null}
                  <div className="mt-4 grid gap-3">
                    {(content.linksByMaterial[material.id] ?? []).map((link) => {
                      const youtubeUrl = link.kind === "youtube" ? youtubeEmbedUrl(link.url) : null;
                      const safeUrl = safeEmbedUrl(link.url);

                      if (youtubeUrl) {
                        return (
                          <iframe
                            allowFullScreen
                            className="aspect-video w-full rounded-xl border"
                            key={link.id}
                            src={youtubeUrl}
                            title={link.label}
                          />
                        );
                      }

                      if (link.kind === "pdf" && safeUrl) {
                        return (
                          <iframe
                            className="h-72 w-full rounded-xl border"
                            key={link.id}
                            src={safeUrl}
                            title={link.label}
                          />
                        );
                      }

                      return safeUrl ? (
                        <a
                          className="rounded-xl border bg-background px-4 py-3 text-sm font-medium text-primary underline"
                          href={safeUrl}
                          key={link.id}
                          rel="noreferrer"
                          target="_blank"
                        >
                          {link.label}
                        </a>
                      ) : null;
                    })}
                  </div>
                  <form action={addMaterialLinkAction} className="mt-5 grid gap-3 md:grid-cols-[1fr_1fr_120px_auto]">
                    <input name="courseId" type="hidden" value={selectedCourseId} />
                    <input name="materialId" type="hidden" value={material.id} />
                    <input
                      aria-label={`Link label for ${material.title}`}
                      className="h-10 rounded-xl border bg-background px-3 text-sm"
                      name="label"
                      placeholder="Link label"
                      required
                    />
                    <input
                      aria-label={`Link URL for ${material.title}`}
                      className="h-10 rounded-xl border bg-background px-3 text-sm"
                      name="url"
                      placeholder="https://..."
                      required
                      type="url"
                    />
                    <select
                      aria-label={`Link kind for ${material.title}`}
                      className="h-10 rounded-xl border bg-background px-3 text-sm"
                      name="kind"
                      defaultValue="link"
                    >
                      <option value="link">Link</option>
                      <option value="youtube">YouTube</option>
                      <option value="pdf">PDF</option>
                    </select>
                    <Button size="sm" type="submit" variant="outline">
                      Add link
                    </Button>
                  </form>
                  <form action={tagMaterialStandardsAction} className="mt-5 rounded-xl border bg-background p-4">
                    <input name="courseId" type="hidden" value={selectedCourseId} />
                    <input name="materialId" type="hidden" value={material.id} />
                    <p className="text-sm font-semibold">Standards</p>
                    {activeStandards.length === 0 ? (
                      <p className="mt-2 text-sm text-muted-foreground">No active standards.</p>
                    ) : (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {activeStandards.map((standard) => (
                          <label className="flex items-center gap-2 rounded-full border bg-card px-3 py-2 text-xs font-medium" key={standard.id}>
                            <input
                              defaultChecked={(materialStandardTags[material.id] ?? []).includes(standard.id)}
                              name="standardId"
                              type="checkbox"
                              value={standard.id}
                            />
                            {standard.framework} {standard.code}
                          </label>
                        ))}
                      </div>
                    )}
                    <Button className="mt-3" size="sm" type="submit" variant="outline">
                      Save standards
                    </Button>
                  </form>
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
                    <input
                      aria-label={`Publish date for ${material.title}`}
                      className="h-10 rounded-xl border bg-background px-3 text-sm"
                      defaultValue={
                        material.publishAt
                          ? new Date(material.publishAt).toISOString().slice(0, 10)
                          : ""
                      }
                      name="publishAt"
                      type="date"
                    />
                    <select aria-label={`Status for ${material.title}`} className="h-10 rounded-xl border bg-background px-3 text-sm" name="status" defaultValue={material.status}>
                      <option value="draft">Draft</option>
                      <option value="published">Published</option>
                    </select>
                    <LessonPlanFields idPrefix={`plan-${material.id}`} planJson={material.planJson} />
                    <MarkdownEditor id={`body-${material.id}`} label="Material body" name="bodyMd" defaultValue={material.bodyMd} />
                    <Button type="submit">Save material</Button>
                  </form>
                  <form action={duplicateMaterialAction} className="mt-3 flex flex-wrap gap-2">
                    <input name="courseId" type="hidden" value={selectedCourseId} />
                    <input name="id" type="hidden" value={material.id} />
                    <label className="sr-only" htmlFor={`duplicate-material-${material.id}`}>
                      Duplicate material target
                    </label>
                    <select
                      className="h-9 rounded-lg border bg-background px-3 text-sm"
                      id={`duplicate-material-${material.id}`}
                      name="targetCourseId"
                      defaultValue={selectedCourseId}
                    >
                      {courseRows.map((course) => (
                        <option key={course.id} value={course.id}>
                          {course.title}
                        </option>
                      ))}
                    </select>
                    <Button
                      aria-label={`Duplicate material ${material.title}`}
                      size="sm"
                      type="submit"
                      variant="outline"
                    >
                      Duplicate material
                    </Button>
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
