import { asc } from "drizzle-orm";
import type { Metadata } from "next";
import { Archive, Plus, Save } from "lucide-react";
import { redirect } from "next/navigation";

import { getDb } from "@/db";
import { ratePlans } from "@/db/schema";
import { Button } from "@/components/ui/button";
import { requireTutor } from "@/lib/authz";
import { archiveRatePlan, createRatePlan, updateRatePlan } from "@/lib/billing";

export const metadata: Metadata = {
  title: "Billing",
};

function planType(value: FormDataEntryValue | null) {
  const raw = String(value ?? "");
  return raw === "monthly_flat" || raw === "package" ? raw : "per_session";
}

function sessionsCount(value: FormDataEntryValue | null) {
  const raw = String(value ?? "").trim();
  return raw ? Number(raw) : null;
}

async function createRatePlanAction(formData: FormData) {
  "use server";

  await requireTutor();
  await createRatePlan(getDb(), {
    name: String(formData.get("name") ?? ""),
    type: planType(formData.get("type")),
    amount: Number(formData.get("amount") ?? 0),
    sessionsCount: sessionsCount(formData.get("sessionsCount")),
  });

  redirect("/billing?created=1");
}

async function updateRatePlanAction(formData: FormData) {
  "use server";

  await requireTutor();
  await updateRatePlan(getDb(), {
    id: String(formData.get("id") ?? ""),
    name: String(formData.get("name") ?? ""),
    type: planType(formData.get("type")),
    amount: Number(formData.get("amount") ?? 0),
    sessionsCount: sessionsCount(formData.get("sessionsCount")),
    active: String(formData.get("active")) === "true",
  });

  redirect("/billing?updated=1");
}

async function archiveRatePlanAction(formData: FormData) {
  "use server";

  await requireTutor();
  await archiveRatePlan(getDb(), {
    id: String(formData.get("id") ?? ""),
  });

  redirect("/billing?archived=1");
}

export default async function BillingPage() {
  await requireTutor();

  const plans = await getDb().select().from(ratePlans).orderBy(asc(ratePlans.name));

  return (
    <main className="mx-auto max-w-6xl p-6">
      <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
        <section className="w-full max-w-md rounded-2xl border bg-card p-6 shadow-soft">
          <p className="font-mono text-[10px] uppercase text-muted-foreground">Rate plans</p>
          <h1 className="mt-3 font-display text-3xl italic">Billing</h1>
          <form action={createRatePlanAction} className="mt-6 space-y-4">
            <label className="block text-sm font-medium" htmlFor="name">
              Rate plan name
            </label>
            <input
              className="h-11 w-full rounded-xl border bg-background px-3 text-sm"
              id="name"
              name="name"
              required
            />
            <label className="block text-sm font-medium" htmlFor="type">
              Plan type
            </label>
            <select
              className="h-11 w-full rounded-xl border bg-background px-3 text-sm"
              id="type"
              name="type"
              defaultValue="per_session"
            >
              <option value="per_session">Per session</option>
              <option value="monthly_flat">Monthly flat</option>
              <option value="package">Package</option>
            </select>
            <label className="block text-sm font-medium" htmlFor="amount">
              Amount minor units
            </label>
            <input
              className="h-11 w-full rounded-xl border bg-background px-3 text-sm"
              id="amount"
              min={0}
              name="amount"
              required
              type="number"
            />
            <label className="block text-sm font-medium" htmlFor="sessionsCount">
              Sessions count
            </label>
            <input
              className="h-11 w-full rounded-xl border bg-background px-3 text-sm"
              id="sessionsCount"
              min={1}
              name="sessionsCount"
              type="number"
            />
            <Button type="submit" variant="gradient">
              <Plus className="h-4 w-4" aria-hidden="true" />
              Add rate plan
            </Button>
          </form>
        </section>

        <section className="flex-1">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold">Plan list</h2>
            <span className="font-mono text-[10px] uppercase text-muted-foreground">
              {plans.length} total
            </span>
          </div>
          <div className="grid gap-3">
            {plans.length === 0 ? (
              <div className="rounded-2xl border bg-card p-8 text-center shadow-soft">
                <p className="font-display text-2xl italic">No rate plans yet.</p>
              </div>
            ) : (
              plans.map((plan) => (
                <article className="rounded-2xl border bg-card p-4 shadow-soft" key={plan.id}>
                  <div className="mb-4 flex flex-wrap items-center gap-2">
                    <span
                      className={
                        plan.active
                          ? "rounded-full bg-accent/10 px-3 py-1 text-xs font-medium text-accent"
                          : "rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground"
                      }
                    >
                      {plan.active ? "Active" : "Inactive"}
                    </span>
                    <span className="font-mono text-xs text-muted-foreground">
                      {plan.type}
                    </span>
                    <span className="font-mono text-xs text-muted-foreground">
                      {plan.amount}
                    </span>
                  </div>
                  <form
                    action={updateRatePlanAction}
                    className="grid gap-3 md:grid-cols-[1fr_150px_120px_120px_auto]"
                  >
                    <input name="id" type="hidden" value={plan.id} />
                    <input
                      aria-label={`Name for ${plan.name}`}
                      className="h-10 rounded-xl border bg-background px-3 text-sm"
                      name="name"
                      defaultValue={plan.name}
                      required
                    />
                    <select
                      aria-label={`Type for ${plan.name}`}
                      className="h-10 rounded-xl border bg-background px-3 text-sm"
                      name="type"
                      defaultValue={plan.type}
                    >
                      <option value="per_session">Per session</option>
                      <option value="monthly_flat">Monthly flat</option>
                      <option value="package">Package</option>
                    </select>
                    <input
                      aria-label={`Amount for ${plan.name}`}
                      className="h-10 rounded-xl border bg-background px-3 text-sm"
                      min={0}
                      name="amount"
                      defaultValue={plan.amount}
                      type="number"
                    />
                    <input
                      aria-label={`Sessions count for ${plan.name}`}
                      className="h-10 rounded-xl border bg-background px-3 text-sm"
                      min={1}
                      name="sessionsCount"
                      defaultValue={plan.sessionsCount ?? ""}
                      type="number"
                    />
                    <select name="active" defaultValue={String(plan.active)} className="hidden">
                      <option value="true">Active</option>
                      <option value="false">Inactive</option>
                    </select>
                    <Button aria-label={`Save ${plan.name}`} size="sm" type="submit">
                      <Save className="h-4 w-4" aria-hidden="true" />
                      Save
                    </Button>
                  </form>
                  <form action={archiveRatePlanAction} className="mt-3">
                    <input name="id" type="hidden" value={plan.id} />
                    <Button
                      aria-label={`Archive ${plan.name}`}
                      size="sm"
                      type="submit"
                      variant="outline"
                    >
                      <Archive className="h-4 w-4" aria-hidden="true" />
                      Archive
                    </Button>
                  </form>
                </article>
              ))
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
