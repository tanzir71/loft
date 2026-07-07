import { eq } from "drizzle-orm";

import { getDb } from "@/db";
import { users } from "@/db/schema";
import { calendarEventsForUser } from "@/lib/calendar-feed";
import { buildIcsCalendar } from "@/lib/ics";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const database = getDb();
  const [user] = await database.select().from(users).where(eq(users.icsToken, token));

  if (!user) {
    return new Response("Not found", { status: 404 });
  }

  const events = await calendarEventsForUser(database, user);
  const calendar = buildIcsCalendar({
    name: `${user.name || "TutorLoft"} Schedule`,
    events,
  });

  return new Response(calendar, {
    headers: {
      "Cache-Control": "private, max-age=300",
      "Content-Disposition": "inline; filename=tutorloft.ics",
      "Content-Type": "text/calendar; charset=utf-8",
    },
  });
}
