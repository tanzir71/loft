export default function Loading() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl items-center justify-center p-6">
      <div
        aria-live="polite"
        className="w-full rounded-2xl border bg-card p-8 shadow-soft"
        role="status"
      >
        <p className="font-mono text-[10px] uppercase text-muted-foreground">Loading</p>
        <h1 className="mt-3 font-display text-3xl italic">Getting TutorLoft ready</h1>
        <div className="mt-6 grid gap-3">
          <div className="h-4 w-2/3 animate-pulse rounded-full bg-muted" />
          <div className="h-4 w-full animate-pulse rounded-full bg-muted" />
          <div className="h-4 w-5/6 animate-pulse rounded-full bg-muted" />
        </div>
      </div>
    </main>
  );
}
