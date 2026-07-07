import { hasEmail } from "@/lib/features";

type InviteRole = "student" | "parent";
type RuntimeEnv = Record<string, string | undefined>;
type FetchFn = typeof fetch;

type DeliverInviteInput = {
  env?: RuntimeEnv;
  fetchFn?: FetchFn;
  fromEmail?: string;
  inviteUrl: string;
  recipientEmail?: string;
  role: InviteRole;
  tutorName?: string;
};

type CopyInviteDelivery = {
  inviteUrl: string;
  mode: "copy";
  reason: "email_disabled" | "missing_recipient" | "email_failed";
};

type EmailInviteDelivery = {
  inviteUrl: string;
  mode: "email";
  recipientEmail: string;
};

export type InviteDeliveryResult = CopyInviteDelivery | EmailInviteDelivery;

function trimmed(value: string | undefined) {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function inviteText(input: {
  inviteUrl: string;
  role: InviteRole;
  tutorName?: string;
}) {
  const tutorName = trimmed(input.tutorName) ?? "Your tutor";
  return [
    `${tutorName} invited you to join TutorLoft as a ${input.role}.`,
    "",
    "Use this private invite link to create your account:",
    input.inviteUrl,
    "",
    "This invite is single-use and may expire.",
  ].join("\n");
}

export async function deliverInvite(
  input: DeliverInviteInput,
): Promise<InviteDeliveryResult> {
  const env = input.env ?? process.env;
  const inviteUrl = input.inviteUrl;
  const recipientEmail = trimmed(input.recipientEmail);

  if (!hasEmail(env)) {
    return { inviteUrl, mode: "copy", reason: "email_disabled" };
  }

  if (!recipientEmail) {
    return { inviteUrl, mode: "copy", reason: "missing_recipient" };
  }

  const response = await (input.fetchFn ?? fetch)("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY?.trim() ?? ""}`,
      "Content-Type": "application/json",
      "User-Agent": "TutorLoft/0.1",
    },
    body: JSON.stringify({
      from: trimmed(input.fromEmail) ?? "TutorLoft <onboarding@resend.dev>",
      to: recipientEmail,
      subject: "Your TutorLoft invite",
      text: inviteText({
        inviteUrl,
        role: input.role,
        tutorName: input.tutorName,
      }),
    }),
  });

  if (!response.ok) {
    return { inviteUrl, mode: "copy", reason: "email_failed" };
  }

  return { inviteUrl, mode: "email", recipientEmail };
}
