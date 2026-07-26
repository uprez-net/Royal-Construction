"use client";

import { AlertTriangle, Copy, RefreshCw, RotateCcw } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

export interface RouteErrorProps {
  /** The error passed to the route's error boundary. */
  error: Error & { digest?: string };
  /** The `reset` callback passed to the route's error boundary. */
  reset: () => void;
  /** `<h1>` for the page. States what failed, in sentence case. */
  title: string;
  /** One or two sentences: what failed, and whether retrying is safe. */
  description: string;
  /** Where to go instead when retrying does not help. */
  fallbackHref: string;
  /** Label for the fallback link, e.g. "All projects". */
  fallbackLabel: string;
}

/**
 * Shared route-level error boundary body for the operator-facing app.
 *
 * Actions are ordered by what actually recovers a failed server render:
 * `reset()` re-renders the boundary, `router.refresh()` refetches the server
 * data behind it, and the fallback link leaves the broken route entirely.
 *
 * `error.digest` is surfaced in every environment, not just development — it is
 * the only handle an engineer has to find the request in the server logs, so an
 * operator needs to be able to quote it from production.
 */
export function RouteError({
  error,
  reset,
  title,
  description,
  fallbackHref,
  fallbackLabel,
}: RouteErrorProps) {
  const router = useRouter();
  const reference = error.digest ?? "unavailable";

  const copyReference = async () => {
    try {
      await navigator.clipboard.writeText(reference);
      toast.success("Error reference copied.");
    } catch {
      toast.error("Could not copy. Select the reference and copy it manually.");
    }
  };

  return (
    <div
      role="alert"
      className="rounded-lg border border-border/70 bg-card p-8 shadow-sm md:p-12"
    >
      <div className="mx-auto max-w-lg">
        <div className="mb-4 flex items-center gap-3">
          <span
            aria-hidden="true"
            className="grid size-10 shrink-0 place-items-center rounded-lg bg-destructive-light"
          >
            <AlertTriangle className="size-5 text-destructive-ink" />
          </span>
          <h1 className="font-heading text-2xl font-semibold tracking-tight text-foreground">
            {title}
          </h1>
        </div>

        <p className="mb-6 text-sm leading-relaxed text-muted-foreground">
          {description}
        </p>

        {process.env.NODE_ENV === "development" && error.message ? (
          <div className="mb-6 rounded-lg border border-border/70 bg-muted p-4">
            <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Error details (development only)
            </p>
            <p className="font-mono text-xs wrap-break-word text-destructive-ink">
              {error.message}
            </p>
          </div>
        ) : null}

        <div className="mb-6 flex flex-col gap-2 sm:flex-row">
          <Button size="lg" onClick={reset}>
            <RefreshCw className="mr-2 size-4" aria-hidden="true" />
            Retry
          </Button>

          <Button size="lg" variant="outline" onClick={() => router.refresh()}>
            <RotateCcw className="mr-2 size-4" aria-hidden="true" />
            Refetch server data
          </Button>

          <Button size="lg" variant="outline" asChild>
            <Link href={fallbackHref}>{fallbackLabel}</Link>
          </Button>
        </div>

        <div className="rounded-lg border border-border/70 bg-muted/40 p-4">
          <h2 className="text-sm font-medium text-foreground">
            If it keeps failing
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Retry once; if the error returns, the server logs will hold the
            cause. Quote this reference when raising it — it identifies the exact
            request.
          </p>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <code className="rounded-md bg-card px-2 py-1 font-mono text-xs tabular-nums text-foreground">
              {reference}
            </code>

            <Button
              variant="ghost"
              onClick={copyReference}
              disabled={reference === "unavailable"}
            >
              <Copy className="mr-1.5 size-3.5" aria-hidden="true" />
              Copy reference
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
