import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";

import { BrandWordmark } from "@/components/brand-wordmark";
import { CopyTextButton } from "@/components/copy-text-button";
import { PrintButton } from "@/components/print-button";
import { Button } from "@/components/ui/button";
import { getDb } from "@/db";
import { requireUser } from "@/lib/authz";
import { renderMarkdown } from "@/lib/markdown";
import {
  canViewProgressReport,
  getProgressReportDetail,
  progressReportPeriodLabel,
} from "@/lib/progress-reports";

export const metadata: Metadata = {
  title: "Progress report",
};

function requestOrigin(headerList: Headers) {
  const host = headerList.get("x-forwarded-host") ?? headerList.get("host") ?? "localhost:3000";
  const protocol =
    headerList.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${protocol}://${host}`;
}

function backHref(role: "tutor" | "student" | "parent") {
  if (role === "student") {
    return "/home";
  }

  if (role === "parent") {
    return "/overview";
  }

  return "/students";
}

export default async function ProgressReportPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireUser();
  const { id } = await params;
  const database = getDb();
  let report;

  try {
    report = await getProgressReportDetail(database, id);
  } catch {
    notFound();
  }

  if (!(await canViewProgressReport(database, { studentId: report.studentId, user }))) {
    notFound();
  }

  const shareUrl = new URL(`/progress-reports/${report.id}`, requestOrigin(await headers())).toString();

  return (
    <main className="mx-auto max-w-3xl bg-white p-6 text-foreground print:p-0">
      <style>
        {`@media print {
          body { background: #fff !important; }
          .print-hidden { display: none !important; }
          main { max-width: none !important; padding: 0 !important; }
          article { border: 0 !important; box-shadow: none !important; }
        }`}
      </style>
      <div className="print-hidden mb-6 flex flex-wrap gap-2">
        <Button asChild variant="outline">
          <a href={backHref(user.role)}>Back</a>
        </Button>
        <CopyTextButton label="Copy share link" text={shareUrl} />
        <PrintButton />
      </div>
      <article className="rounded-2xl border bg-card p-8 shadow-soft">
        <header className="border-b pb-6">
          <BrandWordmark className="text-3xl" />
          <p className="mt-5 font-mono text-[10px] uppercase text-muted-foreground">
            {progressReportPeriodLabel(report)}
          </p>
          <h1 className="mt-2 font-display text-4xl italic">
            Progress report: {report.studentName}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">{report.studentEmail}</p>
        </header>
        <div
          className="mt-6 text-sm leading-7 text-foreground"
          dangerouslySetInnerHTML={{ __html: renderMarkdown(report.bodyMd) }}
        />
      </article>
    </main>
  );
}
