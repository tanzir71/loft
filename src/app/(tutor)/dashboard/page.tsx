import type { Metadata } from "next";

import { getDb } from "@/db";
import { activityDisplay, listRecentActivity } from "@/lib/activity";
import { requireTutor } from "@/lib/authz";
import { getBillingDashboardMetrics } from "@/lib/billing";

export const metadata: Metadata = {
  title: "Dashboard",
};

export default async function DashboardPage() {
  await requireTutor();
  const database = getDb();
  const [metrics, recentActivity] = await Promise.all([
    getBillingDashboardMetrics(database),
    listRecentActivity(database, { limit: 8 }),
  ]);
  const tiles = [
    { label: "Outstanding total", value: metrics.outstandingTotal },
    { label: "Overdue invoices", value: metrics.overdueCount },
    { label: "Collected this month", value: metrics.collectedThisMonth },
  ];

  return (
    <main className="mx-auto max-w-6xl p-6">
      <h1 className="font-display text-3xl italic">Dashboard</h1>
      <section className="mt-6 grid gap-4 md:grid-cols-3">
        {tiles.map((tile) => (
          <article className="rounded-2xl border bg-card p-5 shadow-soft" key={tile.label}>
            <p className="font-mono text-[10px] uppercase text-muted-foreground">
              {tile.label}
            </p>
            <p className="mt-3 font-mono text-3xl">{tile.value}</p>
          </article>
        ))}
      </section>
      <section aria-label="Recent activity" className="mt-8 rounded-2xl border bg-card p-5 shadow-soft">
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-lg font-semibold">Recent activity</h2>
          <span className="font-mono text-[10px] uppercase text-muted-foreground">
            {recentActivity.length} latest
          </span>
        </div>
        {recentActivity.length === 0 ? (
          <p className="mt-6 rounded-xl border bg-background px-4 py-6 text-center text-sm text-muted-foreground">
            No activity yet.
          </p>
        ) : (
          <ol className="mt-5 grid gap-3">
            {recentActivity.map((activity) => {
              const display = activityDisplay(activity);
              const happenedAt = new Date(activity.at).toISOString().slice(0, 16).replace("T", " ");

              return (
                <li
                  className="flex flex-col gap-2 rounded-xl border bg-background px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
                  key={activity.id}
                >
                  <div>
                    <p className="text-sm font-semibold">{display.title}</p>
                    {display.detail ? (
                      <p className="mt-1 text-sm text-muted-foreground">{display.detail}</p>
                    ) : null}
                  </div>
                  <time
                    className="font-mono text-[10px] uppercase text-muted-foreground"
                    dateTime={new Date(activity.at).toISOString()}
                  >
                    {happenedAt}
                  </time>
                </li>
              );
            })}
          </ol>
        )}
      </section>
    </main>
  );
}
