"use client";

import { ChevronDown } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { StatusPill } from "@/components/common/status-pill";
import { Card } from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

type Progress = {
  done: number;
  total: number;
};

type ComplianceSectionCardProps = {
  title: string;
  description?: string;
  icon?: LucideIcon;
  /**
   * Supplied / outstanding for this block, shown on the header so a collapsed
   * card still says where it is up to. Omitted where the block has nothing to
   * count, such as the vault.
   */
  progress?: Progress;
  /** Overrides the progress pill — used for "3 to identify" and similar. */
  badge?: {
    label: string;
    tone: "neutral" | "primary" | "success" | "warning";
  };
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Marks the block the flow is currently waiting on. */
  isActive?: boolean;
  className?: string;
  /**
   * Pinned under the scrolling body — the block's own action, such as "Find
   * and send documents". Kept out of `children` so it stays on screen however
   * far down the list someone is.
   */
  footer?: ReactNode;
  children: ReactNode;
};

/**
 * One block of the compliance flow, collapsed to a header until it is opened.
 *
 * The tab used to render every block expanded in a single column, which put the
 * certifier thread and the vault several screens below the row someone had come
 * to act on. Collapsing means the header line — title, progress, and whether
 * this is the step the flow is waiting on — is what has to carry the state, so
 * all three live here rather than inside the block.
 */
export function ComplianceSectionCard({
  title,
  description,
  icon: Icon,
  progress,
  badge,
  open,
  onOpenChange,
  isActive = false,
  className,
  footer,
  children,
}: ComplianceSectionCardProps) {
  const complete =
    progress !== undefined &&
    progress.total > 0 &&
    progress.done >= progress.total;

  return (
    <Collapsible open={open} onOpenChange={onOpenChange} asChild>
      <Card
        className={cn(
          "gap-0 py-0",
          // Self-start rather than stretch: in the grid a three-row block should
          // not inherit the height of a twelve-row one sitting beside it.
          "self-start",
          isActive && "border-primary/50 ring-1 ring-primary/20",
          className,
        )}
      >
        <CollapsibleTrigger
          className={cn(
            "flex w-full items-start gap-3 rounded-t-lg px-4 py-3 text-left transition",
            "hover:bg-muted/50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring",
            !open && "rounded-b-lg",
          )}
        >
          {Icon ? (
            <Icon
              className={cn(
                "mt-0.5 size-4 shrink-0",
                isActive ? "text-primary" : "text-muted-foreground",
              )}
              aria-hidden="true"
            />
          ) : null}

          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-center gap-2">
              <span className="font-heading text-sm leading-snug font-medium text-foreground">
                {title}
              </span>

              {badge ? (
                <StatusPill tone={badge.tone}>{badge.label}</StatusPill>
              ) : progress && progress.total > 0 ? (
                <StatusPill tone={complete ? "success" : "neutral"}>
                  {progress.done}/{progress.total}
                </StatusPill>
              ) : null}

              {isActive ? <StatusPill tone="primary">Now</StatusPill> : null}
            </span>

            {description ? (
              <span className="mt-0.5 block text-xs text-muted-foreground">
                {description}
              </span>
            ) : null}

            {/* A one-line read of the block while it is shut. Hidden once open,
                where the rows themselves say the same thing in more detail. */}
            {progress && progress.total > 0 && !open ? (
              <span
                className="mt-2 block h-1 w-full overflow-hidden rounded-full bg-muted"
                aria-hidden="true"
              >
                <span
                  className={cn(
                    "block h-full rounded-full transition-all",
                    complete ? "bg-success-ink" : "bg-primary",
                  )}
                  style={{
                    width: `${Math.round((progress.done / progress.total) * 100)}%`,
                  }}
                />
              </span>
            ) : null}
          </span>

          <ChevronDown
            className={cn(
              "mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform duration-200",
              open && "rotate-180",
            )}
            aria-hidden="true"
          />
        </CollapsibleTrigger>

        <CollapsibleContent className="overflow-hidden data-open:animate-collapsible-down data-closed:animate-collapsible-up">
          <div className="flex flex-col border-t border-border/70">
            {/* Capped rather than fixed at 40vh: a block with three rows should
                not reserve four hundred pixels of nothing to sit level with the
                twelve-row one beside it. Long lists scroll here, so the footer
                below stays put. */}
            <div className="max-h-[40vh] min-h-0 overflow-y-auto px-4 py-4">
              {children}
            </div>

            {footer ? (
              <div className="shrink-0 border-t border-border/70 bg-muted/40 px-4 py-3">
                {footer}
              </div>
            ) : null}
          </div>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}
