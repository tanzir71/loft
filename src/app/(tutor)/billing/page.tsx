import { and, asc, eq } from "drizzle-orm";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { Archive, PackageCheck, Plus, RefreshCw, Save } from "lucide-react";
import { redirect } from "next/navigation";

import { getDb } from "@/db";
import { ratePlans, users } from "@/db/schema";
import { Button } from "@/components/ui/button";
import { requireTutor, requireUser } from "@/lib/authz";
import {
  archiveRatePlan,
  consumePackageCreditsForAttendedSessions,
  createRatePlan,
  getInvoiceDetail,
  listPackageCredits,
  listParentInvoices,
  listStudentInvoices,
  listTutorInvoices,
  markInvoiceSent,
  recordPayment,
  sellPackage,
  updateRatePlan,
  voidInvoice,
} from "@/lib/billing";
import { deliverInvoice } from "@/lib/invoice-delivery";

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

function paymentMethod(value: FormDataEntryValue | null) {
  const raw = String(value ?? "");
  return raw === "bank" || raw === "bkash" || raw === "nagad" || raw === "other" ? raw : "cash";
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

function statusLabel(status: string) {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function requestOrigin(requestHeaders: Headers) {
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");

  if (!host) {
    return "http://localhost:3000";
  }

  const protocol =
    requestHeaders.get("x-forwarded-proto") ??
    (host.startsWith("localhost") || host.startsWith("127.0.0.1") ? "http" : "https");

  return `${protocol}://${host}`;
}

type InvoiceSummary = Awaited<ReturnType<typeof listTutorInvoices>>[number];

function outstandingBalance(invoices: InvoiceSummary[]) {
  return invoices.reduce(
    (sum, invoice) => sum + (invoice.displayStatus === "void" ? 0 : invoice.balance),
    0,
  );
}

function ReadOnlyBillingView({
  invoices,
  title,
}: {
  invoices: InvoiceSummary[];
  title: string;
}) {
  return (
    <main className="mx-auto max-w-3xl p-6">
      <h1 className="font-display text-3xl italic">Billing</h1>
      <section className="mt-6 rounded-2xl border bg-card p-6 shadow-soft">
        <p className="font-mono text-[10px] uppercase text-muted-foreground">{title}</p>
        <div className="mt-3 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Outstanding balance</h2>
            <p className="mt-2 font-mono text-3xl">{outstandingBalance(invoices)}</p>
          </div>
          <span className="rounded-full bg-muted px-3 py-1 text-xs font-medium">
            {invoices.length} invoices
          </span>
        </div>
      </section>

      <section className="mt-8">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Invoices</h2>
          <span className="font-mono text-[10px] uppercase text-muted-foreground">
            {invoices.length} total
          </span>
        </div>
        {invoices.length === 0 ? (
          <div className="rounded-2xl border bg-card p-8 text-center shadow-soft">
            <p className="font-display text-2xl italic">No invoices yet.</p>
          </div>
        ) : (
          <div className="grid gap-3">
            {invoices.map((invoice) => (
              <article className="rounded-2xl border bg-card p-5 shadow-soft" key={invoice.id}>
                <p className="font-mono text-[10px] uppercase text-muted-foreground">
                  {invoice.studentName}
                </p>
                <h3 className="mt-2 text-lg font-semibold">{invoice.number}</h3>
                <div className="mt-3 flex flex-wrap gap-2 text-xs font-medium">
                  <span className="rounded-full bg-muted px-3 py-1">
                    {statusLabel(invoice.displayStatus)}
                  </span>
                  <span className="rounded-full bg-muted px-3 py-1">
                    Total {invoice.total}
                  </span>
                  <span className="rounded-full bg-muted px-3 py-1">
                    Paid {invoice.paidTotal}
                  </span>
                  <span className="rounded-full bg-muted px-3 py-1">
                    Balance {invoice.displayStatus === "void" ? 0 : invoice.balance}
                  </span>
                </div>
                <Button asChild className="mt-4" size="sm" variant="outline">
                  <a href={`/invoices/${invoice.id}`}>View invoice</a>
                </Button>
              </article>
            ))}
          </div>
        )}
      </section>
    </main>
  );
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

async function markInvoiceSentAction(formData: FormData) {
  "use server";

  await requireTutor();
  await markInvoiceSent(getDb(), {
    id: String(formData.get("invoiceId") ?? ""),
  });

  redirect("/billing?invoiceSent=1");
}

async function voidInvoiceAction(formData: FormData) {
  "use server";

  await requireTutor();
  await voidInvoice(getDb(), {
    id: String(formData.get("invoiceId") ?? ""),
  });

  redirect("/billing?invoiceVoided=1");
}

async function recordPaymentAction(formData: FormData) {
  "use server";

  await requireTutor();
  await recordPayment(getDb(), {
    amount: Number(formData.get("amount") ?? 0),
    invoiceId: String(formData.get("invoiceId") ?? ""),
    method: paymentMethod(formData.get("method")),
    paidAt: dateStart(formData.get("paidAt")) ?? undefined,
    reference: String(formData.get("reference") ?? "") || null,
  });

  redirect("/billing?paymentRecorded=1");
}

async function emailInvoiceAction(formData: FormData) {
  "use server";

  await requireTutor();
  const invoiceId = String(formData.get("invoiceId") ?? "");
  const recipientEmail = String(formData.get("recipientEmail") ?? "");
  const detail = await getInvoiceDetail(getDb(), invoiceId);
  const origin = requestOrigin(await headers());
  const invoiceUrl = new URL(`/invoices/${invoiceId}`, origin).toString();
  const delivery = await deliverInvoice({
    invoiceNumber: detail.invoice.number,
    invoiceUrl,
    recipientEmail,
    studentName: detail.invoice.studentName,
  });
  const params = new URLSearchParams({
    invoiceDelivery: delivery.mode,
    invoiceNumber: detail.invoice.number,
    invoiceUrl,
  });

  if (delivery.mode === "copy") {
    params.set("reason", delivery.reason);
  } else {
    params.set("recipient", delivery.recipientEmail);
  }

  redirect(`/billing?${params.toString()}`);
}

export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<{
    invoiceDelivery?: "copy" | "email";
    invoiceNumber?: string;
    invoiceUrl?: string;
    reason?: string;
    recipient?: string;
  }>;
}) {
  const user = await requireUser();
  const database = getDb();
  const params = await searchParams;

  if (user.role === "student") {
    const invoices = await listStudentInvoices(database, user.id);
    return <ReadOnlyBillingView invoices={invoices} title="Student billing" />;
  }

  if (user.role === "parent") {
    const invoices = await listParentInvoices(database, user.id);
    return <ReadOnlyBillingView invoices={invoices} title="Parent billing" />;
  }

  const [plans, students, packageCredits, invoiceRows] = await Promise.all([
    database.select().from(ratePlans).orderBy(asc(ratePlans.name)),
    database
      .select({ email: users.email, id: users.id, name: users.name })
      .from(users)
      .where(and(eq(users.role, "student"), eq(users.status, "active")))
      .orderBy(asc(users.name)),
    listPackageCredits(database),
    listTutorInvoices(database),
  ]);
  const activePackagePlans = plans.filter((plan) => plan.active && plan.type === "package");

  return (
    <main className="mx-auto max-w-6xl p-6">
      {params.invoiceDelivery && params.invoiceUrl ? (
        <div className="mb-6 rounded-2xl border border-accent/30 bg-accent/10 px-4 py-3 text-sm">
          <p className="font-medium">
            {params.invoiceDelivery === "email" && params.recipient
              ? `Invoice ${params.invoiceNumber} emailed to ${params.recipient}.`
              : params.reason === "email_failed"
                ? "Email could not be sent. Copy this invoice link."
                : "Email is off. Copy this invoice link."}
          </p>
          <code className="mt-2 block break-all font-mono">{params.invoiceUrl}</code>
        </div>
      ) : null}
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
              <h2 className="text-lg font-semibold">Invoices</h2>
              <span className="font-mono text-[10px] uppercase text-muted-foreground">
                {invoiceRows.length} total
              </span>
            </div>
            <div className="grid gap-3">
              {invoiceRows.length === 0 ? (
                <div className="rounded-2xl border bg-card p-8 text-center shadow-soft">
                  <p className="font-display text-2xl italic">No invoices yet.</p>
                </div>
              ) : (
                invoiceRows.map((invoice) => (
                  <article
                    aria-label={`Invoice ${invoice.number}`}
                    className="rounded-2xl border bg-card p-4 shadow-soft"
                    key={invoice.id}
                  >
                    <p className="font-mono text-[10px] uppercase text-muted-foreground">
                      {invoice.studentName}
                    </p>
                    <h3 className="mt-2 text-lg font-semibold">{invoice.number}</h3>
                    <div className="mt-3 flex flex-wrap gap-2 text-xs font-medium">
                      <span className="rounded-full bg-muted px-3 py-1">
                        {statusLabel(invoice.displayStatus)}
                      </span>
                      <span className="rounded-full bg-muted px-3 py-1">
                        Total {invoice.total}
                      </span>
                      <span className="rounded-full bg-muted px-3 py-1">
                        Paid {invoice.paidTotal}
                      </span>
                      <span className="rounded-full bg-muted px-3 py-1">
                        Balance {invoice.balance}
                      </span>
                    </div>
                    {invoice.displayStatus === "void" ? null : (
                      <div className="mt-4 flex flex-wrap gap-2">
                        <form action={markInvoiceSentAction}>
                          <input name="invoiceId" type="hidden" value={invoice.id} />
                          <Button
                            aria-label={`Send ${invoice.number}`}
                            size="sm"
                            type="submit"
                            variant="outline"
                          >
                            Send
                          </Button>
                        </form>
                        <form action={voidInvoiceAction}>
                          <input name="invoiceId" type="hidden" value={invoice.id} />
                          <Button
                            aria-label={`Void ${invoice.number}`}
                            size="sm"
                            type="submit"
                            variant="outline"
                          >
                            Void
                          </Button>
                        </form>
                      </div>
                    )}
                    {invoice.displayStatus === "void" ? null : (
                      <form
                        action={emailInvoiceAction}
                        className="mt-4 grid gap-3 md:grid-cols-[1fr_auto]"
                      >
                        <input name="invoiceId" type="hidden" value={invoice.id} />
                        <div>
                          <label
                            className="block text-xs font-medium"
                            htmlFor={`recipient-${invoice.id}`}
                          >
                            Invoice recipient for {invoice.number}
                          </label>
                          <input
                            className="mt-1 h-10 w-full rounded-xl border bg-background px-3 text-sm"
                            defaultValue={invoice.studentEmail}
                            id={`recipient-${invoice.id}`}
                            name="recipientEmail"
                            type="email"
                          />
                        </div>
                        <Button
                          aria-label={`Email ${invoice.number}`}
                          className="self-end"
                          size="sm"
                          type="submit"
                          variant="outline"
                        >
                          Email invoice
                        </Button>
                      </form>
                    )}
                    {invoice.displayStatus === "void" ? null : (
                      <form
                        action={recordPaymentAction}
                        className="mt-4 grid gap-3 md:grid-cols-[130px_120px_1fr_140px_auto]"
                      >
                        <input name="invoiceId" type="hidden" value={invoice.id} />
                        <div>
                          <label
                            className="block text-xs font-medium"
                            htmlFor={`amount-${invoice.id}`}
                          >
                            Payment amount for {invoice.number}
                          </label>
                          <input
                            className="mt-1 h-10 w-full rounded-xl border bg-background px-3 text-sm"
                            id={`amount-${invoice.id}`}
                            min={1}
                            name="amount"
                            required
                            type="number"
                          />
                        </div>
                        <div>
                          <label
                            className="block text-xs font-medium"
                            htmlFor={`method-${invoice.id}`}
                          >
                            Payment method for {invoice.number}
                          </label>
                          <select
                            className="mt-1 h-10 w-full rounded-xl border bg-background px-3 text-sm"
                            id={`method-${invoice.id}`}
                            name="method"
                            defaultValue="cash"
                          >
                            <option value="cash">Cash</option>
                            <option value="bank">Bank</option>
                            <option value="bkash">bKash</option>
                            <option value="nagad">Nagad</option>
                            <option value="other">Other</option>
                          </select>
                        </div>
                        <div>
                          <label
                            className="block text-xs font-medium"
                            htmlFor={`reference-${invoice.id}`}
                          >
                            Payment reference for {invoice.number}
                          </label>
                          <input
                            className="mt-1 h-10 w-full rounded-xl border bg-background px-3 text-sm"
                            id={`reference-${invoice.id}`}
                            name="reference"
                          />
                        </div>
                        <div>
                          <label
                            className="block text-xs font-medium"
                            htmlFor={`paidAt-${invoice.id}`}
                          >
                            Payment date for {invoice.number}
                          </label>
                          <input
                            className="mt-1 h-10 w-full rounded-xl border bg-background px-3 text-sm"
                            id={`paidAt-${invoice.id}`}
                            name="paidAt"
                            type="date"
                          />
                        </div>
                        <Button
                          aria-label={`Record payment for ${invoice.number}`}
                          className="self-end"
                          size="sm"
                          type="submit"
                          variant="gradient"
                        >
                          Record payment
                        </Button>
                      </form>
                    )}
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
