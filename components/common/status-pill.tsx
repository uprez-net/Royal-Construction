"use client";

import type { ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/**
 * Status tones, on the three-role token pattern: `-light` surface + `-ink` text.
 * Every pair is verified ≥4.5:1 (see audits/impeccable-fix-spec.md §1).
 *
 * Previously this map was raw palette (`bg-emerald-100 text-emerald-700`, …),
 * which meant every status badge routed through this component stayed off-token
 * no matter what its call site did. `primary` also mapped to *blue*, not Site
 * Teal, so `tone="primary"` contradicted its own name.
 *
 * `primary` uses `bg-muted` rather than a primary tint deliberately: text-primary
 * on primary/10 measures 4.40:1, just under AA, while on --muted it reaches 4.55:1.
 */
const statusToneMap = {
  purple: "bg-accent-purple-light text-accent-purple",
  primary: "bg-muted text-primary",
  neutral: "bg-muted text-muted-foreground",
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
        "rounded-full px-3 py-1 text-xs font-medium",
        statusToneMap[tone],
      )}
    >
      {children}
    </Badge>
  );
}
