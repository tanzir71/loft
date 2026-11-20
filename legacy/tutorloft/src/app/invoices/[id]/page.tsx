import { and, eq } from "drizzle-orm";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";

import { BrandWordmark } from "@/components/brand-wordmark";
import { CopyTextButton } from "@/components/copy-text-button";
import { getDb } from "@/db";
import { parentLinks } from "@/db/schema";
import { Button } from "@/components/ui/button";
import { requireUser } from "@/lib/authz";
import { getInvoiceDetail } from "@/lib/billing";
import { paymentReminderMessage } from "@/lib/payment-reminders";

export const metadata: Metadata = {
  title: "Invoice",
};

function statusLabel(status: string) {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function requestOrigin(headerList: Headers) {
  const host = headerList.get("x-forwarded-host") ?? headerList.get("host") ?? "localhost:3000";
  const protocol = headerList.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${protocol}://${host}`;
}

async function canViewInvoice(input: {
  parentId?: string;
  role: "tutor" | "student" | "parent";
  studentId: string;
  userId: string;
}) {
  if (input.role === "tutor") {
    return true;
  }

  if (input.role === "student") {
    return input.studentId === input.userId;
  }

  const [link] = await getDb()
    .select({ studentId: parentLinks.studentId })
    .from(parentLinks)
    .where(
      and(
        eq(parentLinks.parentId, input.parentId ?? input.userId),
        eq(parentLinks.studentId, input.studentId),
      ),
    );

  return Boolean(link);
}

export default async function InvoiceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireUser();
  const { id } = await params;
  const detail = await getInvoiceDetail(getDb(), id);
  const origin = requestOrigin(await headers());
  const reminderMessage =
    detail.invoice.balance > 0 && detail.invoice.displayStatus !== "void"
      ? paymentReminderMessage({
          balance: detail.invoice.balance,
          dueDate: detail.invoice.dueDate,
          invoiceNumber: detail.invoice.number,
          invoiceUrl: new URL(`/invoices/${id}`, origin).toString(),
          studentName: detail.invoice.studentName,
        })
      : null;
  const canView = await canViewInvoice({
    role: user.role,
    studentId: detail.invoice.studentId,
    userId: user.id,
  });

  if (!canView) {
    notFound();
  }

  return (
    <main className="mx-auto max-w-4xl bg-white p-6 text-foreground print:p-0">
      <style>
        {`@media print {
          body { background: #fff !important; }
          .print-hidden { display: none !important; }
          main { max-width: none !important; padding: 0 !important; }
          article { border: 0 !important; box-shadow: none !important; }
        }`}
      </style>
      <div className="print-hidden mb-4">
        <Button asChild variant="outline">
          <a href="/billing">Back to billing</a>
        </Button>
      </div>

      <article className="rounded-2xl border bg-card p-8 shadow-soft">
        <header className="flex flex-col gap-4 border-b pb-6 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <BrandWordmark className="text-3xl" />
            <p className="mt-2 text-sm text-muted-foreground">Invoice tracking</p>
          </div>
          <div className="text-left sm:text-right">
            <p className="font-mono text-[10px] uppercase text-muted-foreground">Invoice</p>
            <h1 className="mt-1 text-2xl font-semibold">{detail.invoice.number}</h1>
            <p className="mt-2 text-sm">{statusLabel(detail.invoice.displayStatus)}</p>
          </div>
        </header>

        <section className="grid gap-4 border-b py-6 sm:grid-cols-2">
          <div>
            <p className="font-mono text-[10px] uppercase text-muted-foreground">Student</p>
            <p className="mt-1 text-lg font-semibold">{detail.invoice.studentName}</p>
          </div>
          <div className="sm:text-right">
            <p className="font-mono text-[10px] uppercase text-muted-foreground">Due</p>
            <p className="mt-1 font-mono">
              {new Date(detail.invoice.dueDate).toLocaleDateString("en-US")}
            </p>
          </div>
        </section>

        <section className="py-6">
          <table className="w-full text-left text-sm">
            <thead className="border-b font-mono text-[10px] uppercase text-muted-foreground">
              <tr>
                <th className="py-3">Description</th>
                <th className="py-3 text-right">Qty</th>
                <th className="py-3 text-right">Unit</th>
                <th className="py-3 text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {detail.items.map((item) => (
                <tr className="border-b" key={item.id}>
                  <td className="py-3">{item.description}</td>
                  <td className="py-3 text-right font-mono">{item.quantity}</td>
                  <td className="py-3 text-right font-mono">{item.unitAmount}</td>
                  <td className="py-3 text-right font-mono">{item.amount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="grid gap-3 border-t pt-6 sm:ml-auto sm:w-72">
          <div className="flex justify-between text-sm">
            <span>Total</span>
            <span className="font-mono">{detail.invoice.total}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span>Paid</span>
            <span className="font-mono">{detail.invoice.paidTotal}</span>
          </div>
          <div className="flex justify-between text-base font-semibold">
            <span>Balance</span>
            <span className="font-mono">{detail.invoice.balance}</span>
          </div>
        </section>

        {detail.payments.length > 0 ? (
          <section className="mt-8 border-t pt-6">
            <h2 className="text-lg font-semibold">Payments</h2>
            <div className="mt-3 grid gap-2">
              {detail.payments.map((payment) => (
                <div className="flex justify-between text-sm" key={payment.id}>
                  <span>
                    {statusLabel(payment.method)}
                    {payment.reference ? ` - ${payment.reference}` : ""}
                  </span>
                  <span className="font-mono">{payment.amount}</span>
                </div>
              ))}
            </div>
          </section>
        ) : null}
        {reminderMessage ? (
          <section className="print-hidden mt-8 border-t pt-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-lg font-semibold">Payment reminder</h2>
              <CopyTextButton text={reminderMessage} />
            </div>
            <textarea
              aria-label="Copy reminder message"
              className="mt-4 min-h-48 w-full rounded-xl border bg-background px-3 py-2 text-sm"
              readOnly
              value={reminderMessage}
            />
          </section>
        ) : null}
      </article>
    </main>
  );
}
