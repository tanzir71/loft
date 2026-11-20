import { getDb } from "@/db";
import { requireTutor } from "@/lib/authz";
import { invoicesCsv } from "@/lib/billing";

export async function GET() {
  await requireTutor();
  const csv = await invoicesCsv(getDb());

  return new Response(csv, {
    headers: {
      "Content-Disposition": 'attachment; filename="invoices.csv"',
      "Content-Type": "text/csv; charset=utf-8",
    },
  });
}
