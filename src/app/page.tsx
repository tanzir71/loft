import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  BookOpenCheck,
  CalendarDays,
  ClipboardCheck,
  CloudOff,
  CreditCard,
  Database,
  LogIn,
  Mail,
  Users,
} from "lucide-react";

import { BrandWordmark } from "@/components/brand-wordmark";
import { CopyTextButton } from "@/components/copy-text-button";
import { Button } from "@/components/ui/button";
import { landingContent, type LandingFeature } from "@/lib/landing-content";

export const metadata: Metadata = {
  title: landingContent.seo.title,
  description: landingContent.seo.description,
  openGraph: {
    title: "TutorLoft",
    description: landingContent.seo.description,
  },
};

const featureIcons: Record<LandingFeature["icon"], typeof BookOpenCheck> = {
  book: BookOpenCheck,
  assignment: ClipboardCheck,
  billing: CreditCard,
};

export default function LandingPage() {
  return (
    <main className="marketing-shell min-h-screen overflow-x-hidden bg-background text-foreground">
      <header className="sticky top-0 z-20 border-b bg-background/90 backdrop-blur-xl">
        <nav className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
          <Link href="/" aria-label="TutorLoft home">
            <BrandWordmark className="text-2xl" />
          </Link>
          <div className="flex items-center gap-2">
            <Button asChild size="sm" variant="ghost">
              <Link href="/demo">Live demo</Link>
            </Button>
            <Button asChild size="sm" variant="outline">
              <Link href={landingContent.hero.primaryCta.href}>
                <LogIn className="h-4 w-4" aria-hidden="true" />
                {landingContent.hero.primaryCta.label}
              </Link>
            </Button>
          </div>
        </nav>
      </header>

      <section className="mx-auto flex min-h-[72svh] max-w-6xl flex-col justify-center px-4 py-16 sm:px-6 lg:py-20">
        <div className="max-w-3xl anim-rise">
          <p className="mb-4 font-mono text-[10px] uppercase text-muted-foreground">
            SYS · 00 · One tutor per instance · open source
          </p>
          <h1 className="text-balance font-display text-5xl italic leading-[0.95] text-foreground sm:text-6xl lg:text-7xl">
            Run your whole tutoring practice on free-tier infrastructure. One
            place for your classes,{" "}
            <span className="text-primary">materials</span>, and billing
          </h1>
          <p className="mt-6 max-w-xl text-lg leading-8 text-muted-foreground">
            {landingContent.hero.subtitle}
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Button asChild size="lg">
              <Link href="/demo">
                Try the read-only demo
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
            </Button>
            <Button asChild size="lg" variant="ghost">
              <Link href={landingContent.hero.primaryCta.href}>
                <LogIn className="h-4 w-4" />
                Log in
              </Link>
            </Button>
          </div>
          <div className="mt-10 grid max-w-2xl grid-cols-2 overflow-hidden rounded-2xl border bg-card sm:grid-cols-4">
            {[
              ["3", "roles"],
              ["31", "browser flows"],
              ["96", "unit tests"],
              ["TL", "invoice prefix"],
            ].map(([value, label]) => (
              <div
                className="border-b border-r p-4 last:border-r-0 sm:border-b-0"
                key={label}
              >
                <strong className="block font-mono text-xl text-primary">
                  {value}
                </strong>
                <span className="text-xs text-muted-foreground">{label}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="border-y bg-card/60">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-primary">
            SYS · 01 · one connected practice
          </p>
          <h2 className="mt-3 max-w-2xl font-display text-4xl italic">
            Schedule → teach → assess → report → invoice.
          </h2>
          <div className="mt-8 grid gap-3 md:grid-cols-4">
            {[
              [
                CalendarDays,
                "Schedule",
                "Weekly slots generate sessions without duplicate records.",
              ],
              [
                BookOpenCheck,
                "Teach",
                "Courses, materials, notes, and announcements stay together.",
              ],
              [
                ClipboardCheck,
                "Assess",
                "Assignments and auto-graded quizzes feed the gradebook.",
              ],
              [
                CreditCard,
                "Track",
                "TL-prefixed invoices track balances without processing payments.",
              ],
            ].map(([Icon, title, copy]) => {
              const StepIcon = Icon as typeof CalendarDays;
              return (
                <article
                  className="rounded-2xl border bg-background p-5"
                  key={String(title)}
                >
                  <StepIcon className="h-5 w-5 text-primary" />
                  <h3 className="mt-5 font-semibold">{String(title)}</h3>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">
                    {String(copy)}
                  </p>
                </article>
              );
            })}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
        <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-primary">
          SYS · 02 · agent-first setup
        </p>
        <div className="mt-3 grid gap-8 lg:grid-cols-[.8fr_1.2fr]">
          <div>
            <h2 className="font-display text-4xl italic">
              Deploy your own loft.
            </h2>
            <p className="mt-4 text-sm leading-7 text-muted-foreground">
              The core app works with Next.js, libSQL, and Auth.js. Resend email
              and Vercel Blob only light up when their keys exist.
            </p>
          </div>
          <div className="rounded-2xl border bg-card p-5">
            <p className="font-mono text-xs text-primary">
              ASK YOUR CODING AGENT
            </p>
            <pre className="mt-4 overflow-auto whitespace-pre-wrap rounded-xl bg-black/30 p-4 text-xs leading-6 text-muted-foreground">
              Read https://tutorloft-workspace.vercel.app/llms.txt and
              https://github.com/tanzir71/tutorloft. Deploy one private
              TutorLoft instance to Vercel with a Turso database. Run migrations
              and seed only the tutor account. Keep email and Blob disabled
              unless their keys are supplied.
            </pre>
            <CopyTextButton
              label="Copy setup prompt"
              copiedLabel="Prompt copied"
              text="Read https://tutorloft-workspace.vercel.app/llms.txt and https://github.com/tanzir71/tutorloft. Deploy one private TutorLoft instance to Vercel with a Turso database. Run migrations and seed only the tutor account. Keep email and Blob disabled unless their keys are supplied."
            />
          </div>
        </div>
      </section>

      <section className="border-y bg-card/60">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-primary">
            SYS · 03 · honest economics
          </p>
          <h2 className="mt-3 font-display text-4xl italic">
            A single-owner tool, not another seat meter.
          </h2>
          <div className="mt-8 overflow-auto rounded-2xl border">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="bg-background font-mono text-[10px] uppercase text-muted-foreground">
                <tr>
                  <th className="p-4">Option</th>
                  <th className="p-4">Model</th>
                  <th className="p-4">What you operate</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                <tr>
                  <td className="p-4 font-semibold text-primary">TutorLoft</td>
                  <td className="p-4">
                    Open source; Vercel Hobby + Turso free tier can be ≈ $0/mo
                  </td>
                  <td className="p-4">Deployment, keys, and backups</td>
                </tr>
                <tr>
                  <td className="p-4">TutorBird</td>
                  <td className="p-4">$16.95/mo + $4.95/additional tutor</td>
                  <td className="p-4">Vendor account</td>
                </tr>
                <tr>
                  <td className="p-4">Teachworks / Teach ’n Go</td>
                  <td className="p-4">Tiered or per-student SaaS</td>
                  <td className="p-4">Vendor account</td>
                </tr>
                <tr>
                  <td className="p-4">Calendly + Wave + Drive</td>
                  <td className="p-4">Several tools</td>
                  <td className="p-4">Portal glue and duplicated records</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            Pricing snapshot from July 2026; verify current vendor pricing and
            free-tier limits before choosing.
          </p>
        </div>
      </section>

      <section className="mx-auto grid max-w-6xl gap-4 px-4 py-16 sm:px-6 md:grid-cols-3">
        {[
          [
            Users,
            "One tutor by design",
            "Each deployment has one tutor owner. This is not a multi-school tenancy platform.",
          ],
          [
            Mail,
            "Email is optional",
            "Invites and reminders need a Resend key; without it, the app remains usable through copyable links.",
          ],
          [
            Database,
            "You own continuity",
            "Turso credentials, migrations, exports, and backups are the deployer's responsibility.",
          ],
          [
            CloudOff,
            "No payment processing",
            "Invoices and balances are tracked. TutorLoft does not charge cards or move money.",
          ],
        ].map(([Icon, title, copy]) => {
          const ScopeIcon = Icon as typeof Users;
          return (
            <article
              className="rounded-2xl border bg-card p-5"
              key={String(title)}
            >
              <ScopeIcon className="h-5 w-5 text-primary" />
              <h2 className="mt-4 font-semibold">{String(title)}</h2>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                {String(copy)}
              </p>
            </article>
          );
        })}
      </section>

      <section className="mx-auto grid max-w-6xl gap-4 px-4 pb-16 sm:px-6 md:grid-cols-3">
        {landingContent.features.map((feature, index) => {
          const Icon = featureIcons[feature.icon];

          return (
            <article
              className="rounded-2xl border bg-card p-6 shadow-soft anim-rise"
              key={feature.title}
              style={{ animationDelay: `${index * 80}ms` }}
            >
              <div className="mb-5 flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <Icon className="h-5 w-5" aria-hidden="true" />
              </div>
              <p className="font-mono text-[10px] uppercase text-muted-foreground">
                {feature.eyebrow}
              </p>
              <h2 className="mt-2 text-lg font-semibold">{feature.title}</h2>
              <p className="mt-3 text-sm leading-6 text-muted-foreground">
                {feature.copy}
              </p>
            </article>
          );
        })}
      </section>

      <section className="border-y border-border/70 bg-card/60">
        <div className="mx-auto grid max-w-6xl gap-8 px-4 py-14 sm:px-6 lg:grid-cols-[0.8fr_1.2fr] lg:items-start">
          <div>
            <p className="font-mono text-[10px] uppercase text-muted-foreground">
              How it works
            </p>
            <h2 className="mt-3 font-display text-3xl italic text-foreground">
              Invite-only by design.
            </h2>
          </div>
          <ol className="grid gap-4 sm:grid-cols-3">
            {landingContent.howItWorks.map((step, index) => (
              <li
                key={step.title}
                className="rounded-2xl border bg-card p-5 shadow-soft"
              >
                <span className="font-mono text-[10px] uppercase text-primary">
                  Step {index + 1}
                </span>
                <h3 className="mt-3 text-sm font-semibold">{step.title}</h3>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  {step.copy}
                </p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <footer className="mx-auto flex max-w-6xl flex-col gap-3 border-t px-4 py-8 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <p>
          <BrandWordmark className="text-xl" /> keeps tutoring practice quiet
          and organized.
        </p>
        <div className="flex gap-4">
          <Link className="hover:text-primary" href="/demo">
            demo
          </Link>
          <a className="hover:text-primary" href="/llms.txt">
            llms.txt
          </a>
          <a
            className="hover:text-primary"
            href="https://buymeacoffee.com/tanzir"
          >
            buy me a coffee
          </a>
          <a
            className="hover:text-primary"
            href="https://github.com/tanzir71/tutorloft"
          >
            GitHub
          </a>
        </div>
      </footer>
    </main>
  );
}
