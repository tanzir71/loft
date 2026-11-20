import { eq } from "drizzle-orm";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { getDb } from "@/db";
import { users } from "@/db/schema";
import { Button } from "@/components/ui/button";
import { readAiSettings, saveAiSettings, testAiSettings } from "@/lib/ai-settings";
import { requireTutor } from "@/lib/authz";
import { regenerateIcsToken } from "@/lib/calendar-feed";
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

function encryptionSecret() {
  return process.env.AUTH_SECRET ?? "dev-only-change-me-for-production";
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

async function regenerateCalendarFeedAction() {
  "use server";

  const tutor = await requireTutor();
  await regenerateIcsToken(getDb(), tutor.id);

  redirect("/settings?calendar=regenerated");
}

async function saveAiSettingsAction(formData: FormData) {
  "use server";

  await requireTutor();
  await saveAiSettings(getDb(), {
    apiKey: String(formData.get("apiKey") ?? ""),
    encryptionSecret: encryptionSecret(),
    model: String(formData.get("model") ?? ""),
    provider: String(formData.get("provider") ?? "openrouter"),
  });

  redirect("/settings?ai=saved");
}

async function testAiSettingsAction() {
  "use server";

  await requireTutor();
  const result = await testAiSettings(getDb(), {
    encryptionSecret: encryptionSecret(),
  });
  const params = new URLSearchParams({
    aiTest: result.ok ? "ok" : result.reason,
  });

  redirect(`/settings?${params.toString()}`);
}

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{
    ai?: "saved";
    aiTest?: "ok" | "missing_key" | "invalid_key";
    created?: string;
    delivery?: "copy" | "email";
    inviteUrl?: string;
    reason?: string;
    recipient?: string;
  }>;
}) {
  const tutor = await requireTutor();

  const params = await searchParams;
  const database = getDb();
  const emailEnabled = hasEmail();
  const origin = requestOrigin(await headers());
  const createdInviteUrl = params.inviteUrl ?? (
    params.created ? new URL(`/join/${params.created}`, origin).toString() : null
  );
  const [inviteRows, students, tutorRows] = await Promise.all([
    listInvites(database),
    database.select().from(users).where(eq(users.role, "student")),
    database.select({ icsToken: users.icsToken }).from(users).where(eq(users.id, tutor.id)),
  ]);
  const aiSettings = await readAiSettings(database);
  const tutorIcsToken = tutorRows[0]?.icsToken ?? null;
  const calendarFeedUrl = tutorIcsToken
    ? new URL(`/api/ics/${tutorIcsToken}`, origin).toString()
    : null;

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

          <form action={regenerateCalendarFeedAction} className="mt-8 border-t pt-6">
            <p className="font-mono text-[10px] uppercase text-muted-foreground">
              Calendar feed
            </p>
            {calendarFeedUrl ? (
              <code className="mt-3 block break-all rounded-xl border bg-background px-3 py-2 font-mono text-xs">
                {calendarFeedUrl}
              </code>
            ) : null}
            <Button className="mt-4" type="submit" variant="outline">
              {calendarFeedUrl ? "Regenerate calendar feed" : "Generate calendar feed"}
            </Button>
          </form>

          <section className="mt-8 border-t pt-6">
            <p className="font-mono text-[10px] uppercase text-muted-foreground">
              Backup
            </p>
            <p className="mt-3 text-sm text-muted-foreground">
              Download a JSON snapshot of TutorLoft tables for safekeeping.
            </p>
            <Button asChild className="mt-4" variant="outline">
              <a href="/settings/backup.json">Download JSON backup</a>
            </Button>
          </section>

          <section className="mt-8 border-t pt-6">
            <p className="font-mono text-[10px] uppercase text-muted-foreground">
              AI settings
            </p>
            {params.ai === "saved" ? (
              <div className="mt-4 rounded-xl border border-accent/30 bg-accent/10 px-4 py-3 text-sm">
                AI settings saved.
              </div>
            ) : null}
            {params.aiTest ? (
              <div className="mt-4 rounded-xl border border-accent/30 bg-accent/10 px-4 py-3 text-sm">
                {params.aiTest === "ok"
                  ? "AI key decrypted successfully."
                  : params.aiTest === "missing_key"
                    ? "Save an AI key before testing."
                    : "Saved AI key could not be decrypted."}
              </div>
            ) : null}
            <form action={saveAiSettingsAction} className="mt-6 space-y-4">
              <label className="block text-sm font-medium" htmlFor="provider">
                Provider
              </label>
              <select
                className="h-11 w-full rounded-xl border bg-background px-3 text-sm"
                id="provider"
                name="provider"
                defaultValue={aiSettings.provider}
              >
                <option value="openrouter">OpenRouter</option>
                <option value="anthropic">Anthropic</option>
                <option value="openai">OpenAI</option>
                <option value="google">Google</option>
              </select>
              <label className="block text-sm font-medium" htmlFor="model">
                Model
              </label>
              <input
                className="h-11 w-full rounded-xl border bg-background px-3 text-sm"
                id="model"
                name="model"
                placeholder="openai/gpt-4.1-mini"
                defaultValue={aiSettings.model}
              />
              <label className="block text-sm font-medium" htmlFor="apiKey">
                API key
              </label>
              <input
                className="h-11 w-full rounded-xl border bg-background px-3 text-sm"
                id="apiKey"
                name="apiKey"
                placeholder={aiSettings.hasKey ? "Leave blank to keep saved key" : "Paste API key"}
                type="password"
              />
              <p className="text-xs text-muted-foreground">
                {aiSettings.hasKey && aiSettings.maskedKey
                  ? `Saved key: ${aiSettings.maskedKey}`
                  : "No AI key saved."}
              </p>
              <Button type="submit" variant="gradient">
                Save AI settings
              </Button>
            </form>
            <form action={testAiSettingsAction} className="mt-3">
              <Button type="submit" variant="outline">
                Test AI key
              </Button>
            </form>
          </section>
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
