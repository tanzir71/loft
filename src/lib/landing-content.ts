export const landingContent = {
  productName: "TutorLoft",
  contactEmail: "tutor@example.com",
  seo: {
    title: "One place for classes, materials, and billing · TutorLoft",
    description:
      "TutorLoft gives a private tutor one calm workspace for classes, materials, assignments, parent visibility, and invoice tracking.",
  },
  hero: {
    title: "One place for your classes, materials, and billing",
    accent: "materials",
    subtitle:
      "A calm private tutoring workspace for lessons, assignments, parent visibility, and invoice tracking.",
    primaryCta: {
      label: "Log in",
      href: "/login",
    },
    secondaryCta: {
      label: "Request access",
      href: "mailto:tutor@example.com?subject=Request%20TutorLoft%20access",
    },
  },
  features: [
    {
      icon: "book",
      eyebrow: "Curriculum",
      title: "Classes & Materials",
      copy: "Keep courses, modules, lesson notes, and student resources in one tidy outline.",
    },
    {
      icon: "assignment",
      eyebrow: "Practice",
      title: "Quizzes & Assignments",
      copy: "Share work, collect submissions, and keep feedback close to the lesson context.",
    },
    {
      icon: "billing",
      eyebrow: "Trust",
      title: "Billing for Parents",
      copy: "Track invoices, payments, attendance, and shared class notes without another spreadsheet.",
    },
  ],
  howItWorks: [
    {
      title: "Get an invite",
      copy: "The tutor sends each student or parent a private single-use link.",
    },
    {
      title: "Join the loft",
      copy: "Students see their own courses while parents get a read-only family view.",
    },
    {
      title: "Learn and track",
      copy: "Lessons, progress, attendance, and invoices stay connected as tutoring moves forward.",
    },
  ],
} as const;

export type LandingFeature = (typeof landingContent.features)[number];
