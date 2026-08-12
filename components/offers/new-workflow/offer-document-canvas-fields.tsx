"use client";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Plus, X } from "lucide-react";
import { useLayoutEffect, useRef, type ChangeEvent } from "react";

// Editing primitives for the offer document canvas.
//
// These are real <textarea> elements styled to read as document copy —
// deliberately NOT contentEditable. This text is printed verbatim into a
// fixed-price MBA contract, and contentEditable accepts pasted HTML, so a
// paste from Word could carry markup into a legal document. A styled form
// control gets the same in-place feel with none of that risk.

// Grow a textarea to fit its content so document copy never sits in a scrollbox.
//
// The border term is load-bearing: Tailwind sets `box-sizing: border-box`, but
// scrollHeight EXCLUDES borders. Assigning scrollHeight directly therefore left
// every field two pixels short of its own content, and the browser answered with
// a scrollbar on every single field on the page.
function useAutoSize(value: string) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) {
      return;
    }
    node.style.height = "auto";
    const styles = window.getComputedStyle(node);
    const borders =
      Number.parseFloat(styles.borderTopWidth) +
      Number.parseFloat(styles.borderBottomWidth);
    node.style.height = `${node.scrollHeight + borders}px`;
  }, [value]);
  return ref;
}

// overflow-hidden belongs here too, not just as a belt to the autosize braces:
// during the layout pass before the effect runs, a long value would otherwise
// flash a scrollbar.
const EDITABLE_CHROME =
  "block w-full resize-none overflow-hidden rounded-sm border border-transparent " +
  "bg-transparent px-1.5 py-0.5 transition-colors " +
  "hover:border-border/70 hover:bg-muted/40 " +
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

// A row that reveals its remove control on hover/focus, so a 44-line schedule
// isn't 44 permanently-visible delete buttons.
export function HoverRow({
  children,
  className,
  onRemove,
  removeLabel,
}: {
  readonly children: React.ReactNode;
  readonly className?: string;
  readonly onRemove: () => void;
  readonly removeLabel: string;
}) {
  return (
    <div className={cn("group/row flex items-start gap-1", className)}>
      {children}
      <Button
        aria-label={removeLabel}
        className="mt-0.5 size-6 shrink-0 opacity-0 transition-opacity group-hover/row:opacity-100 focus-visible:opacity-100"
        onClick={onRemove}
        size="icon"
        type="button"
        variant="ghost"
      >
        <X className="size-3" />
      </Button>
    </div>
  );
}

// A plain string list rendered as document bullets, each independently editable.
export function EditableBulletList({
  addLabel,
  ariaLabel,
  emptyHint,
  items,
  onChange,
}: {
  readonly addLabel: string;
  readonly ariaLabel: string;
  readonly emptyHint?: string;
  readonly items: readonly string[];
  readonly onChange: (next: readonly string[]) => void;
}) {
  const replaceAt = (index: number, next: string) =>
    onChange(items.map((item, i) => (i === index ? next : item)));

  return (
    <div>
      {items.length === 0 && emptyHint ? (
        <p className="px-1.5 text-sm text-muted-foreground">{emptyHint}</p>
      ) : null}
      {items.map((item, index) => (
        <HoverRow
          key={index}
          onRemove={() => onChange(items.filter((_, i) => i !== index))}
          removeLabel={`Remove ${ariaLabel} ${index + 1}`}
        >
          <span
            aria-hidden="true"
            className="mt-2 size-1.5 shrink-0 rounded-xs bg-royal-gold"
          />
          <EditableText
            ariaLabel={`${ariaLabel} ${index + 1}`}
            className="text-sm leading-6"
            onChange={(next) => replaceAt(index, next)}
            value={item}
          />
        </HoverRow>
      ))}
      <Button
        className="mt-0.5 h-7 w-fit px-1.5 text-xs text-muted-foreground"
        onClick={() => onChange([...items, ""])}
        size="sm"
        type="button"
        variant="ghost"
      >
        <Plus className="mr-1 size-3" />
        {addLabel}
      </Button>
    </div>
  );
}
