"use client";

import { Tag } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * A file's tags as chips. Pressing one filters the table by it; the active
 * tag is highlighted so the row says why it is in the list.
 */
export function FileTagList({
  tags,
  activeTag,
  onSelect,
  max = 4,
  className,
}: {
  tags: readonly string[];
  activeTag?: string;
  onSelect?: (tag: string) => void;
  max?: number;
  className?: string;
}) {
  if (tags.length === 0) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }
  // The active tag is always shown, even when it sits past the cut-off.
  const ordered =
    activeTag && tags.includes(activeTag)
      ? [activeTag, ...tags.filter((tag) => tag !== activeTag)]
      : [...tags];
  const shown = ordered.slice(0, max);
  const hidden = ordered.slice(max);

  return (
    <ul className={cn("flex flex-wrap items-center gap-1", className)}>
      {shown.map((tag) => {
        const active = tag === activeTag;
        const chip = cn(
          "inline-flex max-w-44 items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] leading-4 font-medium",
          active
            ? "border-primary/40 bg-primary/10 text-primary"
            : "border-border/70 bg-muted/60 text-foreground",
        );
        return (
          <li key={tag} className="min-w-0">
            {onSelect ? (
              <button
                type="button"
                className={cn(
                  chip,
                  "transition-colors hover:border-primary/40 hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring",
                )}
                aria-pressed={active}
                title={
                  active ? `Showing “${tag}”` : `Show files tagged “${tag}”`
                }
                onClick={(event) => {
                  // The row opens a preview on click; the chip filters instead.
                  event.stopPropagation();
                  onSelect(active ? "" : tag);
                }}
              >
                <Tag
                  className="size-3 shrink-0 opacity-60"
                  aria-hidden="true"
                />
                <span className="truncate">{tag}</span>
              </button>
            ) : (
              <span className={chip}>
                <span className="truncate">{tag}</span>
              </span>
            )}
          </li>
        );
      })}
      {hidden.length > 0 ? (
        <li
          className="text-[11px] text-muted-foreground tabular-nums"
          title={hidden.join(", ")}
        >
          +{hidden.length}
        </li>
      ) : null}
    </ul>
  );
}
