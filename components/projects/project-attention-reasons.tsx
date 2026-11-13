import { AlertTriangle } from "lucide-react";

import type { ProjectWithStats } from "@/types/project";
import { cn } from "@/lib/utils";

/**
 * Why a project is in Needs Attention: one line per live condition (issue
 * #452). The conditions come from the server's attention read, so a resolved
 * one is simply not here on the next load.
 *
 * Renders nothing for a project with no conditions, so it can sit on every row.
 */
export function ProjectAttentionReasons({
  attention,
  className,
}: {
  attention: ProjectWithStats["attention"];
  className?: string;
}) {
  const conditions = attention?.conditions ?? [];
  if (conditions.length === 0) return null;

  return (
    <ul
      className={cn("space-y-0.5 text-xs text-warning-ink", className)}
      aria-label={`Needs attention: ${conditions.length} ${conditions.length === 1 ? "condition" : "conditions"}`}
    >
      {conditions.map((condition) => (
        <li key={condition.kind} className="flex items-start gap-1.5">
          <AlertTriangle
            className="mt-0.5 size-3 shrink-0"
            aria-hidden="true"
          />
          <span>{condition.label}</span>
        </li>
      ))}
    </ul>
  );
}
