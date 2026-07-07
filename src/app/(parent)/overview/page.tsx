import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { getDb } from "@/db";
import { requireUser } from "@/lib/authz";
import { listPackageCreditsForParent } from "@/lib/billing";
import { listParentPortalSessions } from "@/lib/schedule";
import { roleHomePath } from "@/lib/session-routing";

export const metadata: Metadata = {
  title: "Overview",
};

function formatSessionTime(timestamp: number) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
  }).format(new Date(timestamp));
}

function attendanceLabel(status: string | null) {
  switch (status) {
    case "present":
      return "Present";
    case "absent":
      return "Absent";
    case "late":
      return "Late";
    case "excused":
      return "Excused";
    default:
      return "Not marked";
  }
}

function creditLabel(remaining: number) {
  return `${remaining} ${remaining === 1 ? "credit" : "credits"} remaining`;
}

export default async function ParentOverviewPage() {
  const user = await requireUser();

  if (user.role !== "parent") {
    redirect(roleHomePath(user.role));
  }

  const [sessions, packageCredits] = await Promise.all([
    listParentPortalSessions(getDb(), user.id),
    listPackageCreditsForParent(getDb(), user.id),
  ]);

  return (
    <main className="mx-auto max-w-3xl p-6">
      <h1 className="font-display text-3xl italic">Overview</h1>
      <section className="mt-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Package credits</h2>
          <span className="font-mono text-[10px] uppercase text-muted-foreground">
            {packageCredits.length} purchases
          </span>
        </div>
        {packageCredits.length === 0 ? (
          <div className="rounded-2xl border bg-card p-8 text-center shadow-soft">
            <p className="font-display text-2xl italic">No package credits yet.</p>
          </div>
        ) : (
          <div className="grid gap-3">
            {packageCredits.map((credit) => (
              <article className="rounded-2xl border bg-card p-5 shadow-soft" key={credit.id}>
                <p className="font-mono text-[10px] uppercase text-muted-foreground">
                  {credit.studentName}
                </p>
                <h3 className="mt-2 text-lg font-semibold">{credit.planName}</h3>
                <div className="mt-3 flex flex-wrap gap-2 text-xs font-medium">
                  <span className="rounded-full bg-muted px-3 py-1">
                    {creditLabel(credit.remaining)}
                  </span>
                  <span className="rounded-full bg-muted px-3 py-1">
                    {credit.sessionsUsed}/{credit.sessionsTotal} used
                  </span>
                  {credit.lowCredit ? (
                    <span className="rounded-full bg-destructive/10 px-3 py-1 text-destructive">
                      Low credit
                    </span>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
      <section className="mt-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Schedule and attendance</h2>
          <span className="font-mono text-[10px] uppercase text-muted-foreground">
            {sessions.length} sessions
          </span>
        </div>
        {sessions.length === 0 ? (
          <div className="rounded-2xl border bg-card p-8 text-center shadow-soft">
            <p className="font-display text-2xl italic">No sessions yet.</p>
          </div>
        ) : (
          <div className="grid gap-3">
            {sessions.map((session) => (
              <article className="rounded-2xl border bg-card p-5 shadow-soft" key={session.id}>
                <p className="font-mono text-[10px] uppercase text-muted-foreground">
                  {session.studentName} - {formatSessionTime(session.startsAt)}
                </p>
                <h3 className="mt-2 text-lg font-semibold">{session.courseTitle}</h3>
                <div className="mt-3 flex flex-wrap gap-2 text-xs font-medium">
                  <span className="rounded-full bg-muted px-3 py-1">
                    {attendanceLabel(session.attendanceStatus)}
                  </span>
                  <span className="rounded-full bg-muted px-3 py-1">{session.status}</span>
                </div>
                {session.notesShared ? (
                  <p className="mt-3 text-sm leading-6 text-muted-foreground">
                    {session.notesShared}
                  </p>
                ) : null}
              </article>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
