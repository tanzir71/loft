import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { requireUser } from "@/lib/authz";
import { roleHomePath } from "@/lib/session-routing";

export const metadata: Metadata = {
  title: "Overview",
};

export default async function ParentOverviewPage() {
  const user = await requireUser();

  if (user.role !== "parent") {
    redirect(roleHomePath(user.role));
  }

  return (
    <main className="mx-auto max-w-3xl p-6">
      <h1 className="font-display text-3xl italic">Overview</h1>
      <p className="mt-3 text-sm text-muted-foreground">Parent overview is ready for linked students.</p>
    </main>
  );
}
