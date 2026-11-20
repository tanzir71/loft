import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { getDb } from "@/db";
import { Button } from "@/components/ui/button";
import { QuizAttempt } from "@/components/quiz-attempt";
import { requireUser } from "@/lib/authz";
import {
  getQuizAttemptFlow,
  getStudentQuizOverview,
  getStudentQuizResult,
  parseQuestionOptions,
  startQuizAttempt,
  submitQuizAttempt,
} from "@/lib/quizzes";
import { renderMarkdown } from "@/lib/markdown";
import { roleHomePath } from "@/lib/session-routing";

export const metadata: Metadata = {
  title: "Quiz",
};

async function startAttemptAction(formData: FormData) {
  "use server";

  const user = await requireUser();

  if (user.role !== "student") {
    redirect(roleHomePath(user.role));
  }

  const quizId = String(formData.get("quizId") ?? "");
  const attempt = await startQuizAttempt(getDb(), {
    quizId,
    studentId: user.id,
  });

  redirect(`/quiz/${quizId}?attemptId=${attempt.id}`);
}

async function submitAttemptAction(formData: FormData) {
  "use server";

  const user = await requireUser();

  if (user.role !== "student") {
    redirect(roleHomePath(user.role));
  }

  const quizId = String(formData.get("quizId") ?? "");
  await submitQuizAttempt(getDb(), {
    attemptId: String(formData.get("attemptId") ?? ""),
    studentId: user.id,
  });

  redirect(`/quiz/${quizId}?submitted=1&resultAttemptId=${formData.get("attemptId") ?? ""}`);
}

export default async function StudentQuizPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ attemptId?: string; resultAttemptId?: string; submitted?: string }>;
}) {
  const user = await requireUser();

  if (user.role !== "student") {
    redirect(roleHomePath(user.role));
  }

  const { id } = await params;
  const query = await searchParams;

  if (query.resultAttemptId) {
    let result;

    try {
      result = await getStudentQuizResult(getDb(), {
        attemptId: query.resultAttemptId,
        studentId: user.id,
      });
    } catch {
      notFound();
    }

    return (
      <main className="mx-auto max-w-4xl p-6">
        <p className="font-mono text-[10px] uppercase text-muted-foreground">Submitted</p>
        <h1 className="mt-2 font-display text-3xl italic">{result.quiz.title}</h1>
        <div className="mt-5 rounded-2xl border bg-card p-5 shadow-soft">
          <p className="text-sm text-muted-foreground">Score</p>
          <p className="mt-2 font-mono text-3xl">
            {result.attempt.finalScore ?? result.attempt.autoScore ?? 0}
          </p>
        </div>
        <div className="mt-5 grid gap-3">
          {result.answers.map((answer) => (
            <article className="rounded-2xl border bg-card p-5 shadow-soft" key={answer.answerId}>
              <div dangerouslySetInnerHTML={{ __html: renderMarkdown(answer.promptMd) }} />
              <p className="mt-3 text-sm text-muted-foreground">
                {answer.pointsAwarded ?? 0} of {answer.points} points
              </p>
            </article>
          ))}
        </div>
      </main>
    );
  }

  if (query.attemptId) {
    let flow;

    try {
      flow = await getQuizAttemptFlow(getDb(), {
        attemptId: query.attemptId,
        quizId: id,
        studentId: user.id,
      });
    } catch {
      notFound();
    }

    return (
      <main className="mx-auto max-w-4xl p-6">
        <h1 className="font-display text-3xl italic">{flow.quiz.title}</h1>
        <QuizAttempt
          answersByQuestion={Object.fromEntries(
            Object.entries(flow.answersByQuestion).map(([questionId, answer]) => [
              questionId,
              answer.answerJson,
            ]),
          )}
          attemptId={flow.attempt.id}
          quizId={id}
          remainingSeconds={flow.remainingSeconds}
          questions={flow.questions.map((question) => {
            const options =
              question.type === "mcq_single" || question.type === "mcq_multi"
                ? parseQuestionOptions(question.type, question.optionsJson)?.options ?? null
                : null;

            return {
              id: question.id,
              options,
              promptHtml: renderMarkdown(question.promptMd),
              type: question.type,
            };
          })}
        />
        <form action={submitAttemptAction} className="mt-6">
          <input name="quizId" type="hidden" value={id} />
          <input name="attemptId" type="hidden" value={flow.attempt.id} />
          <Button type="submit" variant="gradient">
            Submit quiz
          </Button>
        </form>
      </main>
    );
  }

  let overview;

  try {
    overview = await getStudentQuizOverview(getDb(), {
      quizId: id,
      studentId: user.id,
    });
  } catch {
    notFound();
  }

  return (
    <main className="mx-auto max-w-3xl p-6">
      <p className="font-mono text-[10px] uppercase text-muted-foreground">Quiz</p>
      <h1 className="mt-2 font-display text-3xl italic">{overview.quiz.title}</h1>
      {query.submitted ? (
        <div className="mt-5 rounded-2xl border bg-card p-4 shadow-soft">
          <p className="font-semibold">Submitted</p>
        </div>
      ) : null}
      <div
        className="mt-5 rounded-2xl border bg-card p-5 shadow-soft"
        dangerouslySetInnerHTML={{ __html: renderMarkdown(overview.quiz.instructionsMd) }}
      />
      <div className="mt-5 grid gap-3 rounded-2xl border bg-card p-5 shadow-soft sm:grid-cols-3">
        <div>
          <p className="text-xs uppercase text-muted-foreground">Attempts</p>
          <p className="mt-1 font-semibold">
            {overview.attemptsUsed} of {overview.quiz.maxAttempts}
          </p>
        </div>
        <div>
          <p className="text-xs uppercase text-muted-foreground">Timer</p>
          <p className="mt-1 font-semibold">
            {overview.quiz.timeLimitMin ? `${overview.quiz.timeLimitMin} min` : "No limit"}
          </p>
        </div>
        <div>
          <p className="text-xs uppercase text-muted-foreground">Status</p>
          <p className="mt-1 font-semibold">{overview.unavailableReason ?? "Ready"}</p>
        </div>
      </div>
      {overview.inProgressAttempt ? (
        <Button asChild className="mt-5" variant="gradient">
          <a href={`/quiz/${id}?attemptId=${overview.inProgressAttempt.id}`}>Resume quiz</a>
        </Button>
      ) : (
        <form action={startAttemptAction} className="mt-5">
          <input name="quizId" type="hidden" value={id} />
          <Button disabled={overview.unavailableReason !== null} type="submit" variant="gradient">
            Start quiz
          </Button>
        </form>
      )}
    </main>
  );
}
