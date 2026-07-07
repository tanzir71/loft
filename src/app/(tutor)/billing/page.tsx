import { and, asc, eq } from "drizzle-orm";
import type { Metadata } from "next";
import { Archive, PackageCheck, Plus, RefreshCw, Save } from "lucide-react";
import { redirect } from "next/navigation";

import { getDb } from "@/db";
import { ratePlans, users } from "@/db/schema";
import { Button } from "@/components/ui/button";
import { requireTutor } from "@/lib/authz";
import {
  archiveRatePlan,
  consumePackageCreditsForAttendedSessions,
  createRatePlan,
  listPackageCredits,
  sellPackage,
  updateRatePlan,
} from "@/lib/billing";

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

function dateStart(value: FormDataEntryValue | null) {
  const raw = String(value ?? "").trim();

  if (!raw) {
    return null;
  }

  const timestamp = Date.parse(`${raw}T00:00:00.000Z`);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function dateEnd(value: FormDataEntryValue | null) {
  const start = dateStart(value);
  return start === null ? null : start + 24 * 60 * 60 * 1000;
}

function creditLabel(remaining: number) {
  return `${remaining} ${remaining === 1 ? "credit" : "credits"} remaining`;
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

async function sellPackageAction(formData: FormData) {
  "use server";

  await requireTutor();
  await sellPackage(getDb(), {
    dueDate: dateStart(formData.get("dueDate")) ?? undefined,
    purchasedAt: dateStart(formData.get("purchasedAt")) ?? undefined,
    ratePlanId: String(formData.get("ratePlanId") ?? ""),
    studentId: String(formData.get("studentId") ?? ""),
  });

  redirect("/billing?packageSold=1");
}

async function applyPackageCreditsAction(formData: FormData) {
  "use server";

  await requireTutor();
  const result = await consumePackageCreditsForAttendedSessions(getDb(), {
    periodEnd: dateEnd(formData.get("periodEnd")) ?? Date.now() + 366 * 24 * 60 * 60 * 1000,
    periodStart: dateStart(formData.get("periodStart")) ?? 0,
    studentId: String(formData.get("studentId") ?? ""),
  });
  const params = new URLSearchParams({
    billable: String(result.billableSessionIds.length),
    creditsApplied: String(result.covered.length),
  });

  redirect(`/billing?${params.toString()}`);
}

export default async function BillingPage() {
  await requireTutor();

  const database = getDb();
  const [plans, students, packageCredits] = await Promise.all([
    database.select().from(ratePlans).orderBy(asc(ratePlans.name)),
    database
      .select({ email: users.email, id: users.id, name: users.name })
      .from(users)
      .where(and(eq(users.role, "student"), eq(users.status, "active")))
      .orderBy(asc(users.name)),
    listPackageCredits(database),
  ]);
  const activePackagePlans = plans.filter((plan) => plan.active && plan.type === "package");

  return (
    <main className="mx-auto max-w-6xl p-6">
      <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
        <div className="w-full max-w-md space-y-6">
          <section className="rounded-2xl border bg-card p-6 shadow-soft">
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

          <section className="rounded-2xl border bg-card p-6 shadow-soft">
            <p className="font-mono text-[10px] uppercase text-muted-foreground">
              Prepaid packages
            </p>
            <h2 className="mt-3 text-lg font-semibold">Sell package</h2>
            <form action={sellPackageAction} className="mt-5 space-y-4">
              <label className="block text-sm font-medium" htmlFor="packageStudent">
                Package student
              </label>
              <select
                className="h-11 w-full rounded-xl border bg-background px-3 text-sm"
                id="packageStudent"
                name="studentId"
                required
              >
                <option value="">Select student</option>
                {students.map((student) => (
                  <option key={student.id} value={student.id}>
                    {student.name} ({student.email})
                  </option>
                ))}
              </select>
              <label className="block text-sm font-medium" htmlFor="packagePlan">
                Package plan
              </label>
              <select
                className="h-11 w-full rounded-xl border bg-background px-3 text-sm"
                id="packagePlan"
                name="ratePlanId"
                required
              >
                <option value="">Select package</option>
                {activePackagePlans.map((plan) => (
                  <option key={plan.id} value={plan.id}>
                    {plan.name} ({plan.sessionsCount ?? 0} sessions)
                  </option>
                ))}
              </select>
              <label className="block text-sm font-medium" htmlFor="purchasedAt">
                Purchase date
              </label>
              <input
                className="h-11 w-full rounded-xl border bg-background px-3 text-sm"
                id="purchasedAt"
                name="purchasedAt"
                type="date"
              />
              <label className="block text-sm font-medium" htmlFor="dueDate">
                Invoice due date
              </label>
              <input
                className="h-11 w-full rounded-xl border bg-background px-3 text-sm"
                id="dueDate"
                name="dueDate"
                type="date"
              />
              <Button type="submit" variant="gradient">
                <PackageCheck className="h-4 w-4" aria-hidden="true" />
                Sell package
              </Button>
            </form>
          </section>

          <section className="rounded-2xl border bg-card p-6 shadow-soft">
            <p className="font-mono text-[10px] uppercase text-muted-foreground">
              Attendance credits
            </p>
            <h2 className="mt-3 text-lg font-semibold">Apply package credits</h2>
            <form action={applyPackageCreditsAction} className="mt-5 space-y-4">
              <label className="block text-sm font-medium" htmlFor="creditStudent">
                Credit student
              </label>
              <select
                className="h-11 w-full rounded-xl border bg-background px-3 text-sm"
                id="creditStudent"
                name="studentId"
                required
              >
                <option value="">Select student</option>
                {students.map((student) => (
                  <option key={student.id} value={student.id}>
                    {student.name} ({student.email})
                  </option>
                ))}
              </select>
              <label className="block text-sm font-medium" htmlFor="periodStart">
                Credit period start
              </label>
              <input
                className="h-11 w-full rounded-xl border bg-background px-3 text-sm"
                id="periodStart"
                name="periodStart"
                type="date"
              />
              <label className="block text-sm font-medium" htmlFor="periodEnd">
                Credit period end
              </label>
              <input
                className="h-11 w-full rounded-xl border bg-background px-3 text-sm"
                id="periodEnd"
                name="periodEnd"
                type="date"
              />
              <Button type="submit" variant="outline">
                <RefreshCw className="h-4 w-4" aria-hidden="true" />
                Apply package credits
              </Button>
            </form>
          </section>
        </div>

        <div className="flex-1 space-y-8">
          <section>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold">Package credits</h2>
              <span className="font-mono text-[10px] uppercase text-muted-foreground">
                {packageCredits.length} purchases
              </span>
            </div>
            <div className="grid gap-3">
              {packageCredits.length === 0 ? (
                <div className="rounded-2xl border bg-card p-8 text-center shadow-soft">
                  <p className="font-display text-2xl italic">No package credits yet.</p>
                </div>
              ) : (
                packageCredits.map((credit) => (
                  <article
                    aria-label={`${credit.studentName ?? "Student"} ${credit.planName} package`}
                    className="rounded-2xl border bg-card p-4 shadow-soft"
                    key={credit.id}
                  >
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
                      <span className="rounded-full bg-muted px-3 py-1">{credit.status}</span>
                    </div>
                    <p className="mt-3 font-mono text-xs text-muted-foreground">
                      Invoice {credit.invoiceId}
                    </p>
                  </article>
                ))
              )}
            </div>
          </section>

          <section>
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
      </div>
    </main>
  );
}
