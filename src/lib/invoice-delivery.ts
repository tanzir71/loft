import { hasEmail } from "@/lib/features";

type RuntimeEnv = Record<string, string | undefined>;
type FetchFn = typeof fetch;

type DeliverInvoiceInput = {
  env?: RuntimeEnv;
  fetchFn?: FetchFn;
  fromEmail?: string;
  invoiceNumber: string;
  invoiceUrl: string;
  recipientEmail?: string;
  studentName: string;
};

type CopyInvoiceDelivery = {
  invoiceUrl: string;
  mode: "copy";
  reason: "email_disabled" | "missing_recipient" | "email_failed";
};

type EmailInvoiceDelivery = {
  invoiceUrl: string;
  mode: "email";
  recipientEmail: string;
};

export type InvoiceDeliveryResult = CopyInvoiceDelivery | EmailInvoiceDelivery;

function trimmed(value: string | undefined) {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function invoiceText(input: {
  invoiceNumber: string;
  invoiceUrl: string;
  studentName: string;
}) {
  return [
    `TutorLoft invoice ${input.invoiceNumber} is ready for ${input.studentName}.`,
    "",
    "Open the invoice here:",
    input.invoiceUrl,
    "",
    "Payment status and balance are tracked in TutorLoft.",
  ].join("\n");
}

export async function deliverInvoice(
  input: DeliverInvoiceInput,
): Promise<InvoiceDeliveryResult> {
  const env = input.env ?? process.env;
  const invoiceUrl = input.invoiceUrl;
  const recipientEmail = trimmed(input.recipientEmail);

  if (!hasEmail(env)) {
    return { invoiceUrl, mode: "copy", reason: "email_disabled" };
  }

  if (!recipientEmail) {
    return { invoiceUrl, mode: "copy", reason: "missing_recipient" };
  }

  const response = await (input.fetchFn ?? fetch)("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY?.trim() ?? ""}`,
      "Content-Type": "application/json",
      "User-Agent": "TutorLoft/0.1",
    },
    body: JSON.stringify({
      from: trimmed(input.fromEmail) ?? "TutorLoft <billing@resend.dev>",
      to: recipientEmail,
      subject: `TutorLoft invoice ${input.invoiceNumber}`,
      text: invoiceText({
        invoiceNumber: input.invoiceNumber,
        invoiceUrl,
        studentName: input.studentName,
      }),
    }),
  });

  if (!response.ok) {
    return { invoiceUrl, mode: "copy", reason: "email_failed" };
  }

  return { invoiceUrl, mode: "email", recipientEmail };
}
