import { getDb } from "@/db";
import { AuthzError, requireTutor } from "@/lib/authz";
import { quizResultsCsv } from "@/lib/quizzes";

export async function GET(request: Request) {
  try {
    await requireTutor();
  } catch (error) {
    if (error instanceof AuthzError) {
      return new Response(error.message, { status: error.status });
    }

    throw error;
  }

  const url = new URL(request.url);
  const courseId = url.searchParams.get("courseId") ?? undefined;
  const csv = await quizResultsCsv(getDb(), { courseId });

  return new Response(csv, {
    headers: {
      "Content-Disposition": 'attachment; filename="quiz-results.csv"',
      "Content-Type": "text/csv; charset=utf-8",
    },
  });
}
