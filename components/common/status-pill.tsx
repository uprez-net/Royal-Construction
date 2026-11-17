"use client";

import type { ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/**
 * Status tones: a 22px tint pill with a 6px currentColor dot and a text label,
 * so a status never rests on colour alone. Each tone is a -light surface with
 * its -ink text.
 *
 * `purple` has no place in the system. It keeps its name so existing callers
 * still compile, and it renders as info.
 */
const statusToneMap = {
  purple: "bg-info-light text-info-ink",
  info: "bg-info-light text-info-ink",
  primary: "bg-royal-gold-light text-royal-gold-ink-text",
  neutral: "bg-muted text-foreground/80",
  success: "bg-success-light text-success-ink",
  warning: "bg-warning-light text-warning-ink",
  danger: "bg-destructive-light text-destructive-ink",
  secondary: "bg-secondary text-secondary-foreground",
};

export function StatusPill({
  tone,
  children,
}: {
  tone: keyof typeof statusToneMap;
  children: ReactNode;
}) {
  return (
    <Badge
      className={cn(
        "h-[22px] gap-1.5 px-2.5 text-[0.71875rem] font-semibold",
        statusToneMap[tone],
      )}
    >
      <span
        aria-hidden="true"
        className="size-1.5 shrink-0 rounded-full bg-current"
      />
      {children}
    </Badge>
  );
}
