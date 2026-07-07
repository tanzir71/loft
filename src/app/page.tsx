import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  BookOpenCheck,
  ClipboardCheck,
  CreditCard,
  LogIn,
  Mail,
} from "lucide-react";

import { BrandWordmark } from "@/components/brand-wordmark";
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
    <main className="min-h-screen canvas-bg dot-grid">
      <header className="sticky top-0 z-20 border-b border-white/50 bg-white/60 backdrop-blur-xl">
        <nav className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
          <Link
            href="/"
            aria-label="TutorLoft home"
          >
            <BrandWordmark className="text-2xl" />
          </Link>
          <Button asChild size="sm" variant="outline">
            <Link href={landingContent.hero.primaryCta.href}>
              <LogIn className="h-4 w-4" aria-hidden="true" />
              {landingContent.hero.primaryCta.label}
            </Link>
          </Button>
        </nav>
      </header>

      <section className="mx-auto flex min-h-[72svh] max-w-6xl flex-col justify-center px-4 py-16 sm:px-6 lg:py-20">
        <div className="max-w-3xl anim-rise">
          <p className="mb-4 font-mono text-[10px] uppercase text-muted-foreground">
            Private tutoring LMS and billing
          </p>
          <h1 className="text-balance font-display text-5xl italic leading-[0.95] text-foreground sm:text-6xl lg:text-7xl">
            One place for your classes,{" "}
            <span className="text-primary">materials</span>, and billing
          </h1>
          <p className="mt-6 max-w-xl text-lg leading-8 text-muted-foreground">
            {landingContent.hero.subtitle}
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Button asChild size="lg" variant="gradient">
              <Link href={landingContent.hero.primaryCta.href}>
                {landingContent.hero.primaryCta.label}
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
            </Button>
            <Button asChild size="lg" variant="ghost">
              <a href={landingContent.hero.secondaryCta.href}>
                <Mail className="h-4 w-4" aria-hidden="true" />
                {landingContent.hero.secondaryCta.label}
              </a>
            </Button>
          </div>
        </div>
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
              <p className="mt-3 text-sm leading-6 text-muted-foreground">{feature.copy}</p>
            </article>
          );
        })}
      </section>

      <section className="border-y border-border/70 bg-white/65">
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
              <li key={step.title} className="rounded-2xl border bg-card p-5 shadow-soft">
                <span className="font-mono text-[10px] uppercase text-primary">
                  Step {index + 1}
                </span>
                <h3 className="mt-3 text-sm font-semibold">{step.title}</h3>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">{step.copy}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <footer className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-8 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <p>
          <BrandWordmark className="text-xl" />{" "}
          keeps tutoring practice quiet and organized.
        </p>
        <a className="hover:text-primary" href={`mailto:${landingContent.contactEmail}`}>
          {landingContent.contactEmail}
        </a>
      </footer>
    </main>
  );
}
