"use client";

import {
  BookOpen,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  GraduationCap,
  LayoutDashboard,
  LockKeyhole,
  ReceiptText,
  Sparkles,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";

type DemoRole = "tutor" | "student" | "parent";
type DemoView = "overview" | "schedule" | "learning" | "billing";

const roles: Array<{ id: DemoRole; label: string; detail: string }> = [
  { id: "tutor", label: "Tutor", detail: "Operations" },
  { id: "student", label: "Student", detail: "Learning" },
  { id: "parent", label: "Parent", detail: "Read-only" },
];

const navigation = [
  { id: "overview" as const, label: "Overview", icon: LayoutDashboard },
  { id: "schedule" as const, label: "Schedule", icon: CalendarDays },
  { id: "learning" as const, label: "Learning", icon: BookOpen },
  { id: "billing" as const, label: "Billing", icon: ReceiptText },
];

const roleCopy = {
  tutor: {
    eyebrow: "Monday, 13 July",
    title: "Good morning, Samira.",
    intro:
      "Four sessions today. Two submissions need feedback before the evening batch.",
    metrics: [
      ["Active students", "12", "+2 this month"],
      ["Sessions this week", "18", "15 attended"],
      ["Open invoices", "৳18,500", "3 families"],
    ],
  },
  student: {
    eyebrow: "Student workspace · Mina Rahman",
    title: "Your next lesson is ready.",
    intro:
      "Continue Algebra II, submit the quadratic worksheet, and review last week's feedback.",
    metrics: [
      ["Current streak", "6 weeks", "On schedule"],
      ["Course progress", "72%", "Algebra II"],
      ["Next session", "Tue 4:00", "Online"],
    ],
  },
  parent: {
    eyebrow: "Family overview · Rahman family",
    title: "A clear view between reports.",
    intro:
      "See Mina's attendance, shared tutor notes, course progress, and invoice status in one place.",
    metrics: [
      ["Attendance", "94%", "16 of 17"],
      ["Latest score", "88%", "Quadratics quiz"],
      ["Balance", "৳4,500", "Due 20 July"],
    ],
  },
} as const;

const sessions = [
  {
    time: "10:00",
    student: "Mina Rahman",
    subject: "Algebra II",
    status: "Confirmed",
  },
  {
    time: "13:30",
    student: "Arif Hasan",
    subject: "Physics",
    status: "Confirmed",
  },
  {
    time: "16:00",
    student: "Nadia Karim",
    subject: "IELTS writing",
    status: "Awaiting",
  },
];

export function DemoWorkspace() {
  const [role, setRole] = useState<DemoRole>("tutor");
  const [view, setView] = useState<DemoView>("overview");
  const content = roleCopy[role];

  return (
    <main className="min-h-screen overflow-x-hidden bg-[#f7f3ef] text-[#24201e]">
      <div className="border-b border-[#e3d8d0] bg-[#fffaf6] px-4 py-2 text-center text-xs text-[#6f625b]">
        <LockKeyhole className="mr-1 inline h-3.5 w-3.5" aria-hidden="true" />
        Read-only demo · seeded data resets on reload · do not enter real
        student information
      </div>
      <header className="border-b border-[#e3d8d0] bg-white">
        <div className="mx-auto flex min-h-16 max-w-[1440px] flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <Link className="font-display text-2xl italic" href="/">
            Tutor<span className="text-[#d87c67]">Loft</span>
          </Link>
          <div
            className="flex rounded-xl border border-[#e3d8d0] bg-[#f7f3ef] p-1"
            aria-label="Demo role"
          >
            {roles.map((item) => (
              <button
                aria-pressed={role === item.id}
                className={`rounded-lg px-3 py-1.5 text-left text-xs transition ${role === item.id ? "bg-white text-[#24201e] shadow-sm" : "text-[#756861] hover:text-[#24201e]"}`}
                key={item.id}
                onClick={() => {
                  setRole(item.id);
                  setView("overview");
                }}
                type="button"
              >
                <span className="block font-semibold">{item.label}</span>
                <span className="hidden text-[10px] text-[#94857c] sm:block">
                  {item.detail}
                </span>
              </button>
            ))}
          </div>
        </div>
      </header>
      <div className="mx-auto grid max-w-[1440px] md:grid-cols-[220px_minmax(0,1fr)]">
        <aside className="min-w-0 border-b border-[#e3d8d0] bg-[#fffaf6] p-3 md:min-h-[calc(100vh-107px)] md:border-b-0 md:border-r md:p-5">
          <nav
            className="flex gap-2 overflow-x-auto md:flex-col"
            aria-label="Demo workspace"
          >
            {navigation.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  aria-current={view === item.id ? "page" : undefined}
                  className={`flex min-h-10 shrink-0 items-center gap-2 rounded-lg px-3 text-sm ${view === item.id ? "bg-[#f0d8cf] font-semibold text-[#8c4635]" : "text-[#756861] hover:bg-[#f3ebe6]"}`}
                  key={item.id}
                  onClick={() => setView(item.id)}
                  type="button"
                >
                  <Icon className="h-4 w-4" aria-hidden="true" />
                  {item.label}
                </button>
              );
            })}
          </nav>
          <div className="mt-6 hidden rounded-xl border border-[#e3d8d0] bg-white p-4 text-xs text-[#756861] md:block">
            <Sparkles
              className="mb-3 h-5 w-5 text-[#d87c67]"
              aria-hidden="true"
            />
            Email, uploads, AI, and payments are disabled in this public
            walkthrough.
          </div>
        </aside>
        <section className="min-w-0 p-4 sm:p-7 lg:p-10">
          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[#9c6c5f]">
            {content.eyebrow}
          </p>
          <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
            <div>
              <h1 className="font-display text-4xl italic sm:text-5xl">
                {content.title}
              </h1>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-[#756861]">
                {content.intro}
              </p>
            </div>
            <button
              className="cursor-not-allowed rounded-xl bg-[#d87c67] px-4 py-2.5 text-sm font-semibold text-white opacity-60"
              disabled
              type="button"
            >
              Create (disabled)
            </button>
          </div>
          {view === "overview" ? (
            <Overview role={role} metrics={content.metrics} />
          ) : (
            <DetailView role={role} view={view} />
          )}
        </section>
      </div>
    </main>
  );
}

function Overview({
  role,
  metrics,
}: {
  role: DemoRole;
  metrics: ReadonlyArray<readonly [string, string, string]>;
}) {
  return (
    <>
      <div className="mt-8 grid gap-3 sm:grid-cols-3">
        {metrics.map(([label, value, note]) => (
          <article
            className="rounded-2xl border border-[#e3d8d0] bg-white p-5"
            key={label}
          >
            <p className="text-xs text-[#8f7f76]">{label}</p>
            <strong className="mt-2 block text-2xl">{value}</strong>
            <span className="mt-2 block text-xs text-[#9c6c5f]">{note}</span>
          </article>
        ))}
      </div>
      <div className="mt-5 grid gap-5 lg:grid-cols-[1.25fr_.75fr]">
        <article className="rounded-2xl border border-[#e3d8d0] bg-white">
          <div className="flex items-center justify-between border-b border-[#eee4de] px-5 py-4">
            <h2 className="font-semibold">
              {role === "tutor" ? "Today’s sessions" : "Learning timeline"}
            </h2>
            <CalendarDays
              className="h-4 w-4 text-[#d87c67]"
              aria-hidden="true"
            />
          </div>
          <div className="divide-y divide-[#eee4de]">
            {sessions.map((session) => (
              <div
                className="grid grid-cols-[52px_1fr_auto] items-center gap-3 px-5 py-4 text-sm"
                key={session.time}
              >
                <span className="font-mono text-xs text-[#8f7f76]">
                  {session.time}
                </span>
                <div>
                  <strong className="block">{session.student}</strong>
                  <span className="text-xs text-[#8f7f76]">
                    {session.subject}
                  </span>
                </div>
                <span className="rounded-full bg-[#edf8f2] px-2 py-1 text-[10px] font-semibold text-[#377357]">
                  {session.status}
                </span>
              </div>
            ))}
          </div>
        </article>
        <article className="rounded-2xl border border-[#e3d8d0] bg-[#2b2827] p-5 text-white">
          <GraduationCap
            className="h-6 w-6 text-[#f0a58f]"
            aria-hidden="true"
          />
          <h2 className="mt-5 font-display text-2xl italic">
            Progress snapshot
          </h2>
          <p className="mt-2 text-sm leading-6 text-white/65">
            Quadratics is trending up after three focused sessions. Next report
            draft is ready for tutor review.
          </p>
          <div className="mt-6 h-2 overflow-hidden rounded-full bg-white/10">
            <div className="h-full w-[78%] rounded-full bg-[#f0a58f]" />
          </div>
          <p className="mt-2 text-xs text-white/55">78% of term targets</p>
        </article>
      </div>
    </>
  );
}

function DetailView({
  role,
  view,
}: {
  role: DemoRole;
  view: Exclude<DemoView, "overview">;
}) {
  const details = {
    schedule: [
      CalendarDays,
      "Schedule",
      "Weekly availability, sessions, attendance, and shared notes stay connected.",
    ],
    learning: [
      BookOpen,
      "Learning",
      "Courses, materials, assignments, quizzes, feedback, and progress reports.",
    ],
    billing: [
      CircleDollarSign,
      "Billing",
      "TL-prefixed invoices and payment status tracking—not payment processing.",
    ],
  } as const;
  const [Icon, title, copy] = details[view];
  return (
    <div className="mt-8 rounded-2xl border border-[#e3d8d0] bg-white p-6 sm:p-8">
      <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#f0d8cf] text-[#9b4f3d]">
        <Icon className="h-5 w-5" aria-hidden="true" />
      </div>
      <h2 className="mt-5 font-display text-3xl italic">{title}</h2>
      <p className="mt-2 max-w-xl text-sm leading-6 text-[#756861]">{copy}</p>
      <div className="mt-7 grid gap-3 sm:grid-cols-2">
        {[
          "Seeded example records",
          "Role-scoped visibility",
          "Exports remain disabled",
          "No outbound side effects",
        ].map((label, index) => (
          <div
            className="flex items-center gap-3 rounded-xl border border-[#eee4de] p-4 text-sm"
            key={label}
          >
            {index < 2 ? (
              <CheckCircle2
                className="h-4 w-4 text-[#4c8b68]"
                aria-hidden="true"
              />
            ) : (
              <Clock3 className="h-4 w-4 text-[#d87c67]" aria-hidden="true" />
            )}
            <span>{label}</span>
            <ChevronRight
              className="ml-auto h-4 w-4 text-[#b7a8a0]"
              aria-hidden="true"
            />
          </div>
        ))}
      </div>
      <p className="mt-6 text-xs text-[#94857c]">
        Viewing as {role}. The production app re-checks authorization in server
        routes and actions.
      </p>
    </div>
  );
}
