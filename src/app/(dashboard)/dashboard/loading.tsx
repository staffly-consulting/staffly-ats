/**
 * Shown while a dashboard page renders on the server.
 *
 * Every page here is dynamic (auth, then tenant-scoped queries), so without a
 * boundary a click leaves the previous page on screen until the new one is
 * fully rendered, which reads as a frozen app. Next.js stores this on the
 * parent segment and wraps each child route in it, so one file covers
 * navigation between every section under /dashboard. It also lets the router
 * prefetch this shell, so the swap is instant.
 */
export default function DashboardLoading() {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      className="animate-pulse space-y-8"
    >
      <span className="sr-only">Loading…</span>

      <div className="space-y-2.5">
        <div className="h-7 w-48 rounded-md bg-muted" />
        <div className="h-4 w-full max-w-md rounded-md bg-muted" />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <div key={index} className="h-24 rounded-xl border border-border bg-muted/50" />
        ))}
      </div>

      <div className="space-y-3 rounded-xl border border-border p-4">
        {Array.from({ length: 6 }, (_, index) => (
          <div key={index} className="h-9 rounded-md bg-muted/70" />
        ))}
      </div>
    </div>
  );
}
