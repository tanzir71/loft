import Link from "next/link";

import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl items-center justify-center p-6">
      <section className="w-full rounded-2xl border bg-card p-8 shadow-soft">
        <p className="font-mono text-[10px] uppercase text-muted-foreground">404</p>
        <h1 className="mt-3 font-display text-4xl italic">Page not found</h1>
        <p className="mt-3 max-w-xl text-sm leading-6 text-muted-foreground">
          This page is unavailable or you do not have access to it.
        </p>
        <Button asChild className="mt-6" variant="gradient">
          <Link href="/">Go home</Link>
        </Button>
      </section>
    </main>
  );
}
