import { NextResponse } from "next/server";

import { getDb } from "@/db";
import { requireTutor } from "@/lib/authz";
import { gradebookCsv } from "@/lib/gradebook";

export async function GET(request: Request) {
  await requireTutor();
  const { searchParams } = new URL(request.url);
  const courseId = searchParams.get("courseId") ?? "";
  const csv = await gradebookCsv(getDb(), { courseId });

  return new NextResponse(csv, {
    headers: {
      "Content-Disposition": 'attachment; filename="gradebook.csv"',
      "Content-Type": "text/csv; charset=utf-8",
    },
  });
}
