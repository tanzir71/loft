import { getDb } from "@/db";
import { AuthzError, requireTutor } from "@/lib/authz";
import { getTutorMaterial, lessonPlanToMarkdown } from "@/lib/content";

function markdownFilename(title: string) {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");

  return `${slug || "lesson-plan"}.md`;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireTutor();
  } catch (error) {
    if (error instanceof AuthzError) {
      return new Response(error.message, { status: error.status });
    }

    throw error;
  }

  const { id } = await params;

  try {
    const material = await getTutorMaterial(getDb(), id);

    if (material.type !== "lesson_plan") {
      return new Response("Not found", { status: 404 });
    }

    return new Response(lessonPlanToMarkdown(material.title, material.bodyMd, material.planJson), {
      headers: {
        "Content-Disposition": `attachment; filename="${markdownFilename(material.title)}"`,
        "Content-Type": "text/markdown; charset=utf-8",
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
