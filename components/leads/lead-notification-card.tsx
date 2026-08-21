'use client';
import { useLeadsData } from "@/hooks/use-leads-data";
import { isTerminalStage } from "@/lib/leads/lead-helpers";
import { Card, CardHeader, CardTitle, CardContent } from "../ui/card";
import { Button } from "../ui/button";
import {
  CalendarDays,
  ChevronDown,
  ChevronUp,
  Clock3,
  Eye,
} from "lucide-react";
import { useAppDispatch } from "@/lib/store/hooks";
import { useEffect, useMemo, useState } from "react";
import { openModal } from "@/lib/store/slices/uiSlice";
import { toZonedTime } from "date-fns-tz";
import {
  addDays,
  differenceInCalendarDays,
  format,
  isBefore,
  isEqual,
  isSameDay,
  parseISO,
} from "date-fns";
import { cn } from "@/lib/utils";

function getAustralianDate(offsetDays = 0): Date {
  return addDays(toZonedTime(new Date(), "Australia/Sydney"), offsetDays);
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "";
  const date = parseISO(dateStr);
  if (isSameDay(date, getAustralianDate())) {
    return "Today";
  }
  if (isSameDay(date, getAustralianDate(1))) {
    return "Tomorrow";
  }

  return format(date, "EEE, MMM d");
}

const getDateStatus = (date: string | null) => {
  const today = getAustralianDate();
  if (!date) {
    return {
      scheduledDate: "",
      status: "",
    };
  }

  const target = parseISO(date);
  const diff = differenceInCalendarDays(target, today);

  let status: string;

  if (diff < 0) {
    status = `${Math.abs(diff)} day${Math.abs(diff) === 1 ? "" : "s"} overdue`;
  } else if (diff === 0) {
    status = "Due today";
  } else {
    status = `${diff} day${diff === 1 ? "" : "s"} left`;
  }

  return {
    scheduledDate: formatDate(date),
    status,
  };
};

export function LeadNotificationCard() {
  const dispatch = useAppDispatch();
  const { leads, loadingLeads, refreshLeadsData } = useLeadsData();
  const [updatesCollapsed, setUpdatesCollapsed] = useState(false);

  const relevantLeads = useMemo(
    () =>
      loadingLeads
        ? []
        : leads.filter(
            (lead) =>
              !isTerminalStage(lead.stage) &&
              Boolean(lead.followupDate || lead.meetingDate),
          ),
    [leads, loadingLeads],
  );

  const today = getAustralianDate();

  const pendingFollowups = useMemo(() => {
    return relevantLeads.filter(
      (lead) =>
        !lead.followupCompletedAt &&
        lead.followupDate &&
        (isBefore(parseISO(lead.followupDate), today) ||
          isEqual(parseISO(lead.followupDate), today)),
    );
  }, [relevantLeads, today]);

  const pendingMeetings = useMemo(() => {
    return relevantLeads.filter(
      (lead) =>
        !lead.meetingCompletedAt &&
        lead.meetingDate &&
        (isBefore(parseISO(lead.meetingDate), today) ||
          isEqual(parseISO(lead.meetingDate), today)),
    );
  }, [relevantLeads, today]);

  const notificationItems = [
    ...pendingFollowups.map((lead) => {
      const { scheduledDate, status } = getDateStatus(lead.followupDate);

      return {
        key: `followup-${lead.id}`,
        label: lead.name,
        kind: "Follow-up",
        scheduledDate,
        status,
        action: () =>
          dispatch(
            openModal({
              type: "followUpPrompt",
              payload: { leadId: lead.id },
            }),
          ),
      };
    }),

    ...pendingMeetings.map((lead) => {
      const { scheduledDate, status } = getDateStatus(lead.meetingDate!);

      return {
        key: `meeting-${lead.id}`,
        label: lead.name,
        kind: "Meeting",
        scheduledDate,
        status,
        action: () =>
          dispatch(
            openModal({
              type: "meetingReview",
              payload: { leadId: lead.id },
            }),
          ),
      };
    }),
  ];

  useEffect(() => {
    refreshLeadsData({ page: 1, limit: 50, hasOpenTask: true });
  }, [refreshLeadsData]);

  return (
    <Card className="border-border/70 bg-white/95 shadow-sm">
      <CardHeader className="border-b border-border/70 pb-3">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-base font-semibold">
            Overdue and due today
          </CardTitle>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setUpdatesCollapsed((prev) => !prev)}
          >
            {updatesCollapsed ? (
              <>
                <ChevronDown className="h-4 w-4" />
              </>
            ) : (
              <>
                <ChevronUp className="h-4 w-4" />
              </>
            )}
          </Button>
        </div>
      </CardHeader>

      {!updatesCollapsed && (
        <CardContent className="pt-3">
          {notificationItems.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border bg-muted/30 p-4 text-center text-sm text-muted-foreground">
              No pending follow up or meeting updates.
            </div>
          ) : (
            <div
              className={cn(
                "space-y-1",
                notificationItems.length > 6 &&
                  "max-h-60 overflow-y-auto pr-2 no-scrollbar",
              )}
            >
              {notificationItems.map((item) => (
                <div
                  key={item.key}
                  className="flex items-center gap-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-1.5 text-sm"
                >
                  <span className="w-16 shrink-0 text-xs font-medium text-amber-700">
                    {item.kind}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-semibold text-slate-900">
                    {item.label}
                  </span>
                  <span className="flex shrink-0 items-center gap-1 text-slate-600">
                    <CalendarDays className="h-3.5 w-3.5" />
                    {item.scheduledDate}
                  </span>
                  <span className="flex w-32 shrink-0 items-center gap-1 justify-end font-medium text-amber-700">
                    <Clock3 className="h-3.5 w-3.5" />
                    {item.status}
                  </span>
                  <Button size="sm" variant="outline" className="h-7 shrink-0 px-2" onClick={item.action}>
                    <Eye className="mr-1 h-3.5 w-3.5" />
                    Review
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}
