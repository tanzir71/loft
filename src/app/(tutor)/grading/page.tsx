import type { Metadata } from "next";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { Button } from "@/components/ui/button";
import { getDb } from "@/db";
import { draftSubmissionFeedback } from "@/lib/ai/feedback";
import { readAiGenerationSettings, readAiSettings } from "@/lib/ai-settings";
import { requireTutor } from "@/lib/authz";
import {
  addSubmissionComment,
  createCommentBankItem,
  gradeSubmission,
  listCommentBank,
  listGradingSubmissions,
  listSubmissionComments,
} from "@/lib/classroom";
import { renderMarkdown } from "@/lib/markdown";

export const metadata: Metadata = {
  title: "Grading",
};

function numberValue(value: FormDataEntryValue | null) {
  const parsed = Number(String(value ?? "").trim());
  return Number.isFinite(parsed) ? parsed : 0;
}

function joinFeedback(bankText: FormDataEntryValue | null, feedbackMd: FormDataEntryValue | null) {
  return [String(bankText ?? "").trim(), String(feedbackMd ?? "").trim()]
    .filter(Boolean)
    .join("\n\n");
}

function encryptionSecret() {
  return process.env.AUTH_SECRET ?? "dev-only-change-me-for-production";
}

function feedbackMockFetch() {
  if (process.env.PLAYWRIGHT !== "1") {
    return undefined;
  }

  return (async () =>
    new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                feedbackMd:
                  "Strong equation setup. Add one sentence explaining inverse operations.",
              }),
            },
          },
        ],
      }),
    )) as typeof fetch;
}

async function createBankCommentAction(formData: FormData) {
  "use server";

  await requireTutor();
  await createCommentBankItem(getDb(), {
    sortOrder: numberValue(formData.get("sortOrder")),
    text: String(formData.get("text") ?? ""),
  });

  revalidatePath("/grading");
  redirect("/grading");
}

async function gradeSubmissionAction(formData: FormData) {
  "use server";

  const user = await requireTutor();
  await gradeSubmission(getDb(), {
    actor: user,
    feedbackMd: joinFeedback(formData.get("bankText"), formData.get("feedbackMd")),
    grade: numberValue(formData.get("grade")),
    submissionId: String(formData.get("submissionId") ?? ""),
  });

  revalidatePath("/grading");
  revalidatePath("/assignments");
  redirect("/grading");
}

async function draftFeedbackAction(formData: FormData) {
  "use server";

  await requireTutor();
  const submissionId = String(formData.get("submissionId") ?? "");
  let redirectTo = `/grading?feedbackError=ai`;

  try {
    const database = getDb();
    const aiSettings = await readAiGenerationSettings(database, {
      encryptionSecret: encryptionSecret(),
    });
    await draftSubmissionFeedback(database, {
      apiKey: aiSettings.apiKey,
      fetchFn: feedbackMockFetch(),
      model: aiSettings.model,
      provider: aiSettings.provider,
      submissionId,
    });
    revalidatePath("/grading");
    redirectTo = `/grading?feedbackDrafted=${submissionId}`;
  } catch {
    redirectTo = `/grading?feedbackError=ai`;
  }

  redirect(redirectTo);
}

async function addTutorCommentAction(formData: FormData) {
  "use server";

  const user = await requireTutor();
  await addSubmissionComment(getDb(), {
    actor: user,
    body: String(formData.get("body") ?? ""),
    submissionId: String(formData.get("submissionId") ?? ""),
  });

  revalidatePath("/grading");
  revalidatePath("/assignments");
  redirect("/grading");
}

export default async function GradingPage({
  searchParams,
}: {
  searchParams: Promise<{ feedbackDrafted?: string; feedbackError?: "ai" }>;
}) {
  const user = await requireTutor();
  const params = await searchParams;
  const [aiSettings, bank, submissions] = await Promise.all([
    readAiSettings(getDb()),
    listCommentBank(getDb()),
    listGradingSubmissions(getDb()),
  ]);
  const commentEntries = await Promise.all(
    submissions.map(async (submission) => [
      submission.id,
      await listSubmissionComments(getDb(), { actor: user, submissionId: submission.id }),
    ] as const),
  );
  const commentsBySubmission = Object.fromEntries(commentEntries);

  return (
    <main className="mx-auto max-w-6xl p-6">
      <h1 className="font-display text-3xl italic">Grading</h1>
      {params.feedbackError ? (
        <div className="mt-6 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          AI feedback could not be drafted.
        </div>
      ) : null}
      {params.feedbackDrafted ? (
        <div className="mt-6 rounded-xl border border-accent/30 bg-accent/10 px-4 py-3 text-sm">
          AI feedback draft added.
        </div>
      ) : null}
      <div className="mt-8 grid gap-6 lg:grid-cols-[320px_1fr]">
        <section className="rounded-2xl border bg-card p-6 shadow-soft">
          <p className="font-mono text-[10px] uppercase text-muted-foreground">Feedback</p>
          <h2 className="mt-3 text-lg font-semibold">Comment bank</h2>
          <form action={createBankCommentAction} className="mt-5 space-y-3">
            <label className="block text-sm font-medium" htmlFor="bankCommentText">
              Comment
            </label>
            <textarea
              className="min-h-24 w-full rounded-xl border bg-background px-3 py-2 text-sm"
              id="bankCommentText"
              name="text"
              required
            />
            <label className="block text-sm font-medium" htmlFor="bankCommentOrder">
              Sort order
            </label>
            <input
              className="h-10 w-full rounded-xl border bg-background px-3 text-sm"
              defaultValue="0"
              id="bankCommentOrder"
              name="sortOrder"
              type="number"
            />
            <Button type="submit">Save bank comment</Button>
          </form>
          <div className="mt-6 space-y-2">
            {bank.length === 0 ? (
              <p className="text-sm text-muted-foreground">No saved comments yet.</p>
            ) : (
              bank.map((item) => (
                <p className="rounded-xl border bg-background p-3 text-sm" key={item.id}>
                  {item.text}
                </p>
              ))
            )}
          </div>
        </section>

        <section className="space-y-4">
          <h2 className="text-lg font-semibold">Submissions</h2>
          {submissions.length === 0 ? (
            <div className="rounded-2xl border bg-card p-8 text-center shadow-soft">
              <p className="font-display text-2xl italic">No submissions yet.</p>
            </div>
          ) : (
            submissions.map((submission) => (
              <article className="rounded-2xl border bg-card p-5 shadow-soft" key={submission.id}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-mono text-[10px] uppercase text-muted-foreground">
                      {submission.courseTitle} / {submission.studentName}
                    </p>
                    <h3 className="mt-2 text-lg font-semibold">{submission.assignmentTitle}</h3>
                  </div>
                  <p className="rounded-full border px-3 py-1 text-xs font-semibold uppercase">
                    {submission.status}
                  </p>
                </div>
                <div className="mt-4 rounded-xl border bg-background p-4 text-sm leading-6">
                  {submission.bodyText ? <p>{submission.bodyText}</p> : null}
                  {submission.linkUrl ? (
                    <a className="mt-2 block font-semibold underline" href={submission.linkUrl}>
                      Submission link
                    </a>
                  ) : null}
                  {submission.late ? <p className="mt-2 font-semibold text-destructive">Late submission</p> : null}
                </div>
                {submission.feedbackMd ? (
                  <div className="mt-4 rounded-xl border bg-background p-4">
                    <p className="text-sm font-semibold">
                      {submission.status === "returned" ? "Returned feedback" : "Draft feedback"}
                    </p>
                    <div
                      className="mt-2 text-sm text-muted-foreground"
                      dangerouslySetInnerHTML={{ __html: renderMarkdown(submission.feedbackMd) }}
                    />
                  </div>
                ) : null}
                {aiSettings.hasKey ? (
                  <form action={draftFeedbackAction} className="mt-5">
                    <input name="submissionId" type="hidden" value={submission.id} />
                    <Button size="sm" type="submit" variant="outline">
                      Draft AI feedback
                    </Button>
                  </form>
                ) : null}
                <form action={gradeSubmissionAction} className="mt-5 grid gap-3 md:grid-cols-[120px_220px_1fr_auto]">
                  <input name="submissionId" type="hidden" value={submission.id} />
                  <label className="block text-sm font-medium">
                    Grade
                    <input
                      className="mt-1 h-10 w-full rounded-xl border bg-background px-3 text-sm"
                      max={submission.points ?? undefined}
                      min="0"
                      name="grade"
                      required
                      type="number"
                    />
                  </label>
                  <label className="block text-sm font-medium">
                    Bank comment
                    <select className="mt-1 h-10 w-full rounded-xl border bg-background px-3 text-sm" name="bankText">
                      <option value="">No bank comment</option>
                      {bank.map((item) => (
                        <option key={item.id} value={item.text}>
                          {item.text}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block text-sm font-medium">
                    Feedback
                    <textarea
                      className="mt-1 min-h-20 w-full rounded-xl border bg-background px-3 py-2 text-sm"
                      defaultValue={submission.feedbackMd ?? ""}
                      name="feedbackMd"
                    />
                  </label>
                  <div className="self-end">
                    <Button type="submit" variant="gradient">
                      Return with feedback
                    </Button>
                  </div>
                </form>
                <div className="mt-5 rounded-xl border bg-background p-4">
                  <p className="text-sm font-semibold">Private comments</p>
                  <div className="mt-3 space-y-2">
                    {(commentsBySubmission[submission.id] ?? []).map((comment) => (
                      <p className="text-sm" key={comment.id}>
                        <span className="font-semibold">{comment.authorName}: </span>
                        {comment.body}
                      </p>
                    ))}
                  </div>
                  <form action={addTutorCommentAction} className="mt-4 flex flex-col gap-3 sm:flex-row">
                    <input name="submissionId" type="hidden" value={submission.id} />
                    <input
                      className="h-10 flex-1 rounded-xl border bg-background px-3 text-sm"
                      name="body"
                      placeholder="Private comment"
                      required
                    />
                    <Button type="submit">Add private comment</Button>
                  </form>
                </div>
              </article>
            ))
          )}
        </section>
      </div>
    </main>
  );
}
