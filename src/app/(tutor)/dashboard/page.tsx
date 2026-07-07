import type { Metadata } from "next";

import { getDb } from "@/db";
import { requireTutor } from "@/lib/authz";
import { getBillingDashboardMetrics } from "@/lib/billing";

export const metadata: Metadata = {
  title: "Dashboard",
};

export default async function DashboardPage() {
  await requireTutor();
  const metrics = await getBillingDashboardMetrics(getDb());
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
    </main>
  );
}
