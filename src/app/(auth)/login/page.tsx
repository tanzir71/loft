import type { Metadata } from "next";
import Link from "next/link";
import { AuthError } from "next-auth";
import { redirect } from "next/navigation";

import { auth, signIn } from "@/auth";
import { Button } from "@/components/ui/button";
import { loginRateLimitStatus, recordFailedLogin } from "@/lib/login-rate-limit";
import { roleHomePath } from "@/lib/session-routing";

export const metadata: Metadata = {
  title: "Log in",
};

async function loginAction(formData: FormData) {
  "use server";

  const email = String(formData.get("email") ?? "");
  const rateLimit = loginRateLimitStatus(email);

  if (!rateLimit.allowed) {
    redirect("/login?error=RateLimited");
  }

  try {
    await signIn("credentials", {
      email,
      password: String(formData.get("password") ?? ""),
      redirectTo: "/",
    });
  } catch (error) {
    if (error instanceof AuthError) {
      recordFailedLogin(email);
      redirect("/login?error=CredentialsSignin");
    }

    throw error;
  }
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await auth();

  if (session?.user?.role) {
    redirect(roleHomePath(session.user.role));
  }

  const params = await searchParams;
  const hasError = params.error === "CredentialsSignin";
  const isRateLimited = params.error === "RateLimited";

  return (
    <main className="min-h-screen canvas-bg dot-grid px-4 py-10">
      <div className="mx-auto flex min-h-[calc(100vh-5rem)] max-w-md flex-col justify-center">
        <Link
          href="/"
          className="mb-8 font-display text-3xl italic tracking-normal text-foreground"
        >
          Tutor<span className="text-primary">Loft</span>
        </Link>
        <section className="rounded-2xl border bg-card p-6 shadow-soft">
          <p className="font-mono text-[10px] uppercase text-muted-foreground">
            Invite-only access
          </p>
          <h1 className="mt-3 font-display text-3xl italic">Log in to TutorLoft</h1>
          {hasError ? (
            <p className="mt-4 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              The email or password was not accepted.
            </p>
          ) : null}
          {isRateLimited ? (
            <p className="mt-4 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              Too many failed attempts. Try again in a few minutes.
            </p>
          ) : null}
          <form action={loginAction} className="mt-6 space-y-4">
            <label className="block text-sm font-medium" htmlFor="email">
              Email
            </label>
            <input
              className="h-11 w-full rounded-xl border bg-background px-3 text-sm outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
            />
            <label className="block text-sm font-medium" htmlFor="password">
              Password
            </label>
            <input
              className="h-11 w-full rounded-xl border bg-background px-3 text-sm outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
            />
            <Button className="w-full" type="submit" variant="gradient">
              Log in
            </Button>
          </form>
        </section>
      </div>
    </main>
  );
}
