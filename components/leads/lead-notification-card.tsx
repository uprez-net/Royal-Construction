'use client';
import {
  fetchOpenTasks,
  type LeadTaskRow,
} from "@/lib/leads/task-service";
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
import { sydneyDateOnly } from "@/lib/dates/sydney";
import { toZonedTime } from "date-fns-tz";
import {
  addDays,
  differenceInCalendarDays,
  format,
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
  const [updatesCollapsed, setUpdatesCollapsed] = useState(false);

  // Tasks, like the tab below it. This panel read Lead.followupDate while the
  // Follow-ups tab read LeadTask, so the two sat on one screen describing
  // different things, which is the disagreement #193 set out to remove.
  const [tasks, setTasks] = useState<LeadTaskRow[]>([]);
  const [loadFailed, setLoadFailed] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    fetchOpenTasks(controller.signal)
      .then(setTasks)
      .catch((err: unknown) => {
        // An abort on unmount is expected. Anything else must be visible: an
        // empty panel reads as "nothing due", and telling someone they are
        // clear when the request failed is the exact lie this work removes.
        if (err instanceof DOMException && err.name === "AbortError") return;
        console.error("Could not load overdue tasks", err);
        setLoadFailed(true);
      })
      // Not in the abort path: an unmounted component has no state to set.
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, []);

  // Compared as Sydney calendar dates, not as instants against a local
  // midnight. A task due at Sydney midnight is stored as 14:00Z the previous
  // afternoon, so comparing the raw instant to a Date built from the local
  // day puts it in the wrong bucket for most of the day. The crons had the
  // same defect and it stopped reminders firing at all.
  const todayKey = sydneyDateOnly(getAustralianDate());

  // Undated tasks are excluded here, unlike in the tab. This panel answers
  // "what is due", and work with no date is not due; it belongs in the list
  // below, where someone can schedule it.
  const due = useMemo(
    () =>
      tasks.filter((t) => t.dueDate !== null && sydneyDateOnly(new Date(t.dueDate)) <= todayKey),
    [tasks, todayKey],
  );

  const pendingFollowups = useMemo(() => due.filter((t) => t.type !== "MEETING"), [due]);
  const pendingMeetings = useMemo(() => due.filter((t) => t.type === "MEETING"), [due]);

  const notificationItems = [
    ...pendingFollowups.map((task) => {
      const { scheduledDate, status } = getDateStatus(task.dueDate);

      return {
        key: `followup-${task.id}`,
        label: task.lead.name,
        kind: "Follow-up",
        scheduledDate,
        status,
        action: () =>
          dispatch(
            openModal({
              type: "followUpPrompt",
              payload: { leadId: task.leadId },
            }),
          ),
      };
    }),

    ...pendingMeetings.map((task) => {
      const { scheduledDate, status } = getDateStatus(task.dueDate);

      return {
        key: `meeting-${task.id}`,
        label: task.lead.name,
        kind: "Meeting",
        scheduledDate,
        status,
        action: () =>
          dispatch(
            openModal({
              type: "meetingReview",
              payload: { leadId: task.leadId },
            }),
          ),
      };
    }),
  ];

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
              {/* Three states, not two. An empty panel means "nothing due",
                  and saying that while still loading, or after a failed
                  request, is the same wrong reassurance in a new place. */}
              {loading
                ? "Loading..."
                : loadFailed
                  ? "Could not load tasks. This panel is empty because the request failed, not because there is nothing due."
                  : "No pending follow up or meeting updates."}
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
