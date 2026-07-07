import { asc, eq } from "drizzle-orm";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { getDb } from "@/db";
import { courses } from "@/db/schema";
import { Button } from "@/components/ui/button";
import { requireTutor } from "@/lib/authz";
import { renderMarkdown } from "@/lib/markdown";
import {
  answerSummary,
  createQuiz,
  createQuizQuestion,
  listQuizBuilder,
  parseQuestionOptions,
  updateQuiz,
  updateQuizQuestion,
} from "@/lib/quizzes";

export const metadata: Metadata = {
  title: "Quizzes",
};

type QuestionType = "mcq_single" | "mcq_multi" | "true_false" | "short_answer";

function numberValue(value: FormDataEntryValue | null, fallback: number) {
  const parsed = Number(value ?? fallback);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function nullableNumber(value: FormDataEntryValue | null) {
  const raw = String(value ?? "").trim();

  if (!raw) {
    return null;
  }

  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function quizStatus(value: FormDataEntryValue | null) {
  const raw = String(value ?? "");
  return raw === "published" || raw === "closed" ? raw : "draft";
}

function questionType(value: FormDataEntryValue | null): QuestionType {
  const raw = String(value ?? "");
  return raw === "mcq_multi" || raw === "true_false" || raw === "short_answer"
    ? raw
    : "mcq_single";
}

function parseOptionsText(value: FormDataEntryValue | null) {
  const options = String(value ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      const [first, ...rest] = line.split("|");

      return rest.length > 0
        ? { id: first.trim(), text: rest.join("|").trim() }
        : { id: String.fromCharCode(97 + index), text: line };
    });

  return { options };
}

function answerFromForm(type: QuestionType, formData: FormData) {
  if (type === "mcq_single") {
    return { correctOptionId: String(formData.get("correctOptionId") ?? "").trim() };
  }

  if (type === "mcq_multi") {
    return {
      correctOptionIds: String(formData.get("correctOptionIds") ?? "")
        .split(/[,\s]+/)
        .map((value) => value.trim())
        .filter(Boolean),
    };
  }

  if (type === "true_false") {
    return { value: String(formData.get("trueFalseAnswer") ?? "") === "true" };
  }

  return {
    acceptedAnswers: String(formData.get("acceptedAnswers") ?? "")
      .split(/\r?\n/)
      .map((value) => value.trim())
      .filter(Boolean),
  };
}

function optionsValue(type: QuestionType, optionsJson: unknown) {
  try {
    const parsed = parseQuestionOptions(type, optionsJson);
    return parsed?.options.map((option) => `${option.id}|${option.text}`).join("\n") ?? "";
  } catch {
    return "";
  }
}

function singleAnswerValue(type: QuestionType, answerJson: unknown) {
  if (type !== "mcq_single") {
    return "";
  }

  return typeof answerJson === "object" && answerJson && "correctOptionId" in answerJson
    ? String(answerJson.correctOptionId)
    : "";
}

function multiAnswerValue(type: QuestionType, answerJson: unknown) {
  if (type !== "mcq_multi") {
    return "";
  }

  return typeof answerJson === "object" &&
    answerJson &&
    "correctOptionIds" in answerJson &&
    Array.isArray(answerJson.correctOptionIds)
    ? answerJson.correctOptionIds.join(", ")
    : "";
}

function trueFalseValue(type: QuestionType, answerJson: unknown) {
  if (type !== "true_false") {
    return "true";
  }

  return typeof answerJson === "object" && answerJson && "value" in answerJson
    ? String(Boolean(answerJson.value))
    : "true";
}

function shortAnswerValue(type: QuestionType, answerJson: unknown) {
  if (type !== "short_answer") {
    return "";
  }

  return typeof answerJson === "object" &&
    answerJson &&
    "acceptedAnswers" in answerJson &&
    Array.isArray(answerJson.acceptedAnswers)
    ? answerJson.acceptedAnswers.join("\n")
    : "";
}

async function createQuizAction(formData: FormData) {
  "use server";

  await requireTutor();
  await createQuiz(getDb(), {
    courseId: String(formData.get("courseId") ?? ""),
    instructionsMd: String(formData.get("instructionsMd") ?? ""),
    maxAttempts: numberValue(formData.get("maxAttempts"), 1),
    status: quizStatus(formData.get("status")),
    timeLimitMin: nullableNumber(formData.get("timeLimitMin")),
    title: String(formData.get("title") ?? ""),
  });

  redirect(`/quizzes?courseId=${formData.get("courseId") ?? ""}`);
}

async function updateQuizAction(formData: FormData) {
  "use server";

  await requireTutor();
  await updateQuiz(getDb(), {
    id: String(formData.get("id") ?? ""),
    instructionsMd: String(formData.get("instructionsMd") ?? ""),
    maxAttempts: numberValue(formData.get("maxAttempts"), 1),
    status: quizStatus(formData.get("status")),
    timeLimitMin: nullableNumber(formData.get("timeLimitMin")),
    title: String(formData.get("title") ?? ""),
  });

  redirect(`/quizzes?courseId=${formData.get("courseId") ?? ""}`);
}

async function createQuestionAction(formData: FormData) {
  "use server";

  await requireTutor();
  const type = questionType(formData.get("type"));
  await createQuizQuestion(getDb(), {
    answerJson: answerFromForm(type, formData),
    optionsJson: parseOptionsText(formData.get("optionsText")),
    points: numberValue(formData.get("points"), 1),
    promptMd: String(formData.get("promptMd") ?? ""),
    quizId: String(formData.get("quizId") ?? ""),
    sortOrder: numberValue(formData.get("sortOrder"), 0),
    type,
  });

  redirect(`/quizzes?courseId=${formData.get("courseId") ?? ""}`);
}

async function updateQuestionAction(formData: FormData) {
  "use server";

  await requireTutor();
  const type = questionType(formData.get("type"));
  await updateQuizQuestion(getDb(), {
    answerJson: answerFromForm(type, formData),
    id: String(formData.get("id") ?? ""),
    optionsJson: parseOptionsText(formData.get("optionsText")),
    points: numberValue(formData.get("points"), 1),
    promptMd: String(formData.get("promptMd") ?? ""),
    sortOrder: numberValue(formData.get("sortOrder"), 0),
    type,
  });

  redirect(`/quizzes?courseId=${formData.get("courseId") ?? ""}`);
}

function QuestionPreview({
  answerJson,
  optionsJson,
  promptMd,
  type,
}: {
  answerJson: unknown;
  optionsJson: unknown;
  promptMd: string;
  type: QuestionType;
}) {
  const options = type === "mcq_single" || type === "mcq_multi" ? parseQuestionOptions(type, optionsJson) : null;

  return (
    <div className="rounded-xl border bg-background p-4">
      <div dangerouslySetInnerHTML={{ __html: renderMarkdown(promptMd) }} />
      {options ? (
        <ol className="mt-3 grid gap-2 text-sm">
          {options.options.map((option) => (
            <li className="rounded-lg border bg-card px-3 py-2" key={option.id}>
              <span className="font-mono text-xs uppercase text-muted-foreground">{option.id}</span>{" "}
              {option.text}
            </li>
          ))}
        </ol>
      ) : null}
      <p className="mt-3 text-xs font-semibold text-muted-foreground">
        {answerSummary(type, answerJson)}
      </p>
    </div>
  );
}

export default async function QuizzesPage({
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
  const quizBuilder = selectedCourseId ? await listQuizBuilder(getDb(), selectedCourseId) : [];

  return (
    <main className="mx-auto max-w-6xl p-6">
      <h1 className="font-display text-3xl italic">Quizzes</h1>
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
          <section className="rounded-2xl border bg-card p-6 shadow-soft">
            <p className="font-mono text-[10px] uppercase text-muted-foreground">Builder</p>
            <h2 className="mt-3 text-lg font-semibold">Add quiz</h2>
            <form action={createQuizAction} className="mt-5 space-y-4">
              <input name="courseId" type="hidden" value={selectedCourseId} />
              <label className="block text-sm font-medium" htmlFor="quizTitle">
                Quiz title
              </label>
              <input className="h-11 w-full rounded-xl border bg-background px-3 text-sm" id="quizTitle" name="title" required />
              <label className="block text-sm font-medium" htmlFor="quizInstructions">
                Instructions
              </label>
              <textarea className="min-h-28 w-full rounded-xl border bg-background px-3 py-2 text-sm" id="quizInstructions" name="instructionsMd" />
              <div className="grid gap-3 sm:grid-cols-3">
                <select className="h-11 rounded-xl border bg-background px-3 text-sm" name="status" defaultValue="draft">
                  <option value="draft">Draft</option>
                  <option value="published">Published</option>
                  <option value="closed">Closed</option>
                </select>
                <input aria-label="Time limit" className="h-11 rounded-xl border bg-background px-3 text-sm" min={1} name="timeLimitMin" placeholder="Minutes" type="number" />
                <input aria-label="Max attempts" className="h-11 rounded-xl border bg-background px-3 text-sm" min={1} name="maxAttempts" defaultValue={1} type="number" />
              </div>
              <Button type="submit" variant="gradient">
                Add quiz
              </Button>
            </form>
          </section>

          <section className="space-y-4">
            <h2 className="text-lg font-semibold">Quiz builder</h2>
            {quizBuilder.length === 0 ? (
              <div className="rounded-2xl border bg-card p-8 text-center shadow-soft">
                <p className="font-display text-2xl italic">No quizzes yet.</p>
              </div>
            ) : (
              quizBuilder.map(({ quiz, questions }) => (
                <article className="rounded-2xl border bg-card p-5 shadow-soft" key={quiz.id}>
                  <details open>
                    <summary className="cursor-pointer text-lg font-semibold">{quiz.title}</summary>
                    <form action={updateQuizAction} className="mt-5 grid gap-3">
                      <input name="courseId" type="hidden" value={selectedCourseId} />
                      <input name="id" type="hidden" value={quiz.id} />
                      <input aria-label={`Title for ${quiz.title}`} className="h-10 rounded-xl border bg-background px-3 text-sm" name="title" defaultValue={quiz.title} />
                      <textarea aria-label={`Instructions for ${quiz.title}`} className="min-h-20 rounded-xl border bg-background px-3 py-2 text-sm" name="instructionsMd" defaultValue={quiz.instructionsMd} />
                      <div className="grid gap-3 sm:grid-cols-3">
                        <select aria-label={`Status for ${quiz.title}`} className="h-10 rounded-xl border bg-background px-3 text-sm" name="status" defaultValue={quiz.status}>
                          <option value="draft">Draft</option>
                          <option value="published">Published</option>
                          <option value="closed">Closed</option>
                        </select>
                        <input aria-label={`Time limit for ${quiz.title}`} className="h-10 rounded-xl border bg-background px-3 text-sm" min={1} name="timeLimitMin" defaultValue={quiz.timeLimitMin ?? ""} type="number" />
                        <input aria-label={`Max attempts for ${quiz.title}`} className="h-10 rounded-xl border bg-background px-3 text-sm" min={1} name="maxAttempts" defaultValue={quiz.maxAttempts} type="number" />
                      </div>
                      <Button size="sm" type="submit">
                        Save quiz
                      </Button>
                    </form>
                    <Button asChild className="mt-3" size="sm" variant="outline">
                      <a href={`/quiz/${quiz.id}`}>Student view</a>
                    </Button>

                    <form action={createQuestionAction} className="mt-5 grid gap-3 rounded-xl border bg-background p-4">
                      <input name="courseId" type="hidden" value={selectedCourseId} />
                      <input name="quizId" type="hidden" value={quiz.id} />
                      <input name="sortOrder" type="hidden" value={questions.length} />
                      <select className="h-10 rounded-xl border bg-card px-3 text-sm" name="type" defaultValue="mcq_single">
                        <option value="mcq_single">Multiple choice</option>
                        <option value="mcq_multi">Multiple select</option>
                        <option value="true_false">True/false</option>
                        <option value="short_answer">Short answer</option>
                      </select>
                      <textarea className="min-h-20 rounded-xl border bg-card px-3 py-2 text-sm" name="promptMd" placeholder="Question prompt" required />
                      <textarea className="min-h-20 rounded-xl border bg-card px-3 py-2 text-sm" name="optionsText" placeholder="a|First option" />
                      <div className="grid gap-3 sm:grid-cols-4">
                        <input className="h-10 rounded-xl border bg-card px-3 text-sm" name="correctOptionId" placeholder="Correct ID" />
                        <input className="h-10 rounded-xl border bg-card px-3 text-sm" name="correctOptionIds" placeholder="Correct IDs" />
                        <select className="h-10 rounded-xl border bg-card px-3 text-sm" name="trueFalseAnswer" defaultValue="true">
                          <option value="true">True</option>
                          <option value="false">False</option>
                        </select>
                        <input className="h-10 rounded-xl border bg-card px-3 text-sm" min={1} name="points" defaultValue={1} type="number" />
                      </div>
                      <textarea className="min-h-20 rounded-xl border bg-card px-3 py-2 text-sm" name="acceptedAnswers" placeholder="Accepted answers" />
                      <Button size="sm" type="submit" variant="outline">
                        Add question
                      </Button>
                    </form>

                    <div className="mt-5 grid gap-4">
                      {questions.map((question) => {
                        const type = question.type as QuestionType;

                        return (
                          <section className="grid gap-3 rounded-xl border bg-background p-4" key={question.id}>
                            <QuestionPreview
                              answerJson={question.answerJson}
                              optionsJson={question.optionsJson}
                              promptMd={question.promptMd}
                              type={type}
                            />
                            <form action={updateQuestionAction} className="grid gap-3">
                              <input name="courseId" type="hidden" value={selectedCourseId} />
                              <input name="id" type="hidden" value={question.id} />
                              <div className="grid gap-3 sm:grid-cols-[1fr_100px_100px]">
                                <select className="h-10 rounded-xl border bg-card px-3 text-sm" name="type" defaultValue={question.type}>
                                  <option value="mcq_single">Multiple choice</option>
                                  <option value="mcq_multi">Multiple select</option>
                                  <option value="true_false">True/false</option>
                                  <option value="short_answer">Short answer</option>
                                </select>
                                <input aria-label={`Sort order for ${question.promptMd}`} className="h-10 rounded-xl border bg-card px-3 text-sm" min={0} name="sortOrder" defaultValue={question.sortOrder} type="number" />
                                <input aria-label={`Points for ${question.promptMd}`} className="h-10 rounded-xl border bg-card px-3 text-sm" min={1} name="points" defaultValue={question.points} type="number" />
                              </div>
                              <textarea className="min-h-20 rounded-xl border bg-card px-3 py-2 text-sm" name="promptMd" defaultValue={question.promptMd} />
                              <textarea className="min-h-20 rounded-xl border bg-card px-3 py-2 text-sm" name="optionsText" defaultValue={optionsValue(type, question.optionsJson)} />
                              <div className="grid gap-3 sm:grid-cols-3">
                                <input className="h-10 rounded-xl border bg-card px-3 text-sm" name="correctOptionId" defaultValue={singleAnswerValue(type, question.answerJson)} />
                                <input className="h-10 rounded-xl border bg-card px-3 text-sm" name="correctOptionIds" defaultValue={multiAnswerValue(type, question.answerJson)} />
                                <select className="h-10 rounded-xl border bg-card px-3 text-sm" name="trueFalseAnswer" defaultValue={trueFalseValue(type, question.answerJson)}>
                                  <option value="true">True</option>
                                  <option value="false">False</option>
                                </select>
                              </div>
                              <textarea className="min-h-20 rounded-xl border bg-card px-3 py-2 text-sm" name="acceptedAnswers" defaultValue={shortAnswerValue(type, question.answerJson)} />
                              <Button size="sm" type="submit">
                                Save question
                              </Button>
                            </form>
                          </section>
                        );
                      })}
                    </div>
                  </details>
                </article>
              ))
            )}
          </section>
        </div>
      ) : (
        <div className="mt-8 rounded-2xl border bg-card p-8 text-center shadow-soft">
          <p className="font-display text-2xl italic">Create a course before adding quizzes.</p>
        </div>
      )}
    </main>
  );
}
