"use client";

import { useState } from "react";
import { AlertTriangle, ChevronDown, Clock10, X } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type { TradieScheduleWithTradieAndMilestone } from "@/types/project";

export type TradieAttentionItem = {
  schedule: TradieScheduleWithTradieAndMilestone;
  title: string;
  detail: string;
  tone: "danger" | "warning";
};

export function TradieAttentionCard({
  items,
  onReview,
}: {
  items: TradieAttentionItem[];
  onReview: (schedule: TradieScheduleWithTradieAndMilestone) => void;
}) {
  const [isExpanded, setIsExpanded] = useState(true);
  const [isDismissed, setIsDismissed] = useState(false);

  if (items.length === 0 || isDismissed) {
    return null;
  }

  return (
    <Card
      role="alert"
      className="overflow-hidden border-warning/40 bg-linear-to-br from-warning-light/80 via-card to-card shadow-sm"
    >
      <CardContent className="p-0">
        <div className="flex items-start gap-3 p-4">
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
              aria-label="Dismiss schedule follow-ups"
              onClick={() => setIsDismissed(true)}
            >
              <X className="size-4" aria-hidden="true" />
            </Button>
          </div>
        </div>

        {isExpanded && (
          <div
            id="tradie-attention-items"
            className="space-y-2 border-t border-warning/20 px-4 pb-4 pt-3"
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
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
