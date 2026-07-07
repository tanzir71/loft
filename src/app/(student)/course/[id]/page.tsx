import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { getDb } from "@/db";
import { requireUser } from "@/lib/authz";
import { listStudentVisibleMaterials } from "@/lib/content";
import { renderMarkdown } from "@/lib/markdown";
import { roleHomePath } from "@/lib/session-routing";

export const metadata: Metadata = {
  title: "Course",
};

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
  let materials;

  try {
    materials = await listStudentVisibleMaterials(getDb(), {
      courseId: id,
      studentId: user.id,
    });
  } catch {
    notFound();
  }

  return (
    <main className="mx-auto max-w-3xl p-6">
      <h1 className="font-display text-3xl italic">Course</h1>
      <section className="mt-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Curriculum</h2>
          <span className="font-mono text-[10px] uppercase text-muted-foreground">
            {materials.length} materials
          </span>
        </div>
        {materials.length === 0 ? (
          <div className="rounded-2xl border bg-card p-8 text-center shadow-soft">
            <p className="font-display text-2xl italic">No published materials yet.</p>
          </div>
        ) : (
          <div className="grid gap-3">
            {materials.map((material) => (
              <article className="rounded-2xl border bg-card p-5 shadow-soft" key={material.id}>
                <p className="font-mono text-[10px] uppercase text-muted-foreground">
                  {material.type}
                </p>
                <h3 className="mt-2 text-lg font-semibold">{material.title}</h3>
                <div
                  className="mt-4 rounded-xl border bg-background p-4"
                  dangerouslySetInnerHTML={{ __html: renderMarkdown(material.bodyMd) }}
                />
              </article>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
