"use client";

import { useState } from "react";
import {
  AlertTriangle,
  ClipboardList,
  Clock,
  FileWarning,
  HardHat,
  Receipt,
  ShieldAlert,
  UserX,
  type LucideIcon,
} from "lucide-react";

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { AttentionKind } from "@/lib/domain/projects/attention";
import { cn } from "@/lib/utils";
import type { ProjectWithStats } from "@/types/project";

type Condition = NonNullable<
  ProjectWithStats["attention"]
>["conditions"][number];

/** The chip for each kind: an icon and a few words with the count. */
const CHIP: Record<
  AttentionKind,
  { icon: LucideIcon; text: (count: number) => string }
> = {
  OVERDUE: { icon: Clock, text: (n) => `${n} overdue` },
  COMPLIANCE_ALERT: {
    icon: ShieldAlert,
    text: (n) => `${n} compliance ${n === 1 ? "alert" : "alerts"}`,
  },
  ISSUE: {
    icon: ClipboardList,
    text: (n) => `${n} checklist ${n === 1 ? "issue" : "issues"}`,
  },
  VARIATION: {
    icon: Receipt,
    text: (n) => `${n} ${n === 1 ? "variation" : "variations"} to approve`,
  },
  MISSING_DOCUMENT: {
    icon: FileWarning,
    text: (n) => `${n} missing ${n === 1 ? "document" : "documents"}`,
  },
  BOOKING_PENDING: {
    icon: UserX,
    text: (n) => `${n} tradie ${n === 1 ? "booking" : "bookings"} pending`,
  },
  BOOKING_UNCONFIRMED: {
    icon: HardHat,
    text: (n) => `${n} tradie ${n === 1 ? "booking" : "bookings"} unconfirmed`,
  },
};

/**
 * What the Overdue tab leaves out of its reasons: it is about work and trades
 * running late, and a missing document or an open compliance alert is
 * paperwork, so those chips only crowded the column there. Needs Attention
 * still shows them.
 */
export const OVERDUE_TAB_HIDDEN_KINDS: readonly AttentionKind[] = [
  "MISSING_DOCUMENT",
  "COMPLIANCE_ALERT",
];

/**
 * One condition as a chip, with the precise wording in a tooltip.
 *
 * Hover or focus opens it, as any tooltip does. A tap opens it too: Radix
 * tooltips ignore touch on purpose, and a phone is where this list is most
 * often read between sites. The click is kept from the row, which opens the
 * project's quick view.
 */
function ConditionChip({ condition }: { condition: Condition }) {
  const [open, setOpen] = useState(false);
  const chip = CHIP[condition.kind] ?? { icon: AlertTriangle, text: String };
  const Icon = chip.icon;
  // Older cached payloads predate `details`. The server names the first few
  // (`ATTENTION_DETAIL_LIMIT`); `count` says how many there are.
  const details = condition.details ?? [];
  const more = details.length > 0 ? condition.count - details.length : 0;
  const spoken = [
    condition.label,
    ...details,
    ...(more > 0 ? [`and ${more} more`] : []),
  ].join(". ");

  return (
    <Tooltip open={open} onOpenChange={setOpen}>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={spoken}
          onClick={(event) => {
            // Not the row's quick view, and not Radix's own close-on-click.
            event.stopPropagation();
            event.preventDefault();
            setOpen(true);
          }}
          onKeyDown={(event) => {
            // Enter or Space on the chip must not reach the row either.
            if (event.key === "Enter" || event.key === " ") {
              event.stopPropagation();
            }
          }}
          className="inline-flex min-h-6 max-w-full cursor-help items-center gap-1 rounded-full border border-warning/40 bg-warning-light px-2 py-0.5 text-xs font-medium whitespace-nowrap text-warning-ink transition-colors hover:border-warning/70 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          <Icon className="size-3 shrink-0" aria-hidden="true" />
          {chip.text(condition.count)}
        </button>
      </TooltipTrigger>
      <TooltipContent
        side="top"
        align="start"
        sideOffset={4}
        className="block max-w-80 px-3 py-2 text-left leading-snug"
        // Portalled out of the row in the DOM, but React still bubbles its
        // events to the row and the card, which open the quick view.
        onClick={(event) => event.stopPropagation()}
      >
        <p className="font-semibold">{condition.label}</p>
        {details.length > 0 ? (
          <ul className="mt-1 list-disc space-y-0.5 pl-4 opacity-90">
            {details.map((detail, index) => (
              <li key={index}>{detail}</li>
            ))}
            {more > 0 ? (
              <li className="list-none -ml-4">and {more} more</li>
            ) : null}
          </ul>
        ) : null}
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * Why a project is in Needs Attention (issue #452): one chip per live
 * condition — "83 overdue", "3 missing documents" — with the precise wording
 * behind each in a tooltip: which activity and by how much, which alert,
 * which document.
 *
 * The wording used to sit inline, a line per thing, and a job with a backlog
 * made its row a dozen lines tall; a page of them was unreadable. Chips keep
 * every row one or two lines high and still say what kind of trouble a job is
 * in at a glance.
 *
 * The conditions come from the server's attention read, so a resolved one is
 * simply not here on the next load. Renders nothing for a project with no
 * conditions, so it can sit on every row. `hide` leaves some kinds out, for a
 * tab that is only about part of the picture (`OVERDUE_TAB_HIDDEN_KINDS`).
 */
export function ProjectAttentionReasons({
  attention,
  className,
  hide = [],
}: {
  attention: ProjectWithStats["attention"];
  className?: string;
  hide?: readonly AttentionKind[];
}) {
  const conditions = (attention?.conditions ?? []).filter(
    (condition) => !hide.includes(condition.kind),
  );
  if (conditions.length === 0) return null;

  return (
    <TooltipProvider delayDuration={150}>
      <ul
        className={cn("flex flex-wrap gap-1", className)}
        aria-label={`Needs attention: ${conditions.length} ${conditions.length === 1 ? "condition" : "conditions"}`}
      >
        {conditions.map((condition) => (
          <li key={condition.kind} className="max-w-full">
            <ConditionChip condition={condition} />
          </li>
        ))}
      </ul>
    </TooltipProvider>
  );
}
