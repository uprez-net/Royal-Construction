'use client';
import { useLeadsData } from "@/hooks/use-leads-data";
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
              lead.stage === "Meeting Scheduled" ||
              lead.stage === "In Follow-up",
          ),
    [leads.length, loadingLeads],
  );

  const today = getAustralianDate();

  const pendingFollowups = useMemo(() => {
    return relevantLeads.filter(
      (lead) =>
        lead.stage === "In Follow-up" &&
        lead.followupDate &&
        (isBefore(parseISO(lead.followupDate), today) ||
          isEqual(parseISO(lead.followupDate), today)),
    );
  }, [relevantLeads, today]);

  const pendingMeetings = useMemo(() => {
    return relevantLeads.filter(
      (lead) =>
        lead.stage === "Meeting Scheduled" &&
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
        label: `Follow-up due for ${lead.name} — was it completed?`,
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
        label: `Meeting review needed for ${lead.name}`,
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
    refreshLeadsData({
      page: 1,
      limit: 50,
      status: ["Meeting Scheduled", "In Follow-up"].join(","),
    });
  }, []);

  return (
    <Card className="border-border/70 bg-white/95 shadow-sm">
      <CardHeader className="border-b border-border/70 pb-3">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-base font-semibold">
            Follow Up and Meeting Scheduled Updates
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
        <CardContent className="pt-4">
          {notificationItems.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border bg-muted/30 p-6 text-center text-sm text-muted-foreground">
              No pending follow up or meeting updates.
            </div>
          ) : (
            <div
              className={cn(
                "space-y-2",
                notificationItems.length > 2 &&
                  "max-h-42.5 overflow-y-auto pr-2 no-scrollbar",
              )}
            >
              {notificationItems.map((item) => (
                <div
                  key={item.key}
                  className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3"
                >
                  <div className="flex-1">
                    <p className="font-semibold text-slate-900">{item.label}</p>

                    <div className="mt-1 flex flex-wrap items-center gap-3 text-sm text-slate-600">
                      <div className="flex items-center gap-1">
                        <CalendarDays className="h-4 w-4" />
                        <span>Scheduled At: {item.scheduledDate}</span>
                      </div>

                      <div className="flex items-center gap-1 font-medium text-amber-700">
                        <Clock3 className="h-4 w-4" />
                        <span>{item.status}</span>
                      </div>
                    </div>
                  </div>

                  <Button size="sm" variant="outline" onClick={item.action}>
                    <Eye className="mr-1 h-4 w-4" />
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
