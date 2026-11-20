import type { Metadata } from "next";

import { DemoWorkspace } from "./workspace";

export const metadata: Metadata = {
  title: "Read-only demo",
  description:
    "Explore seeded tutor, student, and parent views without an account.",
};

export default function DemoPage() {
  return <DemoWorkspace />;
}
