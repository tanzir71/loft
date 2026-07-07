import { NextResponse } from "next/server";

import { getDb } from "@/db";
import { isCronRequestAuthorized, runCronTasks } from "@/lib/cron";

async function handleCron(request: Request) {
  const secret = process.env.CRON_SECRET ?? "";

  if (!secret.trim()) {
    return NextResponse.json({ error: "CRON_SECRET is not configured." }, { status: 503 });
  }

  if (!isCronRequestAuthorized(request, secret)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const result = await runCronTasks(getDb());

  return NextResponse.json({ ok: true, result });
}

export const GET = handleCron;
export const POST = handleCron;
