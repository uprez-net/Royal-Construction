import type { ProjectDetail } from "@/types/project";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  AlertTriangle,
  Plus,
  Send,
  Bell,
  Phone,
  Pencil,
  CheckCircle2,
  XCircle,
} from "lucide-react";
import { SectionCard } from "@/components/common/section-card";
import { StatusPill } from "@/components/common/status-pill";
import { dateFormat, shortDateFormat } from "../../../utils/formatters";
import type { TradieScheduleStatus } from "@prisma/client";
import { differenceInDays } from "date-fns";
import { DataTable } from "@/components/common/data-table";
import { useAppDispatch } from "@/lib/store/hooks";
import { openModal } from "@/lib/store/slices/uiSlice";

export function ProjectTradiesTab({ project }: { project: ProjectDetail }) {
  const getStatusTone = (status: TradieScheduleStatus) => {
    switch (status) {
      case "COMPLETED":
      case "CONFIRMED":
        return "success";
      case "DECLINED":
      case "NO_RESPONSE":
        return "danger";
      case "PENDING":
      case "PENDING_RESPONSE":
        return "warning";
      default:
        return "neutral";
    }
  };

  const getReminderTone = (
    reminder: Date | null,
    scheduledDate: Date,
    status: TradieScheduleStatus,
  ): "success" | "warning" | "neutral" => {
    // Finalized states don't need reminder urgency
    if (status === "CONFIRMED" || status === "COMPLETED") {
      return "success";
    }

    if (status === "DECLINED") {
      return "warning";
    }

    if (!reminder) {
      return status === "NO_RESPONSE" ? "warning" : "neutral";
    }

    const now = new Date();

    const daysSinceReminder = differenceInDays(now, reminder);

    const daysUntilScheduled = differenceInDays(scheduledDate, now);

    // Recently reminded and still enough runway
    if (daysSinceReminder <= 3 && daysUntilScheduled > 7) {
      return "success";
    }

    // No response and schedule approaching
    if (
      (status === "NO_RESPONSE" || status === "PENDING_RESPONSE") &&
      daysUntilScheduled <= 7
    ) {
      return "warning";
    }

    // Reminder getting stale
    if (daysSinceReminder > 7) {
      return "warning";
    }

    return "neutral";
  };

  const getAttentionStatus = (tradies: typeof project.tradieSchedules) => {
    const getAttentionMessage = (
      tradie: (typeof tradies)[number],
    ): string | null => {
      const reminderTone = getReminderTone(
        tradie.reminderSentAt,
        new Date(tradie.scheduledDate),
        tradie.status,
      );

      const tradieName = tradie.tradie.name;
      const scheduledDate = new Date(tradie.scheduledDate).toLocaleDateString(
        "en-AU",
        {
          month: "short",
        },
      );

      if (getStatusTone(tradie.status) === "danger") {
        switch (tradie.status) {
          case "PENDING":
          case "PENDING_RESPONSE":
            return `${tradieName} confirmation pending`;

          case "NO_RESPONSE":
            return `${tradieName} not responding`;

          case "DECLINED":
            return `${tradieName} declined the schedule`;

          default:
            return `${tradieName} needs attention`;
        }
      }

      if (reminderTone === "warning") {
        return `${tradieName} yet to be connected for ${scheduledDate} milestone`;
      }

      return null;
    };

    const attentionMessages = tradies
      .map(getAttentionMessage)
      .filter((message): message is string => Boolean(message));

    if (attentionMessages.length === 0) {
      return null;
    }

    return {
      count: attentionMessages.length,
      summary: `${attentionMessages.join(". ")}.`,
    };
  };

  const tradies = project.tradieSchedules;
  const attentionStatus = getAttentionStatus(tradies);
  const dispatch = useAppDispatch();

  return (
    <div className="space-y-4">
      {attentionStatus && (
        <Card className="border-red-200 bg-red-50/50 shadow-sm">
          <CardContent className="flex items-center gap-3 p-4">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-red-100 text-red-600">
              <AlertTriangle className="size-5" />
            </div>

            <div className="flex-1">
              <h4 className="text-[13px] font-bold text-red-600">
                {attentionStatus.count}{" "}
                {attentionStatus.count === 1 ? "Tradie Needs" : "Tradies Need"}{" "}
                Attention
              </h4>

              <p className="text-xs text-muted-foreground">
                {attentionStatus.summary}
              </p>
            </div>

            <Button
              size="sm"
              variant="destructive"
              className="h-8 rounded-md px-3 text-xs font-semibold"
            >
              <Send className="mr-1 size-3.5" />
              Send All Reminders
            </Button>
          </CardContent>
        </Card>
      )}

      <SectionCard
        title="Tradie Coordination Board"
        action={
          <Button
            size="sm"
            className="h-8 rounded-md bg-teal-600 px-3 text-xs font-semibold text-white hover:bg-teal-700"
            onClick={() =>
              dispatch(
                openModal({
                  type: "scheduleTradie",
                  payload: {
                    project
                  },
                }),
              )
            }
          >
            <Plus className="mr-1 size-3.5" />
            Add Tradie
          </Button>
        }
      >
        <div className="overflow-x-auto">
          <DataTable
            headers={[
              "Trade",
              "Company",
              "Contact",
              "Needed For",
              "Scheduled",
              "1-Week Reminder",
              "Confirmed",
              "Status",
              "Action",
            ]}
            rows={tradies.map((tradie) => [
              <span className="text-[13px] font-bold" key={tradie.id}>
                {tradie.tradie.trade}
              </span>,

              <span className="text-[13px]" key={`${tradie.id}-company`}>
                {tradie.tradie.company}
              </span>,

              <span className="text-xs" key={`${tradie.id}-phone`}>
                {tradie.tradie.phone}
              </span>,

              <span className="text-xs" key={`${tradie.id}-milestone`}>
                {tradie.milestone?.name ?? "N/A"}
              </span>,

              <span className="text-xs" key={`${tradie.id}-scheduled`}>
                {dateFormat.format(new Date(tradie.scheduledDate))}
              </span>,

              <StatusPill
                key={`${tradie.id}-reminder`}
                tone={getReminderTone(
                  tradie.reminderSentAt,
                  new Date(tradie.scheduledDate),
                  tradie.status,
                )}
              >
                {tradie.reminderSentAt
                  ? shortDateFormat.format(new Date(tradie.reminderSentAt))
                  : "-"}
              </StatusPill>,

              tradie.status === "CONFIRMED" ? (
                <CheckCircle2 className="size-4 text-emerald-600" />
              ) : (
                <XCircle className="size-4 text-muted-foreground" />
              ),

              <StatusPill
                id={`${tradie.id}-status`}
                tone={getStatusTone(tradie.status)}
              >
                {tradie.status}
              </StatusPill>,

              <div className="flex gap-1" key={`${tradie.id}-actions`}>
                {tradie.status !== "COMPLETED" && (
                  <Button
                    variant="outline"
                    size="icon"
                    className="size-8 rounded-lg text-muted-foreground hover:border-teal-600 hover:bg-teal-50 hover:text-teal-600"
                  >
                    <Bell className="size-3.5" />
                  </Button>
                )}

                <Button
                  variant="outline"
                  size="icon"
                  className="size-8 rounded-lg text-muted-foreground hover:border-teal-600 hover:bg-teal-50 hover:text-teal-600"
                >
                  <Phone className="size-3.5" />
                </Button>

                <Button
                  variant="outline"
                  size="icon"
                  className="size-8 rounded-lg text-muted-foreground hover:border-teal-600 hover:bg-teal-50 hover:text-teal-600"
                >
                  <Pencil className="size-3.5" />
                </Button>
              </div>,
            ])}
            onRowClick={(rowIndex) => {
              const tradie = tradies[rowIndex];

              // handle dialog/navigation
              console.log("Clicked tradie:", tradie.id);
            }}
          />
        </div>
      </SectionCard>
    </div>
  );
}
