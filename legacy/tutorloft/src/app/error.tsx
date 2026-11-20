"use client";

import Link from "next/link";

import { Button } from "@/components/ui/button";

export default function Error({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl items-center justify-center p-6">
      <section className="w-full rounded-2xl border bg-card p-8 shadow-soft">
        <p className="font-mono text-[10px] uppercase text-muted-foreground">Error</p>
        <h1 className="mt-3 font-display text-4xl italic">Something needs a retry</h1>
        <p className="mt-3 max-w-xl text-sm leading-6 text-muted-foreground">
          TutorLoft could not render this view. Try again, or return to a safe page.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Button onClick={reset} type="button" variant="gradient">
            Try again
          </Button>
          <Button asChild variant="outline">
            <Link href="/">Go home</Link>
          </Button>
        </div>
      </section>
    </main>
  );
}
