"use client";

import { useEffect, useRef } from "react";
import {
  Briefcase,
  FileText,
  HardHat,
  LoaderCircle,
  SearchX,
  TriangleAlert,
  UserRound,
} from "lucide-react";
import {
  useGroupedMentions,
  type AgentAnnotation,
  type MentionSearchState,
} from "@/components/agent/agent-mentions";
import { humanizeEnum } from "@/components/agent/agent-format";
import { cn } from "@/lib/utils";

const TYPE_ICON: Record<string, typeof UserRound> = {
  file: FileText,
  lead: UserRound,
  offer: Briefcase,
  project: HardHat,
};

/**
 * The `@` reference picker.
 *
 * It is a listbox the textarea owns rather than a popover with its own focus:
 * the caret never leaves the message, and the arrow keys, Enter, Tab and Escape
 * are handled by the composer's key handler. The previous build hung the
 * results off a floating icon button that only existed while there were
 * results, so a query that matched nothing made the control disappear
 * mid-keystroke; every state is now rendered in place.
 */
export function AgentMentionMenu({
  activeIndex,
  id,
  onHover,
  onSelect,
  query,
  results,
  search,
}: {
  activeIndex: number;
  id: string;
  onHover: (index: number) => void;
  onSelect: (annotation: AgentAnnotation) => void;
  query: string;
  results: readonly AgentAnnotation[];
  search: MentionSearchState;
}) {
  const groups = useGroupedMentions(results);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-index="${activeIndex}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  return (
    <div className="absolute inset-x-0 bottom-full z-30 mb-2">
      <div className="mx-auto max-w-4xl overflow-hidden rounded-xl border border-border bg-popover shadow-lg">
        <p className="border-b border-border/70 px-3 py-1.5 text-[11px] text-muted-foreground">
          {query.length < 2 ? (
            "Keep typing to search leads, offers, projects and files"
          ) : (
            <>
              Referencing{" "}
              <span className="font-medium text-foreground">@{query}</span> ·{" "}
              <span>↑↓ to choose · Enter to add · Esc to dismiss</span>
            </>
          )}
        </p>

        {search.loading ? (
          <Status icon={LoaderCircle} spin>
            Searching…
          </Status>
        ) : search.error ? (
          <Status icon={TriangleAlert}>
            The reference search failed. Type to try again, or send the message
            without a reference.
          </Status>
        ) : query.length >= 2 && results.length === 0 ? (
          <Status icon={SearchX}>
            Nothing matches <span className="font-medium">{query}</span>.
          </Status>
        ) : results.length > 0 ? (
          <div
            className="max-h-72 overflow-y-auto overscroll-contain py-1"
            id={id}
            ref={listRef}
            role="listbox"
          >
            {groups.map((group) => (
              <div key={group.group}>
                <p className="px-3 pt-2 pb-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
                  {humanizeEnum(group.group)}
                </p>
                {group.items.map(({ annotation, index: itemIndex }) => {
                  const Icon = TYPE_ICON[annotation.type] ?? FileText;
                  return (
                    <button
                      aria-selected={itemIndex === activeIndex}
                      className={cn(
                        "flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm",
                        itemIndex === activeIndex
                          ? "bg-royal-gold-light text-foreground"
                          : "text-foreground/85",
                      )}
                      data-index={itemIndex}
                      id={`${id}-option-${itemIndex}`}
                      key={`${annotation.type}:${annotation.id}`}
                      // Keeps the caret in the textarea, so a click and a
                      // keyboard pick land on exactly the same code path.
                      onMouseDown={(event) => {
                        event.preventDefault();
                        onSelect(annotation);
                      }}
                      onMouseMove={() => onHover(itemIndex)}
                      role="option"
                      type="button"
                    >
                      <Icon
                        aria-hidden="true"
                        className="size-4 shrink-0 text-muted-foreground"
                      />
                      <span className="min-w-0 flex-1 truncate">
                        {annotation.label}
                      </span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {humanizeEnum(annotation.type)}
                      </span>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function Status({
  children,
  icon: Icon,
  spin,
}: {
  children: React.ReactNode;
  icon: typeof LoaderCircle;
  spin?: boolean;
}) {
  return (
    <p className="flex items-center gap-2 px-3 py-3 text-sm text-muted-foreground">
      <Icon
        aria-hidden="true"
        className={cn("size-4 shrink-0", spin && "animate-spin")}
      />
      <span className="min-w-0">{children}</span>
    </p>
  );
}
