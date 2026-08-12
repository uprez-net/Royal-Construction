"use client";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { OfferInclusionEntry } from "@/lib/offer/workspace-model";
import { Plus, Tag, X } from "lucide-react";
import { useLayoutEffect, useRef, type ChangeEvent } from "react";

// Editing primitives for the offer document canvas.
//
// These are real <textarea>/<input> elements styled to read as document copy —
// deliberately NOT contentEditable. This text is printed verbatim into a
// fixed-price MBA contract, and contentEditable accepts pasted HTML, so a
// paste from Word could carry markup into a legal document. A styled form
// control gets the same in-place feel with none of that risk.

// Grow a textarea to fit its content so document copy never sits in a
// scrollbox. useLayoutEffect (not useEffect) so the height is applied before
// paint and the field never flashes at the wrong size.
function useAutoSize(value: string) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) {
      return;
    }
    node.style.height = "auto";
    node.style.height = `${node.scrollHeight}px`;
  }, [value]);
  return ref;
}

const EDITABLE_CHROME =
  "w-full resize-none rounded-sm border border-transparent bg-transparent px-1.5 py-1 " +
  "transition-colors hover:border-border/70 hover:bg-muted/40 " +
  "focus:border-royal-gold/60 focus:bg-white focus:outline-none";

export function EditableText({
  ariaLabel,
  className,
  onChange,
  placeholder,
  value,
}: {
  readonly ariaLabel: string;
  readonly className?: string;
  readonly onChange: (next: string) => void;
  readonly placeholder?: string;
  readonly value: string;
}) {
  const ref = useAutoSize(value);
  return (
    <textarea
      aria-label={ariaLabel}
      className={cn(EDITABLE_CHROME, className)}
      onChange={(event: ChangeEvent<HTMLTextAreaElement>) =>
        onChange(event.target.value)
      }
      placeholder={placeholder}
      ref={ref}
      rows={1}
      value={value}
    />
  );
}

// A plain string list (used for exclusions) rendered as document bullets, each
// independently editable, with add/remove.
export function EditableBulletList({
  ariaLabel,
  addLabel,
  items,
  onChange,
}: {
  readonly ariaLabel: string;
  readonly addLabel: string;
  readonly items: readonly string[];
  readonly onChange: (next: readonly string[]) => void;
}) {
  const replaceAt = (index: number, next: string) =>
    onChange(items.map((item, i) => (i === index ? next : item)));
  const removeAt = (index: number) =>
    onChange(items.filter((_, i) => i !== index));

  return (
    <div className="grid gap-0.5">
      {items.map((item, index) => (
        <div className="group flex items-start gap-1" key={index}>
          <span
            aria-hidden="true"
            className="mt-2.5 size-1.5 shrink-0 rounded-xs bg-royal-gold"
          />
          <EditableText
            ariaLabel={`${ariaLabel} ${index + 1}`}
            className="text-sm leading-6"
            onChange={(next) => replaceAt(index, next)}
            value={item}
          />
          <Button
            aria-label={`Remove ${ariaLabel} ${index + 1}`}
            className="mt-1 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
            onClick={() => removeAt(index)}
            size="icon"
            type="button"
            variant="ghost"
          >
            <X className="size-3.5" />
          </Button>
        </div>
      ))}
      <Button
        className="mt-1 w-fit text-xs text-muted-foreground"
        onClick={() => onChange([...items, ""])}
        size="sm"
        type="button"
        variant="ghost"
      >
        <Plus className="mr-1 size-3.5" />
        {addLabel}
      </Button>
    </div>
  );
}

// One inclusion, as it prints in the schedule, with its page-4 label edited
// right beside it. The label is the ONLY thing that reaches the Investment
// Summary page, so it lives next to the spec it summarises rather than in a
// separate list that could contradict it.
export function EditableInclusionRow({
  entry,
  index,
  onChange,
  onRemove,
}: {
  readonly entry: OfferInclusionEntry;
  readonly index: number;
  readonly onChange: (next: OfferInclusionEntry) => void;
  readonly onRemove: () => void;
}) {
  const hasSummary = entry.summary !== undefined;

  return (
    <li className="group grid grid-cols-[auto_1fr_auto] items-start gap-x-2 border-b border-border/50 py-1.5 last:border-b-0">
      <span className="pt-1.5 font-mono text-xs tabular-nums text-muted-foreground">
        {index + 1}.
      </span>
      <div className="min-w-0">
        <EditableText
          ariaLabel={`Inclusion ${index + 1} specification`}
          className="text-sm leading-6"
          onChange={(spec) => onChange({ ...entry, spec })}
          placeholder="Describe what is included…"
          value={entry.spec}
        />
        {hasSummary ? (
          <div className="mt-0.5 flex items-start gap-1 pl-1.5">
            <Tag
              aria-hidden="true"
              className="mt-2 size-3 shrink-0 text-royal-gold"
            />
            <EditableText
              ariaLabel={`Inclusion ${index + 1} short label for the price page`}
              className="text-xs leading-5 text-royal-gold-dark"
              onChange={(summary) => onChange({ ...entry, summary })}
              placeholder="Short label shown beside the price…"
              value={entry.summary ?? ""}
            />
            <Button
              aria-label={`Stop showing inclusion ${index + 1} beside the price`}
              className="mt-0.5 text-xs text-muted-foreground"
              onClick={() => {
                onChange({ spec: entry.spec });
              }}
              size="sm"
              type="button"
              variant="ghost"
            >
              Hide
            </Button>
          </div>
        ) : (
          <Button
            className="ml-0.5 h-auto p-1 text-xs text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
            onClick={() => onChange({ ...entry, summary: "" })}
            size="sm"
            type="button"
            variant="ghost"
          >
            <Tag className="mr-1 size-3" />
            Show beside price
          </Button>
        )}
      </div>
      <Button
        aria-label={`Remove inclusion ${index + 1}`}
        className="mt-1 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
        onClick={onRemove}
        size="icon"
        type="button"
        variant="ghost"
      >
        <X className="size-3.5" />
      </Button>
    </li>
  );
}
