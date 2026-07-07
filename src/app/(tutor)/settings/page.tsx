import { eq } from "drizzle-orm";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { getDb } from "@/db";
import { users } from "@/db/schema";
import { Button } from "@/components/ui/button";
import { requireTutor } from "@/lib/authz";
import { hasEmail } from "@/lib/features";
import { deliverInvite } from "@/lib/invite-delivery";
import { createInvite, listInvites } from "@/lib/invites";

export const metadata: Metadata = {
  title: "Settings",
};

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

async function createInviteAction(formData: FormData) {
  "use server";

  const tutor = await requireTutor();

  const role = String(formData.get("role"));
  const studentId = String(formData.get("studentId") ?? "") || undefined;
  const recipientEmail = String(formData.get("recipientEmail") ?? "");

  if (role !== "student" && role !== "parent") {
    throw new Error("Invalid invite role.");
  }

  const invite = await createInvite(getDb(), {
    role,
    studentId: role === "parent" ? studentId : undefined,
  });
  const origin = requestOrigin(await headers());
  const inviteUrl = new URL(`/join/${invite.code}`, origin).toString();
  const delivery = await deliverInvite({
    inviteUrl,
    recipientEmail,
    role,
    tutorName: tutor.name,
  });
  const params = new URLSearchParams({
    created: invite.code,
    delivery: delivery.mode,
    inviteUrl,
  });

  if (delivery.mode === "copy") {
    params.set("reason", delivery.reason);
  } else {
    params.set("recipient", delivery.recipientEmail);
  }

  redirect(`/settings?${params.toString()}`);
}

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{
    created?: string;
    delivery?: "copy" | "email";
    inviteUrl?: string;
    reason?: string;
    recipient?: string;
  }>;
}) {
  await requireTutor();

  const params = await searchParams;
  const database = getDb();
  const emailEnabled = hasEmail();
  const origin = requestOrigin(await headers());
  const createdInviteUrl = params.inviteUrl ?? (
    params.created ? new URL(`/join/${params.created}`, origin).toString() : null
  );
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
          {createdInviteUrl ? (
            <div className="mt-4 rounded-xl border border-accent/30 bg-accent/10 px-4 py-3 text-sm">
              <p className="font-medium">
                {params.delivery === "email" && params.recipient
                  ? `Invite email sent to ${params.recipient}.`
                  : params.reason === "email_failed"
                    ? "Email could not be sent. Copy this invite link."
                    : emailEnabled
                      ? "Copy this invite link."
                      : "Email is off. Copy this invite link."}
              </p>
              <code className="mt-2 block break-all font-mono">{createdInviteUrl}</code>
            </div>
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
            <label className="block text-sm font-medium" htmlFor="recipientEmail">
              Recipient email
            </label>
            <input
              className="h-11 w-full rounded-xl border bg-background px-3 text-sm"
              id="recipientEmail"
              name="recipientEmail"
              placeholder={emailEnabled ? "student@example.com" : "Email is off"}
              type="email"
            />
            <p className="text-xs text-muted-foreground">
              {emailEnabled
                ? "If provided, TutorLoft emails the invite. The link is still shown after creation."
                : "Set RESEND_API_KEY to email invites. Until then, share the generated link manually."}
            </p>
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
                    <td className="px-4 py-3 font-mono">
                      {new URL(`/join/${invite.code}`, origin).toString()}
                    </td>
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
