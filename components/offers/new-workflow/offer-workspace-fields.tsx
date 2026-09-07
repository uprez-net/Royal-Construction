"use client";

// Field primitives shared by the offer workspace panels. CountField was defined
// twice, once in Job setup and once in Cost schedule, differing only in whether
// it exposed `step`; Field was defined twice more, byte-identically.

import type { PropsWithChildren } from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { parseNonNegativeNumberInput } from "@/lib/offer/workspace-pricing";
import { numberInputValue } from "./offer-workspace-format";

// ── The panel type ramp ────────────────────────────────────────────────────
//
// Three levels of hierarchy existed in the markup and rendered as very nearly
// one. A card title was 16px/500; a group heading ("Owners", "Floor areas")
// was 12px/600 uppercase in muted grey; a field label ("Owner name", "Council")
// was 12px/500 uppercase in the same muted grey. Heading and label differed by
// a single weight step on small uppercase text of identical colour, which is no
// difference at all at arm's length — twenty-nine labels rendered in one voice
// on the Job setup pane alone. A reviewer on staging put it exactly right:
// "everything looks completely monotonous creating no visual difference and
// hard to understand without putting complete focus".
//
// DESIGN.md § Typography already had the answer. Label is specified
// "Uppercase where structural (table headers); sentence case elsewhere" — and
// the workspace was spending uppercase on every ordinary form field, so by the
// time something genuinely was structural there was no signal left to mark it
// with. Uppercase is now rationed to the two structural roles, section headings
// and table headers, which is what makes it legible as structure. Field labels
// drop to sentence case, recovering the ascender/descender word-shape that lets
// a label be recognised rather than spelled out.
//
// The fix is a ramp, not extra weight: bolding all thirty-five would have kept
// the monotony and merely made it heavier.
//
//   Card title      Fraunces 16px/600, foreground   (OfferCardHeading)
//   Group heading   12px/600 UPPERCASE, foreground  (GROUP_HEADING_CLASS)
//   Field label     12px/500 sentence, muted        (FIELD_LABEL_CLASS)
//   Table header    12px/400 UPPERCASE, muted       (unchanged)
//
// These are exported as class strings rather than wrapped in a component
// because the call sites legitimately differ in element — <h4> where the
// heading is a real document heading, <p> or <span> where it labels a figure —
// and that choice belongs at the call site where a screen reader is affected by
// it, not hidden behind an `as` prop.

export const FIELD_LABEL_CLASS = "text-xs font-medium text-muted-foreground";

export const GROUP_HEADING_CLASS =
  "text-xs font-semibold uppercase tracking-wide text-foreground";

// The label text above a control. Panels that build their own control wrapper
// (NumberField, the pricing inputs) reach for this directly; Field composes it.
export function FieldLabel({
  children,
  className,
}: PropsWithChildren<{ readonly className?: string }>) {
  return (
    <span className={cn("mb-1 block", FIELD_LABEL_CLASS, className)}>
      {children}
    </span>
  );
}

// A labelled control. The <label> wraps its input, so the association needs no
// id/htmlFor pair and cannot drift apart during an edit.
export function Field({
  children,
  className,
  label,
}: PropsWithChildren<{ readonly className?: string; readonly label: string }>) {
  return (
    <label className={className}>
      <FieldLabel>{label}</FieldLabel>
      {children}
    </label>
  );
}

// A room/item count. Shares AreaField's parse rule so a negative is rejected
// rather than stored — parseFloat("-1") is truthy, and -1 used to reach contract
// text — and shows the placeholder at 0 instead of a literal "0" that the caret
// then collides with (typing 4 into a resident 0 gave 40).
//
// `step` is "1" for whole counts and "0.5" for bathrooms: a powder room is half
// a bathroom, printed as entered.
export function CountField({
  onChange,
  step = "1",
  value,
}: {
  readonly onChange: (value: number) => void;
  readonly step?: "1" | "0.5";
  readonly value: number;
}) {
  return (
    <Input
      min="0"
      step={step}
      type="number"
      placeholder="Auto-filled from lead requirements"
      value={numberInputValue(value)}
      onChange={(event) => {
        const parsedValue = parseNonNegativeNumberInput(event.target.value);
        if (parsedValue !== null) {
          onChange(parsedValue);
        }
      }}
    />
  );
}
