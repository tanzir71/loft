import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Home",
};

export default function StudentHomePage() {
  return (
    <main className="mx-auto max-w-3xl p-6">
      <h1 className="font-display text-3xl italic">Home</h1>
      <p className="mt-3 text-sm text-muted-foreground">Student home is ready for enrollment work.</p>
    </main>
  );
}
