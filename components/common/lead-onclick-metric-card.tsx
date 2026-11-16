"use client";

import type { ComponentType } from "react";

import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

// Tinted tiles with ink glyphs, the same encoding as METRIC_TONES in
// metric-card.tsx. Gold is a light tint here, not a solid fill.
const toneMap = {
  primary: "bg-royal-gold-light text-royal-gold-ink-text",
  info: "bg-info-light text-info-ink",
  success: "bg-success-light text-success-ink",
  warning: "bg-warning-light text-warning-ink",
  danger: "bg-destructive-light text-destructive-ink",
  badge: "bg-warning-light text-warning-ink",
  neutral: "bg-muted text-muted-foreground",
};

export function LeadMetricCard({
  label,
  value,
  note,
  tone = "primary",
  icon: Icon,
  onClick,
  active = false,
  noteWraps = false,
}: {
  label: string;
  value: string;
  note: string;
  tone?: keyof typeof toneMap;
  icon?: ComponentType<{ className?: string }>;
  onClick?: () => void;
  active?: boolean;
  /** Let a long note run onto a second line instead of cutting it off. */
  noteWraps?: boolean;
}) {
  const content = (
    <div className="grid min-h-[72px] grid-cols-[auto_minmax(0,1fr)] items-center gap-2 px-3 py-3 sm:gap-3 sm:px-4">
      {Icon ? (
        <div
          className={cn(
            "grid size-7 place-items-center rounded-lg sm:size-9",
            toneMap[tone],
          )}
        >
          <Icon className="size-4" />
        </div>
      ) : null}
      <div className="min-w-0">
        {/* A long figure ($1,049,844,988) steps down a size and keeps its
            digits together from sm up; the label drops under it when the two
            do not fit. On a phone, where the card is under 170px, it may break
            instead of running out of the card. */}
        <div className="flex flex-col gap-1 sm:flex-row sm:flex-wrap sm:items-baseline sm:gap-x-2 sm:gap-y-1">
          <p
            className={cn(
              "font-semibold leading-none tracking-tight text-foreground max-sm:[overflow-wrap:anywhere] sm:whitespace-nowrap",
              // Money (a $ figure) is mono; counts stay in the display face.
              value.includes("$") ? "font-mono tabular-nums" : "font-heading",
              value.length > 9 ? "text-xl" : "text-2xl",
            )}
          >
            {value}
          </p>
          <p className="min-w-0 break-words text-xs font-medium text-muted-foreground sm:truncate">
            {label}
          </p>
        </div>
        <p
          className={cn(
            "mt-1 break-words text-xs text-muted-foreground sm:text-[11px]",
            !noteWraps && "sm:truncate",
          )}
        >
          {note}
        </p>
      </div>
    </div>
  );

  if (onClick) {
    return (
      <button
        type="button"
        className={cn(
          "overflow-hidden rounded-lg border text-left text-sm text-card-foreground transition-colors duration-150",
          "cursor-pointer select-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
          active
            ? "border-royal-gold bg-royal-gold-light"
            : "border-border/70 bg-card shadow-sm hover:bg-muted",
        )}
        onClick={onClick}
        aria-pressed={active}
        aria-label={`${label}: ${value}. ${note}`}
      >
        {content}
      </button>
    );
  }

  return (
    <Card
      className={cn(
        "overflow-hidden rounded-lg border-border/70 bg-card shadow-sm transition-colors duration-150",
        active ? "border-royal-gold bg-royal-gold-light" : "",
      )}
    >
      <CardContent className="p-0">{content}</CardContent>
    </Card>
  );
}
