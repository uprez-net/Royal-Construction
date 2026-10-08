"use client";

import { useState } from "react";
import { AlertTriangle, ChevronDown, Clock10, Loader2, X } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type { TradieScheduleWithTradieAndMilestone } from "@/types/project";

export type TradieAttentionItem = {
  schedule: TradieScheduleWithTradieAndMilestone;
  title: string;
  detail: string;
  tone: "danger" | "warning";
};

/**
 * Dismissing is saved against each booking's current status, so it holds
 * across reloads and for everyone on the shared login, and an alert comes back
 * on its own once its booking moves on. The card used to forget a dismissal
 * the moment the page reloaded.
 */
export function TradieAttentionCard({
  items,
  onReview,
  onDismiss,
}: {
  items: TradieAttentionItem[];
  onReview: (schedule: TradieScheduleWithTradieAndMilestone) => void;
  onDismiss: (scheduleIds: string[]) => Promise<void>;
}) {
  const [isExpanded, setIsExpanded] = useState(true);
  // Which alerts a dismissal is in flight for, so their buttons hold still.
  const [dismissing, setDismissing] = useState<string[]>([]);

  const dismiss = async (scheduleIds: string[]) => {
    setDismissing((current) => [...current, ...scheduleIds]);
    try {
      await onDismiss(scheduleIds);
    } finally {
      setDismissing((current) =>
        current.filter((id) => !scheduleIds.includes(id)),
      );
    }
  };

  if (items.length === 0) {
    return null;
  }

  const allIds = items.map((item) => item.schedule.id);
  const isDismissingAll = allIds.every((id) => dismissing.includes(id));

  return (
    <Card
      role="alert"
      className="flex max-h-[30vh] flex-col overflow-hidden border-warning/40 bg-linear-to-br from-warning-light/80 via-card to-card shadow-sm"
    >
      <CardContent className="flex min-h-0 flex-1 flex-col p-0">
        <div className="flex shrink-0 items-start gap-3 p-4">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-warning/15 text-warning-ink">
            <AlertTriangle className="size-5" aria-hidden="true" />
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-semibold text-foreground">
                Schedule follow-up needed
              </p>
              <span className="rounded-full bg-warning/15 px-2 py-0.5 text-[11px] font-bold tabular-nums text-warning-ink">
                {items.length}
              </span>
            </div>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              Review these bookings before they affect the project timeline.
            </p>
          </div>

          <div className="flex shrink-0 items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="size-8 rounded-lg text-muted-foreground hover:bg-warning/10 hover:text-foreground"
              aria-expanded={isExpanded}
              aria-controls="tradie-attention-items"
              aria-label={
                isExpanded
                  ? "Collapse schedule follow-ups"
                  : "Expand schedule follow-ups"
              }
              onClick={() => setIsExpanded((expanded) => !expanded)}
            >
              <ChevronDown
                className={`size-4 transition-transform ${isExpanded ? "rotate-180" : ""}`}
                aria-hidden="true"
              />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-8 rounded-lg text-muted-foreground hover:bg-warning/10 hover:text-foreground"
              aria-label="Dismiss all schedule follow-ups"
              disabled={isDismissingAll}
              onClick={() => void dismiss(allIds)}
            >
              {isDismissingAll ? (
                <Loader2
                  className="size-4 animate-spin motion-reduce:animate-none"
                  aria-hidden="true"
                />
              ) : (
                <X className="size-4" aria-hidden="true" />
              )}
            </Button>
          </div>
        </div>

        {isExpanded && (
          <div
            id="tradie-attention-items"
            className="no-scrollbar min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain border-t border-warning/20 px-4 pb-4 pt-3"
          >
            {items.map(({ schedule, title, detail, tone }) => (
              <div
                key={schedule.id}
                className="flex items-center gap-3 rounded-xl border border-border/70 bg-card/85 p-3"
              >
                <div
                  className={`flex size-8 shrink-0 items-center justify-center rounded-lg ${
                    tone === "danger"
                      ? "bg-destructive-light text-destructive"
                      : "bg-warning-light text-warning"
                  }`}
                >
                  {tone === "danger" ? (
                    <AlertTriangle className="size-4" aria-hidden="true" />
                  ) : (
                    <Clock10 className="size-4" aria-hidden="true" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-semibold text-foreground">
                    {title}
                  </p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    {detail}
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 shrink-0 rounded-lg px-2.5 text-[11px]"
                  onClick={() => onReview(schedule)}
                >
                  Review
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8 shrink-0 rounded-lg text-muted-foreground hover:bg-warning/10 hover:text-foreground"
                  aria-label={`Dismiss: ${title}`}
                  disabled={dismissing.includes(schedule.id)}
                  onClick={() => void dismiss([schedule.id])}
                >
                  {dismissing.includes(schedule.id) ? (
                    <Loader2
                      className="size-3.5 animate-spin motion-reduce:animate-none"
                      aria-hidden="true"
                    />
                  ) : (
                    <X className="size-3.5" aria-hidden="true" />
                  )}
                </Button>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
