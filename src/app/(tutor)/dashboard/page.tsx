import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Dashboard",
};

export default function DashboardPage() {
  return (
    <main className="mx-auto max-w-6xl p-6">
      <h1 className="font-display text-3xl italic">Dashboard</h1>
      <p className="mt-3 text-sm text-muted-foreground">Tutor workspace is ready for P1 flows.</p>
    </main>
  );
}
