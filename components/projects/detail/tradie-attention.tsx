"use client";

import { useMemo } from "react";
import Link from "next/link";
import { Bell, ShieldCheck, UserPlus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { sydneyDateOnly } from "@/lib/dates/sydney";
import {
  requestEmailAttentionItems,
  tradieAttentionItems,
  type TradieAttention,
} from "@/lib/domain/tradies/attention";
import { useAppDispatch } from "@/lib/store/hooks";
import { openModal } from "@/lib/store/slices/uiSlice";
import { cn } from "@/lib/utils";
import type {
  ProjectDetail,
  TradieScheduleWithTradieAndMilestone,
} from "@/types/project";
import { shortDateFormat } from "@/utils/formatters";
import { toScheduleListItem } from "./schedule-list-item";
import { RetryEmailButton } from "./request-delivery-status";

// The project page's two tradie alert surfaces — the Alerts card above the
// tabs and the attention card in the Tradies tab — render from this, so a
// booking says the same thing and offers the same button in both. The rule
// behind it is `tradieAttention` in lib/domain/tradies/attention.ts.

export type TradieAttentionEntry = {
  /** Unique per alert: one booking can carry a booking alert and an email one. */
  readonly key: string;
  readonly schedule: TradieScheduleWithTradieAndMilestone;
  readonly attention: TradieAttention;
  readonly title: string;
  readonly detail: string;
  /** A failed email clears by being sent, not by being hidden. */
  readonly dismissible: boolean;
};

function describe(
  attention: TradieAttention,
  schedule: TradieScheduleWithTradieAndMilestone,
): { title: string; detail: string } {
  const name = schedule.tradie.name;
  const date = shortDateFormat.format(new Date(schedule.scheduledDate));

  switch (attention.kind) {
    case "no-response":
      return {
        title: `${name} has not responded`,
        detail: `Follow up before the ${date} booking.`,
      };
    case "declined":
      return {
        title: `${name} declined the booking`,
        detail: `Arrange a replacement before ${date}.`,
      };
    case "removed":
      return {
        title: `${name} was removed from the booking`,
        detail: `Arrange a replacement before ${date}.`,
      };
    case "final-confirmation":
      return {
        title: `Final confirmation needed from ${name}`,
        detail: `The approved booking is on ${date}.`,
      };
    case "admin-approval":
      return {
        title: `Admin approval needed for ${name}`,
        detail: `Review availability before the ${date} booking.`,
      };
    case "follow-up":
      return {
        title: `${name} needs a confirmation follow-up`,
        detail: `The booking is scheduled for ${date}.`,
      };
    case "request-email-failed":
      return {
        title: `Request email to ${name} did not send`,
        detail:
          schedule.requestRecipient?.deliveryStatus === "RETRYING"
            ? "Its automatic retry did not run. Retry it now."
            : schedule.requestRecipient?.deliveryStatus === "SENDING"
              ? "The send never finished, so it may have gone out. Check the Sent folder before retrying."
              : (schedule.requestRecipient?.lastError
                ?? "Retry it so they can quote."),
      };
  }
}

/** The bookings on this project that need somebody, most urgent first. */
export function useTradieAttention(
  schedules: ProjectDetail["tradieSchedules"],
): TradieAttentionEntry[] {
  return useMemo(() => {
    const now = new Date();
    // Emails first: until one is sent, nothing else about it can happen.
    const emails = requestEmailAttentionItems(schedules, now).map(
      ({ booking, attention }) => ({
        attention,
        dismissible: false,
        key: `email:${booking.requestRecipient?.id ?? booking.id}`,
        schedule: booking,
        ...describe(attention, booking),
      }),
    );
    const bookings = tradieAttentionItems(
      schedules,
      sydneyDateOnly(now),
      now,
    ).map(({ booking, attention }) => ({
      attention,
      dismissible: true,
      key: `booking:${booking.id}`,
      schedule: booking,
      ...describe(attention, booking),
    }));
    return [...emails, ...bookings];
  }, [schedules]);
}

const ACTION_LABEL: Record<TradieAttention["action"], string> = {
  approve: "Review approval",
  remind: "Send reminder",
  replace: "Book replacement",
  "retry-email": "Retry",
};

/** The one control an alert carries, identical wherever the alert shows. */
export function TradieAttentionActionButton({
  entry,
  project,
  className,
}: {
  entry: TradieAttentionEntry;
  project: ProjectDetail;
  className?: string;
}) {
  const dispatch = useAppDispatch();
  const { action } = entry.attention;
  const label = ACTION_LABEL[action];
  const classes = cn("h-8 shrink-0 rounded-lg px-2.5 text-[11px]", className);

  if (action === "retry-email") {
    const delivery = entry.schedule.requestRecipient;
    return delivery ? (
      <RetryEmailButton
        projectId={project.id}
        delivery={delivery}
        tradieName={entry.schedule.tradie.name}
        className={classes}
      />
    ) : null;
  }

  if (action === "approve") {
    // The approval carries the cost and the dates the admin is approving, so
    // it is decided in the queue rather than by a status flip here — the
    // status dialog refuses to confirm an unapproved booking for that reason.
    return (
      <Button asChild variant="outline" size="sm" className={classes}>
        <Link href="/admin/admin-approvals">
          <ShieldCheck className="size-3.5" aria-hidden="true" />
          {label}
        </Link>
      </Button>
    );
  }

  return (
    <Button
      variant="outline"
      size="sm"
      className={classes}
      aria-label={`${label}: ${entry.schedule.tradie.name}`}
      onClick={() =>
        dispatch(
          action === "remind"
            ? openModal({
                type: "tradieReminder",
                payload: {
                  schedule: toScheduleListItem(project, entry.schedule, {
                    includeQuote: true,
                  }),
                },
              })
            : openModal({ type: "scheduleTradie", payload: { project } }),
        )
      }
    >
      {action === "remind" ? (
        <Bell className="size-3.5" aria-hidden="true" />
      ) : (
        <UserPlus className="size-3.5" aria-hidden="true" />
      )}
      {label}
    </Button>
  );
}
