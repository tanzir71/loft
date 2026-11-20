"use client";

import { useEffect, useRef, useState } from "react";

type AttemptQuestion = {
  id: string;
  options: { id: string; text: string }[] | null;
  promptHtml: string;
  type: "mcq_single" | "mcq_multi" | "true_false" | "short_answer";
};

type QuizAttemptProps = {
  answersByQuestion: Record<string, unknown>;
  attemptId: string;
  questions: AttemptQuestion[];
  quizId: string;
  remainingSeconds: number | null;
};

function answerRecord(answer: unknown): Record<string, unknown> {
  return typeof answer === "object" && answer ? (answer as Record<string, unknown>) : {};
}

function formatSeconds(total: number) {
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;

  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function QuizAttempt({
  answersByQuestion,
  attemptId,
  questions,
  quizId,
  remainingSeconds,
}: QuizAttemptProps) {
  const [answers, setAnswers] = useState<Record<string, unknown>>(answersByQuestion);
  const [saveState, setSaveState] = useState<Record<string, string>>({});
  const [seconds, setSeconds] = useState(remainingSeconds);
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  useEffect(() => {
    if (seconds === null || seconds <= 0) {
      return;
    }

    const interval = setInterval(() => {
      setSeconds((current) => (current === null ? null : Math.max(0, current - 1)));
    }, 1000);

    return () => clearInterval(interval);
  }, [seconds]);

  const disabled = seconds === 0;

  function queueSave(questionId: string, answerJson: unknown) {
    setAnswers((current) => ({ ...current, [questionId]: answerJson }));
    setSaveState((current) => ({ ...current, [questionId]: "Saving" }));
    clearTimeout(timers.current[questionId]);
    timers.current[questionId] = setTimeout(async () => {
      const response = await fetch(`/quiz/${quizId}/autosave`, {
        body: JSON.stringify({ answerJson, attemptId, questionId }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });

      setSaveState((current) => ({
        ...current,
        [questionId]: response.ok ? "Saved" : "Not saved",
      }));
    }, 450);
  }

  return (
    <div className="grid gap-4">
      <div className="rounded-2xl border bg-card p-4 shadow-soft">
        <p className="font-mono text-[10px] uppercase text-muted-foreground">Timer</p>
        <p className="mt-2 font-mono text-2xl">{seconds === null ? "No limit" : formatSeconds(seconds)}</p>
      </div>
      {questions.map((question, index) => {
        const current = answers[question.id];
        const currentAnswer = answerRecord(current);
        const selectedOptionId = String(currentAnswer.selectedOptionId ?? "");
        const multiValue = currentAnswer.selectedOptionIds;
        const selectedOptionIds = new Set(
          Array.isArray(multiValue) ? multiValue.map((value: unknown) => String(value)) : [],
        );
        const trueFalse = String(currentAnswer.value ?? "");
        const shortResponse = String(currentAnswer.response ?? "");

        return (
          <section className="rounded-2xl border bg-card p-5 shadow-soft" key={question.id}>
            <p className="font-mono text-[10px] uppercase text-muted-foreground">
              Question {index + 1}
            </p>
            <div
              className="mt-3"
              dangerouslySetInnerHTML={{ __html: question.promptHtml }}
            />
            {question.type === "mcq_single" && question.options ? (
              <div className="mt-4 grid gap-2">
                {question.options.map((option) => (
                  <label className="flex gap-2 rounded-xl border bg-background px-3 py-2 text-sm" key={option.id}>
                    <input
                      checked={selectedOptionId === option.id}
                      disabled={disabled}
                      name={question.id}
                      onChange={() => queueSave(question.id, { selectedOptionId: option.id })}
                      type="radio"
                    />
                    {option.text}
                  </label>
                ))}
              </div>
            ) : null}
            {question.type === "mcq_multi" && question.options ? (
              <div className="mt-4 grid gap-2">
                {question.options.map((option) => (
                  <label className="flex gap-2 rounded-xl border bg-background px-3 py-2 text-sm" key={option.id}>
                    <input
                      checked={selectedOptionIds.has(option.id)}
                      disabled={disabled}
                      onChange={(event) => {
                        const next = new Set(selectedOptionIds);
                        if (event.target.checked) {
                          next.add(option.id);
                        } else {
                          next.delete(option.id);
                        }
                        queueSave(question.id, { selectedOptionIds: [...next] });
                      }}
                      type="checkbox"
                    />
                    {option.text}
                  </label>
                ))}
              </div>
            ) : null}
            {question.type === "true_false" ? (
              <div className="mt-4 flex flex-wrap gap-2">
                {["true", "false"].map((value) => (
                  <label className="flex gap-2 rounded-xl border bg-background px-3 py-2 text-sm" key={value}>
                    <input
                      checked={trueFalse === value}
                      disabled={disabled}
                      name={question.id}
                      onChange={() => queueSave(question.id, { value: value === "true" })}
                      type="radio"
                    />
                    {value === "true" ? "True" : "False"}
                  </label>
                ))}
              </div>
            ) : null}
            {question.type === "short_answer" ? (
              <textarea
                className="mt-4 min-h-28 w-full rounded-xl border bg-background px-3 py-2 text-sm"
                disabled={disabled}
                onChange={(event) => queueSave(question.id, { response: event.target.value })}
                value={shortResponse}
              />
            ) : null}
            <p className="mt-3 text-xs font-semibold text-muted-foreground">
              {saveState[question.id] ?? "Ready"}
            </p>
          </section>
        );
      })}
    </div>
  );
}
