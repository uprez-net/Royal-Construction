"use client";

// What survives of the old step sections. OfferStepSection (collapsible header
// + body) and OfferPhaseGate were replaced by the pane in
// offer-workspace-screen.tsx; the step rail owns naming and navigation now.
// Their `scroll-mt-[var(--offer-sticky-offset)]` read a variable nothing sets
// any more.

import type { ReactNode } from "react";
import { GitBranch, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { LifecycleAction } from "@/lib/offer/lifecycle-busy";

// Explains why the Offer-build steps are (partly or fully) frozen and offers the
// one sanctioned way to change a frozen part: cut a new revision. Rendered in
// the pane, above the active step, once the offer leaves `pending`.
export function OfferLockBanner({
  onCreateRevision,
  canRevise,
  revising,
  lifecycleBusy,
  executed = false,
  documentsEditable = false,
  notice = null,
}: {
  readonly onCreateRevision: () => void;
  readonly canRevise: boolean;
  readonly revising: boolean;
  // The lifecycle action running, or null. Create revision disables while any
  // runs, as it does on the Send & negotiate panel.
  readonly lifecycleBusy: LifecycleAction | null;
  // An executed contract can't be revised — its terms are binding; a change is
  // a contract variation, not a new revision.
  readonly executed?: boolean;
  // In the `sent` negotiation window the customer-facing document + scope are
  // still editable while the price is frozen (#117) — show the partial-lock copy
  // instead of the full-lock copy. Ignored when `executed`.
  readonly documentsEditable?: boolean;
  // Outcome message from the last revision attempt (e.g. an envelope-void
  // warning, or the executed-contract explanation).
  readonly notice?: string | null;
}) {
  const message = executed
    ? "This offer's contract is executed. The terms are locked — a change now is a contract variation, a separate document, not a new revision."
    : documentsEditable
      ? "This offer has been sent. You can still refine the offer document and scope during negotiation — those edits save automatically. Job setup, cost schedule and pricing are locked so the quoted price can't change in place; to change the price, create a new revision."
      : "This offer has been issued, so job setup, cost schedule, pricing, scope and the offer document are locked to preserve the issued record. To change any of them, create a new revision.";
  return (
    <div className="grid gap-2 rounded-lg border border-royal-gold/30 bg-royal-gold-light/40 px-4 py-3">
      <div className="flex flex-col items-start gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        {/* flex-1, and a measure well past DESIGN.md's 68ch body rule: that
            rule is for sustained reading, and this is a two-sentence notice in
            a horizontal bar. Held at max-w-prose it wrapped to three lines
            while ~500px of the row sat empty before the button. */}
        <p className="flex min-w-0 flex-1 items-start gap-2 text-sm text-foreground">
          <Lock
            className="mt-0.5 size-4 shrink-0 text-royal-gold-dark"
            aria-hidden="true"
          />
          <span className="max-w-5xl">{message}</span>
        </p>
        {executed ? null : (
          <Button
            aria-busy={lifecycleBusy === "revision" || undefined}
            className="shrink-0"
            disabled={!canRevise || revising || lifecycleBusy !== null}
            onClick={onCreateRevision}
            size="sm"
            type="button"
            variant="outline"
          >
            <GitBranch className="size-4" aria-hidden="true" />
            {revising ? "Creating…" : "Create revision"}
          </Button>
        )}
      </div>
      {notice ? (
        <p className="text-xs font-medium text-foreground/80">{notice}</p>
      ) : null}
    </div>
  );
}

// The body semantics of a step, without the collapsible header — the step rail
// owns naming and navigation now. The disabled-fieldset rules below have
// exactly one definition: an issued offer must stay readable at full contrast
// while every control is inert.
export function OfferStepBody({
  locked,
  children,
}: {
  readonly locked: boolean;
  readonly children: ReactNode;
}) {
  if (!locked) {
    return <div className="space-y-5">{children}</div>;
  }
  return (
    // A disabled fieldset natively blocks every descendant control (inputs,
    // selects, textareas, buttons) so the issued record can be read but not
    // edited. Opacity is kept at 100% on fields (this is a record to review,
    // not a temporarily-unavailable form); only action buttons dim.
    <fieldset
      disabled
      className="m-0 min-w-0 space-y-5 border-0 p-0 [&_:disabled]:cursor-default [&_input:disabled]:opacity-100 [&_textarea:disabled]:opacity-100 [&_[data-slot=select-trigger]]:opacity-100 [&_[data-slot=checkbox]]:opacity-100 [&_button:disabled]:opacity-50"
    >
      {children}
    </fieldset>
  );
}

// Shown in the pane when a later-phase step has not unlocked yet.
export function OfferPhaseLockNotice({ hint }: { readonly hint: string }) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-dashed border-border bg-muted/30 px-4 py-6 text-sm text-muted-foreground">
      <Lock className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <span>{hint}</span>
    </div>
  );
}
