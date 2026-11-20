import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { getDb } from "@/db";
import { PrintButton } from "@/components/print-button";
import { Button } from "@/components/ui/button";
import { requireTutor } from "@/lib/authz";
import { getTutorMaterial, lessonPlanSections } from "@/lib/content";
import { renderMarkdown } from "@/lib/markdown";

export const metadata: Metadata = {
  title: "Print lesson plan",
};

export default async function PrintLessonPlanPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireTutor();
  const { id } = await params;
  let material;

  try {
    material = await getTutorMaterial(getDb(), id);
  } catch {
    notFound();
  }

  if (material.type !== "lesson_plan") {
    notFound();
  }

  const sections = lessonPlanSections(material.planJson).filter(
    (section) => section.enabled && section.body.trim(),
  );

  return (
    <main className="mx-auto max-w-3xl p-6 print:p-0">
      <div className="mb-6 flex flex-wrap gap-2 print:hidden">
        <Button asChild variant="outline">
          <a href={`/content?courseId=${material.courseId}`}>Back to content</a>
        </Button>
        <PrintButton />
      </div>
      <article className="space-y-6">
        <header>
          <p className="font-mono text-[10px] uppercase text-muted-foreground">Lesson plan</p>
          <h1 className="mt-2 font-display text-4xl italic">{material.title}</h1>
        </header>
        {sections.map((section) => (
          <section key={section.id}>
            <h2 className="text-lg font-semibold">{section.title}</h2>
            <p className="mt-2 whitespace-pre-wrap text-sm leading-6">{section.body}</p>
          </section>
        ))}
        {material.bodyMd.trim() ? (
          <section>
            <h2 className="text-lg font-semibold">Notes</h2>
            <div
              className="prose-sm mt-2"
              dangerouslySetInnerHTML={{ __html: renderMarkdown(material.bodyMd) }}
            />
          </section>
        ) : null}
      </article>
    </main>
  );
}
