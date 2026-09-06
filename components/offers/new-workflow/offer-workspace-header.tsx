"use client";

// What survives of the old workspace header. The header card itself and the
// ten-node stepper were replaced by shell/offer-command-bar.tsx and
// shell/offer-step-rail.tsx; the stepper's scrollIntoView jump assumed every
// step section was mounted, which the pane no longer does. These two chrome
// pieces are still used by the command bar.

import { cn } from "@/lib/utils";
import { Check, Loader2 } from "lucide-react";
import type { OfferExpiry } from "@/lib/offer/offer-readiness";

type OfferSaveState = "idle" | "saving" | "saved" | "error";

// Offer-validity chip. Silent until a date is set; escalates muted → warning →
// destructive as the fixed price approaches and passes its validity date, so an
// expired offer can never be emailed unnoticed.
export function ExpiryChip({ expiry }: { readonly expiry: OfferExpiry | null }) {
  if (!expiry || expiry.state === "none") {
    return null;
  }
  const toneClass =
    expiry.state === "expired"
      ? "border-destructive/30 bg-destructive-light text-destructive"
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
export function SaveIndicator({ state }: { readonly state: OfferSaveState }) {
  if (state === "idle") {
    return null;
  }
  if (state === "saving") {
    return (
      <span className="flex items-center gap-1 text-xs text-muted-foreground">
        <Loader2 className="size-3 animate-spin" aria-hidden="true" />
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
  const detail =
    "Save failed — your last edits may not be stored. Keep this tab open.";
  return (
    <span
      className="text-xs font-medium text-destructive"
      role="status"
      title={detail}
    >
      Save failed
      <span className="sr-only">. {detail}</span>
    </span>
  );
}
