import { asc, eq } from "drizzle-orm";
import type { Metadata } from "next";
import { CalendarPlus, Power, Save } from "lucide-react";
import { redirect } from "next/navigation";

import { getDb } from "@/db";
import { courses, scheduleSlots } from "@/db/schema";
import { Button } from "@/components/ui/button";
import { requireTutor } from "@/lib/authz";
import {
  createScheduleSlot,
  deactivateScheduleSlot,
  generateSessions,
  updateScheduleSlot,
} from "@/lib/schedule";

export const metadata: Metadata = {
  title: "Schedule",
};

const weekdays = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

function minutesToTime(minutes: number) {
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function timeToMinutes(value: string) {
  const [hourText, minuteText] = value.split(":");
  const hour = Number(hourText);
  const minute = Number(minuteText);

  if (!Number.isInteger(hour) || !Number.isInteger(minute)) {
    return 0;
  }

  return hour * 60 + minute;
}

function startOfUtcToday() {
  const now = new Date();
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
}

async function createSlotAction(formData: FormData) {
  "use server";

  await requireTutor();
  await createScheduleSlot(getDb(), {
    courseId: String(formData.get("courseId") ?? ""),
    weekday: Number(formData.get("weekday") ?? 0),
    startMin: timeToMinutes(String(formData.get("startTime") ?? "")),
    durationMin: Number(formData.get("durationMin") ?? 0),
  });

  redirect("/schedule?created=1");
}

async function updateSlotAction(formData: FormData) {
  "use server";

  await requireTutor();
  await updateScheduleSlot(getDb(), {
    id: String(formData.get("slotId") ?? ""),
    weekday: Number(formData.get("weekday") ?? 0),
    startMin: timeToMinutes(String(formData.get("startTime") ?? "")),
    durationMin: Number(formData.get("durationMin") ?? 0),
  });

  redirect("/schedule?updated=1");
}

async function deactivateSlotAction(formData: FormData) {
  "use server";

  await requireTutor();
  await deactivateScheduleSlot(getDb(), {
    id: String(formData.get("slotId") ?? ""),
  });

  redirect("/schedule?deactivated=1");
}

async function generateSessionsAction(formData: FormData) {
  "use server";

  await requireTutor();
  const result = await generateSessions(getDb(), {
    from: startOfUtcToday(),
    weeks: Number(formData.get("weeks") ?? 1),
  });
  const params = new URLSearchParams({
    created: String(result.created),
    skipped: String(result.skipped),
  });

  redirect(`/schedule?${params.toString()}`);
}

export default async function SchedulePage({
  searchParams,
}: {
  searchParams: Promise<{ created?: string; skipped?: string }>;
}) {
  await requireTutor();

  const params = await searchParams;
  const database = getDb();
  const [courseRows, slotRows] = await Promise.all([
    database
      .select()
      .from(courses)
      .where(eq(courses.status, "active"))
      .orderBy(asc(courses.title)),
    database
      .select({
        id: scheduleSlots.id,
        courseId: scheduleSlots.courseId,
        courseTitle: courses.title,
        weekday: scheduleSlots.weekday,
        startMin: scheduleSlots.startMin,
        durationMin: scheduleSlots.durationMin,
        active: scheduleSlots.active,
      })
      .from(scheduleSlots)
      .innerJoin(courses, eq(scheduleSlots.courseId, courses.id))
      .orderBy(asc(courses.title), asc(scheduleSlots.weekday), asc(scheduleSlots.startMin)),
  ]);

  return (
    <main className="mx-auto max-w-6xl p-6">
      <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
        <section className="w-full max-w-md rounded-2xl border bg-card p-6 shadow-soft">
          <p className="font-mono text-[10px] uppercase text-muted-foreground">Weekly plan</p>
          <h1 className="mt-3 font-display text-3xl italic">Schedule</h1>
          {params.created !== undefined && params.skipped !== undefined ? (
            <p className="mt-4 rounded-xl border border-accent/30 bg-accent/10 px-4 py-3 text-sm">
              Created {params.created} sessions. Skipped {params.skipped} existing sessions.
            </p>
          ) : null}
          <form action={createSlotAction} className="mt-6 space-y-4">
            <label className="block text-sm font-medium" htmlFor="courseId">
              Course
            </label>
            <select
              className="h-11 w-full rounded-xl border bg-background px-3 text-sm"
              id="courseId"
              name="courseId"
              required
            >
              <option value="">Choose course</option>
              {courseRows.map((course) => (
                <option key={course.id} value={course.id}>
                  {course.title}
                </option>
              ))}
            </select>
            <label className="block text-sm font-medium" htmlFor="weekday">
              Weekday
            </label>
            <select
              className="h-11 w-full rounded-xl border bg-background px-3 text-sm"
              id="weekday"
              name="weekday"
              defaultValue="1"
            >
              {weekdays.map((day, index) => (
                <option key={day} value={index}>
                  {day}
                </option>
              ))}
            </select>
            <label className="block text-sm font-medium" htmlFor="startTime">
              Start time
            </label>
            <input
              className="h-11 w-full rounded-xl border bg-background px-3 text-sm"
              id="startTime"
              name="startTime"
              required
              type="time"
            />
            <label className="block text-sm font-medium" htmlFor="durationMin">
              Duration minutes
            </label>
            <input
              className="h-11 w-full rounded-xl border bg-background px-3 text-sm"
              id="durationMin"
              min={1}
              name="durationMin"
              required
              type="number"
            />
            <Button type="submit" variant="gradient">
              <CalendarPlus className="h-4 w-4" aria-hidden="true" />
              Add slot
            </Button>
          </form>

          <form action={generateSessionsAction} className="mt-8 border-t pt-6">
            <label className="block text-sm font-medium" htmlFor="weeks">
              Weeks to generate
            </label>
            <div className="mt-3 flex gap-3">
              <input
                className="h-11 w-24 rounded-xl border bg-background px-3 text-sm"
                defaultValue={2}
                id="weeks"
                min={1}
                name="weeks"
                type="number"
              />
              <Button type="submit" variant="outline">
                Generate sessions
              </Button>
            </div>
          </form>
        </section>

        <section className="flex-1">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold">Weekly slots</h2>
            <span className="font-mono text-[10px] uppercase text-muted-foreground">
              {slotRows.length} total
            </span>
          </div>
          <div className="grid gap-3">
            {slotRows.length === 0 ? (
              <div className="rounded-2xl border bg-card p-8 text-center shadow-soft">
                <p className="font-display text-2xl italic">No weekly slots yet.</p>
              </div>
            ) : (
              slotRows.map((slot) => (
                <article className="rounded-2xl border bg-card p-4 shadow-soft" key={slot.id}>
                  <div className="mb-4 flex flex-wrap items-center gap-2">
                    <span
                      className={
                        slot.active
                          ? "rounded-full bg-accent/10 px-3 py-1 text-xs font-medium text-accent"
                          : "rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground"
                      }
                    >
                      {slot.active ? "Active" : "Inactive"}
                    </span>
                    <span className="font-mono text-xs text-muted-foreground">
                      {weekdays[slot.weekday]}
                    </span>
                    <span className="font-mono text-xs text-muted-foreground">
                      {minutesToTime(slot.startMin)}
                    </span>
                    <span className="font-mono text-xs text-muted-foreground">
                      {slot.durationMin} min
                    </span>
                  </div>
                  <h3 className="text-lg font-semibold">{slot.courseTitle}</h3>
                  <form
                    action={updateSlotAction}
                    className="mt-4 grid gap-3 md:grid-cols-[1fr_130px_120px_auto]"
                  >
                    <input name="slotId" type="hidden" value={slot.id} />
                    <select
                      aria-label={`Weekday for ${slot.courseTitle}`}
                      className="h-10 rounded-xl border bg-background px-3 text-sm"
                      name="weekday"
                      defaultValue={String(slot.weekday)}
                    >
                      {weekdays.map((day, index) => (
                        <option key={day} value={index}>
                          {day}
                        </option>
                      ))}
                    </select>
                    <input
                      aria-label={`Start time for ${slot.courseTitle}`}
                      className="h-10 rounded-xl border bg-background px-3 text-sm"
                      name="startTime"
                      defaultValue={minutesToTime(slot.startMin)}
                      type="time"
                    />
                    <input
                      aria-label={`Duration minutes for ${slot.courseTitle}`}
                      className="h-10 rounded-xl border bg-background px-3 text-sm"
                      min={1}
                      name="durationMin"
                      defaultValue={slot.durationMin}
                      type="number"
                    />
                    <Button aria-label={`Save slot for ${slot.courseTitle}`} size="sm" type="submit">
                      <Save className="h-4 w-4" aria-hidden="true" />
                      Save
                    </Button>
                  </form>
                  <form action={deactivateSlotAction} className="mt-3">
                    <input name="slotId" type="hidden" value={slot.id} />
                    <Button
                      aria-label={`Deactivate slot for ${slot.courseTitle}`}
                      size="sm"
                      type="submit"
                      variant="outline"
                    >
                      <Power className="h-4 w-4" aria-hidden="true" />
                      Deactivate
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
