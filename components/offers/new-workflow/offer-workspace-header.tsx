"use client";

// What survives of the old workspace header. The header card itself and the
// ten-node stepper were replaced by shell/offer-command-bar.tsx and
// shell/offer-step-rail.tsx; the stepper's scrollIntoView jump assumed every
// step section was mounted, which the pane no longer does. These two chrome
// pieces are still used by the command bar.

import { cn } from "@/lib/utils";
import { AlertTriangle, Check, Loader2, RefreshCw } from "lucide-react";
import type { OfferExpiry } from "@/lib/offer/offer-readiness";
import type { OfferSaveState } from "./offer-workspace-screen";

// Offer-validity chip. Silent until a date is set; escalates muted → warning →
// destructive as the fixed price approaches and passes its validity date, so an
// expired offer can never be emailed unnoticed.
export function ExpiryChip({ expiry }: { readonly expiry: OfferExpiry | null }) {
  if (!expiry || expiry.state === "none") {
    return null;
  }
  const toneClass =
    expiry.state === "expired"
      ? "border-destructive/30 bg-destructive-light text-destructive-ink"
      : expiry.state === "soon"
        ? "border-warning/40 bg-warning-light text-foreground"
        : "border-border bg-muted/40 text-muted-foreground";
  return (
    <span
      className={cn(
        "rounded-full border px-2 py-0.5 text-xs font-medium",
        toneClass,
      )}
    >
      {expiry.label}
    </span>
  );
}

// Autosave chrome: makes the debounced persistence legible and flags a failed
// save instead of leaving the operator to assume their edits are safe.
export function SaveIndicator({
  state,
  onRetry,
}: {
  readonly state: OfferSaveState;
  readonly onRetry?: () => void;
}) {
  if (state === "idle") {
    return null;
  }
  if (state === "saving") {
    return (
      <span className="flex items-center gap-1 text-xs text-muted-foreground">
        <Loader2
          className="size-3 animate-spin motion-reduce:animate-none"
          aria-hidden="true"
        />
        Saving…
      </span>
    );
  }
  if (state === "saved") {
    return (
      <span className="flex items-center gap-1 text-xs text-muted-foreground">
        <Check className="size-3" aria-hidden="true" />
        Saved
      </span>
    );
  }
  // The command bar sits this in a shrink-0 cell beside the price, so the
  // visible text stays short; the full explanation is still read out and shown
  // on hover.
  if (state === "reconciled") {
    const detail =
      "This offer changed in another tab, so this tab now shows the saved copy. Check that your last edit is still there.";
    return (
      <span
        className="inline-flex items-center gap-1 rounded-full border border-warning/40 bg-warning-light px-2 py-0.5 text-xs font-medium text-foreground"
        role="status"
        title={detail}
      >
        <RefreshCw className="size-3" aria-hidden="true" />
        Reloaded from another tab
        <span className="sr-only">. {detail}</span>
      </span>
    );
  }
  // A failed save used to be one line of red text that was easy to miss and
  // offered no way to try again short of making another edit.
  const detail =
    "Your last edits are not stored. Keep this tab open and retry.";
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border border-destructive/40 bg-destructive-light px-2 py-0.5 text-xs font-medium text-destructive-ink"
      role="alert"
      title={detail}
    >
      <AlertTriangle className="size-3" aria-hidden="true" />
      Not saved
      <span className="sr-only">. {detail}</span>
      {onRetry ? (
        <button
          className="rounded-sm font-semibold underline underline-offset-2 hover:no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          type="button"
          onClick={onRetry}
        >
          Retry
        </button>
      ) : null}
    </span>
  );
}
