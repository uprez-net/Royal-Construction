import type {
  ProjectDetail,
  TradieScheduleWithTradieAndMilestone,
  TradieUrgentReminderItem,
} from "@/types/project";
import { Button } from "@/components/ui/button";
import {
  Plus,
  Bell,
  Phone,
  Pencil,
  Clock10,
  CalendarClock,
} from "lucide-react";
import { SectionCard } from "@/components/common/section-card";
import { StatusPill } from "@/components/common/status-pill";
import {
  currency,
  dateFormat,
  formatStatus,
  shortDateFormat,
} from "@/utils/formatters";
import type { TradieScheduleStatus } from "@prisma/client";
import { differenceInDays } from "date-fns";
import { DataTable } from "@/components/common/data-table";
import { toast } from "sonner";
import { reminderTone } from "@/lib/domain/tradies/attention";
import { rescheduleOutcome } from "@/lib/domain/tradies/reschedule-rules";
import { useAppDispatch } from "@/lib/store/hooks";
import { dismissTradieAlerts } from "@/lib/store/slices/projectsSlice";
import { openModal } from "@/lib/store/slices/uiSlice";
import { calculateScheduleTotalCost } from "@/utils/calculations";
import { TradieAttentionCard } from "./tradie-attention-card";
import { useTradieAttention } from "./tradie-attention";
import { toScheduleListItem as buildScheduleListItem } from "./schedule-list-item";

/**
 * Formats a money value, falling back to an em dash rather than rendering
 * "$NaN" or a bare "$" when the underlying Decimal-as-string is missing or
 * unparseable.
 */
function money(value: string | number | null | undefined) {
  const parsed = typeof value === "number" ? value : Number(value);

  return Number.isFinite(parsed) && value !== null && value !== ""
    ? currency.format(parsed)
    : "—";
}

export function ProjectTradiesTab({ project }: { project: ProjectDetail }) {
  const getStatusTone = (status: TradieScheduleStatus) => {
    switch (status) {
      case "COMPLETED":
      case "CONFIRMED":
        return "success";
      case "PENDING_FINAL_CONFIRMATION":
        return "warning";
      case "DECLINED":
      case "NO_RESPONSE":
        return "danger";
      case "PENDING":
      case "PENDING_RESPONSE":
      case "AWAITING_QUOTE":
      case "AWAITING_ADMIN_APPROVAL":
        return "warning";
      default:
        return "neutral";
    }
  };

  const getStatusText = (status: TradieScheduleStatus) => {
    switch (status) {
      case "PENDING":
        return "Pending confirmation";
      case "PENDING_RESPONSE":
        return "Awaiting response";
      case "NO_RESPONSE":
        return "No response";
      case "CONFIRMED":
        return "Confirmed";
      case "DECLINED":
        return "Declined";
      case "COMPLETED":
        return "Completed";
      case "AWAITING_QUOTE":
        return "Awaiting quote";
      case "AWAITING_ADMIN_APPROVAL":
        return "Availability confirmed · admin review";
      case "PENDING_FINAL_CONFIRMATION":
        return "Pending final confirmation";
      default:
        // Never render a raw enum: a status added to the schema but not to this
        // switch still reads as a label rather than SCREAMING_SNAKE_CASE.
        return formatStatus(status);
    }
  };

  // The board's reminder cell and the attention card read the same rule
  // (lib/domain/tradies/attention.ts), so a cell saying "follow up" always
  // has an alert beside it saying why.
  const now = new Date();

  const tradies = project.tradieSchedules;
  const attentionItems = useTradieAttention(tradies);
  const dispatch = useAppDispatch();

  const toScheduleListItem = (
    tradie: TradieScheduleWithTradieAndMilestone,
    options: { includeQuote: boolean },
  ) => buildScheduleListItem(project, tradie, options);

  const scheduleCost = (tradie: TradieScheduleWithTradieAndMilestone) => {
    if (tradie.requiresQuote) {
      return tradie.status === "AWAITING_QUOTE"
        ? "Awaiting quote"
        : money(tradie.quotedPrice);
    }

    const lastQuotedPrice = Number(tradie.tradie.lastQuotedPrice);

    // No rate on file is "unknown", not "$0" — and Number(null) is 0, so the
    // nullish check has to come before the finite check.
    if (
      tradie.tradie.lastQuotedPrice == null
      || !Number.isFinite(lastQuotedPrice)
    ) {
      return "—";
    }

    return calculateScheduleTotalCost(
      lastQuotedPrice,
      tradie.durationDays,
      tradie.tradie.lastQuotedPriceUnit,
    );
  };

  return (
    <div className="space-y-4">
      <TradieAttentionCard
        items={attentionItems}
        project={project}
        onDismiss={async (scheduleIds) => {
          try {
            await dispatch(
              dismissTradieAlerts({ projectId: project.id, scheduleIds }),
            ).unwrap();
          } catch (error) {
            toast.error(
              typeof error === "string"
                ? error
                : "Unable to dismiss the alerts",
            );
          }
        }}
      />

      <SectionCard
        title="Tradie coordination board"
        action={
          <Button
            size="sm"
            className="h-8 rounded-md px-3 text-xs font-medium"
            onClick={() =>
              dispatch(
                openModal({
                  type: "scheduleTradie",
                  payload: {
                    project,
                  },
                }),
              )
            }
          >
            <Plus className="mr-1 size-3.5" aria-hidden="true" />
            Schedule tradies
          </Button>
        }
      >
        <DataTable
          mobileLayout="cards"
          mobileTitleColumn={1}
          mobileColumns={1}
          key={`${tradies.length}-${tradies.map((t) => t.status).join("-")}`}
          caption="Tradies scheduled on this project, with reminder status, confirmation status and cost."
          align={[
            "start",
            "start",
            "start",
            "start",
            "start",
            "start",
            "start",
            "start",
            "end",
            "start",
          ]}
          headers={[
            "Trade",
            "Company",
            "Contact",
            "Needed for",
            "Scheduled",
            "1-week reminder",
            "Duration",
            "Status",
            "Cost",
            "Actions",
          ]}
          rows={tradies.map((tradie) => {
            const tone = reminderTone(tradie, now);

            const reminderDate = tradie.reminderSentAt
              ? shortDateFormat.format(new Date(tradie.reminderSentAt))
              : "Not sent";

            return [
              <span className="text-sm font-medium" key={tradie.id}>
                {tradie.tradie.trade}
              </span>,

              <span className="text-sm" key={`${tradie.id}-company`}>
                {tradie.tradie.name}
              </span>,

              <span
                className="font-mono text-xs tabular-nums"
                key={`${tradie.id}-phone`}
              >
                {tradie.tradie.phone}
              </span>,

              <span className="text-xs" key={`${tradie.id}-milestone`}>
                {tradie.milestone?.name ?? "Not linked to a milestone"}
              </span>,

              <span
                className="font-mono text-xs tabular-nums"
                key={`${tradie.id}-scheduled`}
              >
                {dateFormat.format(new Date(tradie.scheduledDate))}
              </span>,

              // The tone is a second signal only: the cell always spells out
              // the reminder date, and adds "follow up" in words when the tone
              // is a warning, so colour is never the sole carrier of meaning.
              <StatusPill key={`${tradie.id}-reminder`} tone={tone}>
                {tone === "warning"
                  ? `${reminderDate} · follow up`
                  : reminderDate}
              </StatusPill>,

              <span className="text-xs" key={`${tradie.id}-duration`}>
                {tradie.durationDays === 1
                  ? "1 day"
                  : `${tradie.durationDays} days`}
              </span>,

              <StatusPill
                key={`${tradie.id}-status`}
                tone={getStatusTone(tradie.status)}
              >
                {getStatusText(tradie.status)}
              </StatusPill>,

              <span
                className="font-mono text-xs font-medium tabular-nums"
                key={`${tradie.id}-cost`}
              >
                {scheduleCost(tradie)}
              </span>,

              <div className="flex gap-1" key={`${tradie.id}-actions`}>
                {tradie.status !== "COMPLETED"
                  && tradie.status !== "CANCELLED" && (
                    <Button
                      variant="outline"
                      size="icon"
                      aria-label={`Send a reminder to ${tradie.tradie.name}`}
                      className="size-8 rounded-lg text-muted-foreground hover:border-primary hover:bg-muted/40 hover:text-primary"
                      disabled={[
                        "AWAITING_ADMIN_APPROVAL",
                        "DECLINED",
                        "CONFIRMED",
                      ].includes(tradie.status)}
                      onClick={(event) => {
                        // The row itself is a control; without this the row's
                        // own handler fires too and two modals race.
                        event.stopPropagation();
                        dispatch(
                          openModal({
                            type: "tradieReminder",
                            payload: {
                              schedule: toScheduleListItem(tradie, {
                                includeQuote: true,
                              }),
                            },
                          }),
                        );
                      }}
                    >
                      <Bell className="size-3.5" aria-hidden="true" />
                    </Button>
                  )}

                <Button
                  variant="outline"
                  size="icon"
                  aria-label={`Log a call with ${tradie.tradie.name}`}
                  className="size-8 rounded-lg text-muted-foreground hover:border-primary hover:bg-muted/40 hover:text-primary"
                  disabled={[
                    "CANCELLED",
                    "AWAITING_ADMIN_APPROVAL",
                    "DECLINED",
                    "CONFIRMED",
                  ].includes(tradie.status)}
                  onClick={(event) => {
                    event.stopPropagation();
                    dispatch(
                      openModal({
                        type: "logCall",
                        payload: {
                          schedule: toScheduleListItem(tradie, {
                            includeQuote: false,
                          }),
                        },
                      }),
                    );
                  }}
                >
                  <Phone className="size-3.5" aria-hidden="true" />
                </Button>

                {/* Declined, completed and removed bookings cannot move: the
                    same rule the server applies, so the button is never one
                    that can only fail. */}
                {rescheduleOutcome(tradie.status) && (
                  <Button
                    variant="outline"
                    size="icon"
                    aria-label={`Reschedule ${tradie.tradie.name}`}
                    title="Reschedule"
                    className="size-8 rounded-lg text-muted-foreground hover:border-primary hover:bg-muted/40 hover:text-primary"
                    onClick={(event) => {
                      event.stopPropagation();
                      dispatch(
                        openModal({
                          type: "rescheduleTradie",
                          payload: {
                            schedule: toScheduleListItem(tradie, {
                              includeQuote: true,
                            }),
                          },
                        }),
                      );
                    }}
                  >
                    <CalendarClock className="size-3.5" aria-hidden="true" />
                  </Button>
                )}

                <Button
                  variant="outline"
                  size="icon"
                  aria-label={`Update the status of ${tradie.tradie.name}`}
                  className="size-8 rounded-lg text-muted-foreground hover:border-primary hover:bg-muted/40 hover:text-primary"
                  onClick={(event) => {
                    event.stopPropagation();
                    dispatch(
                      openModal({
                        type: "confirmStatus",
                        payload: {
                          schedule: toScheduleListItem(tradie, {
                            includeQuote: false,
                          }),
                        },
                      }),
                    );
                  }}
                >
                  <Pencil className="size-3.5" aria-hidden="true" />
                </Button>
              </div>,
            ];
          })}
          rowLabel={(rowIndex) =>
            `Open schedule details for ${tradies[rowIndex].tradie.name}`
          }
          onRowClick={(rowIndex) => {
            const tradie = tradies[rowIndex];
            dispatch(
              openModal({
                type: "tradieScheduleDetails",
                payload: {
                  schedule: {
                    id: tradie.id,
                    tradieName: tradie.tradie.name,
                    lastQuotedPriceUnit: tradie.tradie.lastQuotedPriceUnit,
                    tradeType: tradie.tradie.trade,
                    abn: tradie.tradie.abn,
                    projectName: project.name,
                    milestoneName: tradie.milestone?.name,
                    taskLabel: tradie.milestone?.name
                      ? `${tradie.tradie.trade} for ${tradie.milestone.name}`
                      : tradie.tradie.trade,
                    scheduledDate: new Date(tradie.scheduledDate).toISOString(),
                    daysLeft: differenceInDays(
                      new Date(tradie.scheduledDate),
                      new Date(),
                    ),
                    status: tradie.status,
                    reminderSentAt: tradie.reminderSentAt
                      ? new Date(tradie.reminderSentAt).toISOString()
                      : undefined,
                    contact: {
                      email: tradie.tradie.email,
                      phone: tradie.tradie.phone,
                      additionalEmails: tradie.tradie.additionalEmails,
                    },
                    siteManager: {
                      name: project.siteManager?.name ?? "Unassigned",
                      email: project.siteManager?.email ?? "",
                      phone: project.siteManager?.phone ?? "",
                    },
                  } satisfies TradieUrgentReminderItem,
                },
              }),
            );
          }}
          emptyState={
            <div className="flex flex-col items-center justify-center gap-3">
              <div className="flex size-12 items-center justify-center rounded-2xl bg-muted">
                <Clock10
                  className="size-5 text-muted-foreground"
                  aria-hidden="true"
                />
              </div>

              <div className="space-y-1">
                <p className="text-sm font-semibold text-foreground">
                  No tradies scheduled on this project
                </p>

                <p className="text-xs text-muted-foreground">
                  Use Schedule tradies to book a trade against a milestone.
                </p>
              </div>
            </div>
          }
        />
      </SectionCard>
    </div>
  );
}
