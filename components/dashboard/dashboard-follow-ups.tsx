import { timeFormat } from "@/utils/formatters";
import { Badge } from "../ui/badge";
import { Card, CardContent, CardHeader } from "../ui/card";
import { Activity } from "lucide-react";
import { differenceInCalendarDays } from "date-fns";
import { toZonedTime } from "date-fns-tz";

import { SYDNEY_TZ } from "@/lib/dates/sydney";

export interface FollowUpItem {
  id: number | string;
  customerName: string;
  projectName: string;
  description: string;
  dueAt: Date | string;
  /** A date that has no time of day; shown in place of the clock face. */
  dueLabel?: string;
  status: "positive" | "neutral" | "negative";
}

interface DashboardFollowUpsProps {
  pendingFollowUpCount: number;
  followUpTone?: "positive" | "neutral" | "negative";
  followUpItems: FollowUpItem[];
}

// Positive is success, neutral is muted, and overdue is the warning tone.
// Red is reserved for lost, cancelled and declined, so it never appears here.
const statusConfig: Record<
  "positive" | "neutral" | "negative",
  { pill: string; ink: string }
> = {
  positive: {
    pill: "bg-success-light text-success-ink",
    ink: "text-success-ink",
  },
  neutral: {
    pill: "bg-muted text-foreground/80",
    ink: "text-muted-foreground",
  },
  negative: {
    pill: "bg-warning-light text-warning-ink",
    ink: "text-warning-ink",
  },
};

/**
 * "Due today", "2 days left", "1 day overdue", counted on Sydney's calendar.
 * Counted on the machine's own, the page rendered on the server (UTC) called a
 * follow-up due at Sydney midnight on Friday "1 day overdue" all Friday
 * morning.
 */
export function calculateFollowUpBadgeLabel(
  dueAt: Date,
  now: Date = new Date(),
): string {
  const days = differenceInCalendarDays(
    toZonedTime(dueAt, SYDNEY_TZ),
    toZonedTime(now, SYDNEY_TZ),
  );

  if (days > 0) {
    return `${days} day${days === 1 ? "" : "s"} left`;
  }

  if (days === 0) {
    return "Due today";
  }

  const overdueDays = Math.abs(days);

  return `${overdueDays} day${overdueDays === 1 ? "" : "s"} overdue`;
}

export function DashboardFollowUps({
  pendingFollowUpCount,
  followUpTone = "neutral",
  followUpItems,
}: DashboardFollowUpsProps) {
  return (
    <Card>
      <CardHeader className="flex items-center justify-between border-b border-border/60 pb-4">
        <h2 className="font-heading text-[1.0625rem] leading-[1.3] font-semibold tracking-[-0.01em] text-foreground">
          Follow-ups Due Today
        </h2>
        <Badge
          className={`h-[22px] gap-1.5 whitespace-nowrap rounded-full px-2.5 text-[11.5px] font-semibold ${(statusConfig[followUpTone] ?? statusConfig.neutral).pill}`}
        >
          <span
            aria-hidden="true"
            className="size-1.5 rounded-full bg-current"
          />
          {pendingFollowUpCount} Pending
        </Badge>
      </CardHeader>
      <CardContent className="p-6 max-h-100 overflow-y-auto no-scrollbar">
        {followUpItems.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 mt-16">
            <div className="flex size-12 items-center justify-center">
              <Activity className="size-5 text-muted-foreground" />
            </div>

            <div className="space-y-1">
              <p className="text-sm font-semibold text-foreground">
                No follow-ups available
              </p>

              <p className="text-xs text-muted-foreground">
                Your follow-ups will appear here.
              </p>
            </div>
          </div>
        ) : (
          <div className="relative pl-7 before:absolute before:left-1.25 before:top-2 before:bottom-2 before:w-0.5 before:bg-border before:rounded-full">
            {followUpItems.map((item) => (
              <article key={item.id} className="relative pb-5 last:pb-0">
                <div
                  aria-hidden="true"
                  className={`absolute left-[-27.5px] top-1 z-10 size-2.5 rounded-full bg-current ${(statusConfig[item.status] ?? statusConfig.neutral).ink}`}
                />
                <p className="text-[13px] font-bold text-foreground">
                  <span className="font-semibold">{item.customerName}</span> -{" "}
                  <span className="text-sm text-muted-foreground">
                    {item.projectName}
                  </span>
                </p>
                <p className="mt-1 text-[13px] text-muted-foreground max-w-50 truncate">
                  {item.description}
                </p>
                <p
                  className={`mt-1.5 text-[11px] font-medium ${(statusConfig[item.status] ?? statusConfig.neutral).ink}`}
                >
                  {item.dueLabel ?? timeFormat.format(new Date(item.dueAt))}
                </p>
                <Badge
                  className={`absolute right-4 top-4 h-[22px] gap-1.5 whitespace-nowrap rounded-full px-2.5 text-[11.5px] font-semibold ${(statusConfig[item.status] ?? statusConfig.neutral).pill}`}
                >
                  <span
                    aria-hidden="true"
                    className="size-1.5 rounded-full bg-current"
                  />
                  {calculateFollowUpBadgeLabel(new Date(item.dueAt))}
                </Badge>
              </article>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
