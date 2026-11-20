import { describe, expect, it, vi } from "vitest";

import { deliverInvite } from "@/lib/invite-delivery";

describe("deliverInvite", () => {
  it("returns a copyable invite when email is not configured", async () => {
    const fetchFn = vi.fn<typeof fetch>();

    await expect(
      deliverInvite({
        env: { RESEND_API_KEY: "" },
        fetchFn,
        inviteUrl: "https://tutorloft.test/join/STUDENTCODE",
        recipientEmail: "student@example.com",
        role: "student",
      }),
    ).resolves.toEqual({
      inviteUrl: "https://tutorloft.test/join/STUDENTCODE",
      mode: "copy",
      reason: "email_disabled",
    });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("sends a TutorLoft invite email when Resend is configured", async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(new Response("{}", { status: 202 }));

    const result = await deliverInvite({
      env: { RESEND_API_KEY: "resend-key" },
      fetchFn,
      inviteUrl: "https://tutorloft.test/join/STUDENTCODE",
      recipientEmail: "Student@Example.com ",
      role: "student",
      tutorName: "Tutor One",
    });
    const [url, init] = fetchFn.mock.calls[0];

    expect(result).toEqual({
      inviteUrl: "https://tutorloft.test/join/STUDENTCODE",
      mode: "email",
      recipientEmail: "Student@Example.com",
    });
    expect(url).toBe("https://api.resend.com/emails");
    expect(init?.method).toBe("POST");
    expect(init?.headers).toMatchObject({
      Authorization: "Bearer resend-key",
      "Content-Type": "application/json",
      "User-Agent": "TutorLoft/0.1",
    });
    expect(JSON.parse(String(init?.body))).toMatchObject({
      subject: "Your TutorLoft invite",
      text: expect.stringContaining("https://tutorloft.test/join/STUDENTCODE"),
      to: "Student@Example.com",
    });
  });

  it("falls back to a copyable invite if email sending fails", async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(
      new Response("nope", {
        status: 400,
      }),
    );

    await expect(
      deliverInvite({
        env: { RESEND_API_KEY: "resend-key" },
        fetchFn,
        inviteUrl: "https://tutorloft.test/join/STUDENTCODE",
        recipientEmail: "student@example.com",
        role: "parent",
      }),
    ).resolves.toEqual({
      inviteUrl: "https://tutorloft.test/join/STUDENTCODE",
      mode: "copy",
      reason: "email_failed",
    });
  });
});
