import { describe, expect, it } from "vitest";

import { deliverInvoice } from "@/lib/invoice-delivery";

describe("invoice delivery", () => {
  it("returns a copyable invoice link when email is disabled or no recipient is provided", async () => {
    await expect(
      deliverInvoice({
        env: {},
        invoiceNumber: "TL-202607-0001",
        invoiceUrl: "https://example.com/invoices/invoice_1",
        recipientEmail: "student@example.com",
        studentName: "Student One",
      }),
    ).resolves.toEqual({
      invoiceUrl: "https://example.com/invoices/invoice_1",
      mode: "copy",
      reason: "email_disabled",
    });

    await expect(
      deliverInvoice({
        env: { RESEND_API_KEY: "key" },
        invoiceNumber: "TL-202607-0001",
        invoiceUrl: "https://example.com/invoices/invoice_1",
        recipientEmail: "",
        studentName: "Student One",
      }),
    ).resolves.toEqual({
      invoiceUrl: "https://example.com/invoices/invoice_1",
      mode: "copy",
      reason: "missing_recipient",
    });
  });

  it("sends invoice notices through Resend and falls back on failure", async () => {
    const sentPayloads: unknown[] = [];
    const okFetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
      sentPayloads.push(JSON.parse(String(init?.body)));
      return new Response(null, { status: 202 });
    }) as typeof fetch;
    const failFetch = (async () => new Response(null, { status: 500 })) as typeof fetch;

    await expect(
      deliverInvoice({
        env: { RESEND_API_KEY: "key" },
        fetchFn: okFetch,
        invoiceNumber: "TL-202607-0001",
        invoiceUrl: "https://example.com/invoices/invoice_1",
        recipientEmail: "student@example.com",
        studentName: "Student One",
      }),
    ).resolves.toEqual({
      invoiceUrl: "https://example.com/invoices/invoice_1",
      mode: "email",
      recipientEmail: "student@example.com",
    });
    expect(sentPayloads).toEqual([
      expect.objectContaining({
        subject: "TutorLoft invoice TL-202607-0001",
        to: "student@example.com",
      }),
    ]);

    await expect(
      deliverInvoice({
        env: { RESEND_API_KEY: "key" },
        fetchFn: failFetch,
        invoiceNumber: "TL-202607-0001",
        invoiceUrl: "https://example.com/invoices/invoice_1",
        recipientEmail: "student@example.com",
        studentName: "Student One",
      }),
    ).resolves.toEqual({
      invoiceUrl: "https://example.com/invoices/invoice_1",
      mode: "copy",
      reason: "email_failed",
    });
  });
});
