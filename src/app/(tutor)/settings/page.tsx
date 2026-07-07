import { eq } from "drizzle-orm";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { getDb } from "@/db";
import { users } from "@/db/schema";
import { Button } from "@/components/ui/button";
import { requireTutor } from "@/lib/authz";
import { createInvite, listInvites } from "@/lib/invites";

export const metadata: Metadata = {
  title: "Settings",
};

async function createInviteAction(formData: FormData) {
  "use server";

  await requireTutor();

  const role = String(formData.get("role"));
  const studentId = String(formData.get("studentId") ?? "") || undefined;

  if (role !== "student" && role !== "parent") {
    throw new Error("Invalid invite role.");
  }

  const invite = await createInvite(getDb(), {
    role,
    studentId: role === "parent" ? studentId : undefined,
  });

  redirect(`/settings?created=${invite.code}`);
}

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ created?: string }>;
}) {
  await requireTutor();

  const params = await searchParams;
  const database = getDb();
  const [inviteRows, students] = await Promise.all([
    listInvites(database),
    database.select().from(users).where(eq(users.role, "student")),
  ]);

  return (
    <main className="mx-auto max-w-6xl p-6">
      <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
        <section className="w-full max-w-md rounded-2xl border bg-card p-6 shadow-soft">
          <p className="font-mono text-[10px] uppercase text-muted-foreground">Invites</p>
          <h1 className="mt-3 font-display text-3xl italic">Settings</h1>
          {params.created ? (
            <p className="mt-4 rounded-xl border border-accent/30 bg-accent/10 px-4 py-3 text-sm">
              Invite link:{" "}
              <code className="font-mono">/join/{params.created}</code>
            </p>
          ) : null}
          <form action={createInviteAction} className="mt-6 space-y-4">
            <label className="block text-sm font-medium" htmlFor="role">
              Role
            </label>
            <select
              className="h-11 w-full rounded-xl border bg-background px-3 text-sm"
              id="role"
              name="role"
              defaultValue="student"
            >
              <option value="student">Student</option>
              <option value="parent">Parent</option>
            </select>
            <label className="block text-sm font-medium" htmlFor="studentId">
              Linked student for parent invites
            </label>
            <select
              className="h-11 w-full rounded-xl border bg-background px-3 text-sm"
              id="studentId"
              name="studentId"
              defaultValue=""
            >
              <option value="">None</option>
              {students.map((student) => (
                <option key={student.id} value={student.id}>
                  {student.name} ({student.email})
                </option>
              ))}
            </select>
            <Button type="submit" variant="gradient">
              Create invite
            </Button>
          </form>
        </section>

        <section className="flex-1 rounded-2xl border bg-card p-6 shadow-soft">
          <h2 className="text-lg font-semibold">Invite list</h2>
          <div className="mt-4 overflow-hidden rounded-xl border">
            <table className="w-full text-left text-sm">
              <thead className="bg-muted font-mono text-[10px] uppercase text-muted-foreground">
                <tr>
                  <th className="px-4 py-3">Code</th>
                  <th className="px-4 py-3">Role</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Expires</th>
                </tr>
              </thead>
              <tbody>
                {inviteRows.map((invite) => (
                  <tr className="border-t" key={invite.id}>
                    <td className="px-4 py-3 font-mono">/join/{invite.code}</td>
                    <td className="px-4 py-3">{invite.role}</td>
                    <td className="px-4 py-3">{invite.usedBy ? "Used" : "Open"}</td>
                    <td className="px-4 py-3 font-mono">
                      {new Date(invite.expiresAt).toLocaleDateString("en-US")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </main>
  );
}
