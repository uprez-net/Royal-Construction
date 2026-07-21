import { AlertTriangle } from "lucide-react";

/**
 * Sandbox warning banner.
 *
 * Renders a thin, full-width amber bar at the very top of every page when the
 * app runs in the Vercel staging environment (`APP_ENV=staging`). It warns that
 * everything on screen is seeded/dummy data, not production.
 *
 * Server Component by design: `APP_ENV` is a non-`NEXT_PUBLIC_` variable, so it
 * is read on the server only and never shipped to the client bundle. Each Vercel
 * environment builds with its own value, so the bar is baked into the staging
 * build and entirely absent from production.
 *
 * The bar's height mirrors the `--sandbox-banner-height` CSS variable that the
 * root layout sets on <body> (only when staging). Full-viewport shells subtract
 * that variable via `calc()` so they stay pinned to the viewport under the bar.
 */
export function SandboxBanner() {
  if (process.env.APP_ENV !== "staging") return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex h-[var(--sandbox-banner-height)] w-full shrink-0 items-center justify-center gap-2 border-b border-amber-900/20 bg-warning px-4 text-center text-xs font-semibold tracking-wide text-amber-950"
    >
      <AlertTriangle className="size-3.5 shrink-0" aria-hidden="true" />
      <span>Sandbox Environment — dummy data, not production</span>
    </div>
  );
}
