import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { signIn } from "@/auth";
import { BrandWordmark } from "@/components/brand-wordmark";
import { getDb } from "@/db";
import { Button } from "@/components/ui/button";
import { getInviteByCode, inviteUnavailable, registerWithInvite } from "@/lib/invites";
import { roleHomePath } from "@/lib/session-routing";

export const metadata: Metadata = {
  title: "Join",
};

async function joinAction(formData: FormData) {
  "use server";

  const code = String(formData.get("code") ?? "");
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  let destination = "/";

  try {
    const user = await registerWithInvite(getDb(), {
      code,
      name: String(formData.get("name") ?? ""),
      email,
      password,
    });

    await signIn("credentials", {
      email: user.email,
      password,
      redirect: false,
    });

    destination = roleHomePath(user.role);
  } catch {
    redirect(`/join/${encodeURIComponent(code)}?error=InviteInvalid`);
  }

  redirect(destination);
}

export default async function JoinPage({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { code } = await params;
  const { error } = await searchParams;
  const invite = await getInviteByCode(getDb(), code);
  const unavailable = inviteUnavailable(invite);

  return (
    <main className="min-h-screen canvas-bg dot-grid px-4 py-10">
      <div className="mx-auto flex min-h-[calc(100vh-5rem)] max-w-md flex-col justify-center">
        <Link
          href="/"
          className="mb-8"
        >
          <BrandWordmark className="text-3xl" />
        </Link>
        <section className="rounded-2xl border bg-card p-6 shadow-soft">
          <p className="font-mono text-[10px] uppercase text-muted-foreground">
            Tutor invitation
          </p>
          <h1 className="mt-3 font-display text-3xl italic">Join TutorLoft</h1>
          {unavailable ? (
            <p className="mt-4 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              This invite is expired, used, or unavailable.
            </p>
          ) : (
            <>
              <p className="mt-4 text-sm text-muted-foreground">
                Create your {invite.role} account with this private invite.
              </p>
              {error ? (
                <p className="mt-4 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                  Could not complete registration. Check the invite and form details.
                </p>
              ) : null}
              <form action={joinAction} className="mt-6 space-y-4">
                <input name="code" type="hidden" value={code} />
                <label className="block text-sm font-medium" htmlFor="name">
                  Name
                </label>
                <input
                  className="h-11 w-full rounded-xl border bg-background px-3 text-sm"
                  id="name"
                  name="name"
                  required
                />
                <label className="block text-sm font-medium" htmlFor="email">
                  Email
                </label>
                <input
                  className="h-11 w-full rounded-xl border bg-background px-3 text-sm"
                  id="email"
                  name="email"
                  type="email"
                  required
                />
                <label className="block text-sm font-medium" htmlFor="password">
                  Password
                </label>
                <input
                  className="h-11 w-full rounded-xl border bg-background px-3 text-sm"
                  id="password"
                  name="password"
                  type="password"
                  minLength={8}
                  required
                />
                <Button type="submit" variant="gradient">
                  Join
                </Button>
              </form>
            </>
          )}
        </section>
      </div>
    </main>
  );
}
