import { AlertTriangle } from "lucide-react";

import type { ProjectWithStats } from "@/types/project";
import { cn } from "@/lib/utils";

/**
 * Why a project is in Needs Attention: one line per live condition (issue
 * #452). The conditions come from the server's attention read, so a resolved
 * one is simply not here on the next load.
 *
 * Each line names what it is about. A condition over one thing says which
 * ("Slab is 3 days overdue (expected 9 Nov)"); over several it is a count with
 * each one listed beneath it, so nobody has to open the project to find out
 * which activity, alert or document it means.
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
      className={cn("space-y-1 text-xs text-warning-ink", className)}
      aria-label={`Needs attention: ${conditions.length} ${conditions.length === 1 ? "condition" : "conditions"}`}
    >
      {conditions.map((condition) => {
        // Older cached payloads predate `details`. The server names the first
        // few (`ATTENTION_DETAIL_LIMIT`); `count` says how many there are.
        const details = condition.details ?? [];
        const hidden =
          details.length > 0 ? condition.count - details.length : 0;
        return (
          <li key={condition.kind} className="flex items-start gap-1.5">
            <AlertTriangle
              className="mt-0.5 size-3 shrink-0"
              aria-hidden="true"
            />
            <div className="min-w-0">
              <span className={details.length > 0 ? "font-medium" : undefined}>
                {condition.label}
              </span>
              {details.length > 0 ? (
                <ul className="mt-0.5 space-y-0.5 text-foreground/80">
                  {details.map((detail, index) => (
                    <li key={index} className="wrap-break-word">
                      {detail}
                    </li>
                  ))}
                  {hidden > 0 ? (
                    <li className="text-muted-foreground">and {hidden} more</li>
                  ) : null}
                </ul>
              ) : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
