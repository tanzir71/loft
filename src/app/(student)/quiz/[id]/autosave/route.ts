import { getDb } from "@/db";
import { AuthzError, requireUser } from "@/lib/authz";
import { saveQuizAnswer } from "@/lib/quizzes";

export async function POST(request: Request) {
  const user = await requireUser();

  if (user.role !== "student") {
    return new Response("Student access required", { status: 403 });
  }

  try {
    const body = await request.json();
    const answer = await saveQuizAnswer(getDb(), {
      answerJson: body.answerJson,
      attemptId: String(body.attemptId ?? ""),
      questionId: String(body.questionId ?? ""),
      studentId: user.id,
    });

    return Response.json({ answer });
  } catch (error) {
    if (error instanceof AuthzError) {
      return new Response(error.message, { status: error.status });
    }

    return new Response(error instanceof Error ? error.message : "Unable to save answer", {
      status: 400,
    });
  }
}
