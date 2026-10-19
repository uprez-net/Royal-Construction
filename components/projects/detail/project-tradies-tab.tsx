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
import { useCallback, useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";
import { sameTrade } from "@/lib/domain/tradies/request-rules";
import {
  projectTrades,
  schedulesForTrade,
  tradeOverview,
} from "./tradie-requests";
import { TradeList, TradeWorkbench } from "./tradie-trade-overview";
import { RequestDeliveryStatus } from "./request-delivery-status";
import { tradeKey } from "@/lib/domain/tradies/selection-rules";

const GST_WORDS = {
  EXCLUSIVE: "ex GST",
  INCLUSIVE: "inc GST",
  NOT_REGISTERED: "no GST",
} as const;

/** Where the amount in the Quote column came from. */
function quoteSource(tradie: TradieScheduleWithTradieAndMilestone): string {
  if (!tradie.requiresQuote) return "From rate";
  if (tradie.status === "AWAITING_QUOTE") return "";
  const quote = tradie.quote;
  if (!quote) return tradie.quotedPrice ? "Recorded on booking" : "";
  const source =
    quote.source === "EMAIL"
      ? `Email reply · ${shortDateFormat.format(new Date(quote.quotedAt))}`
      : `Manual${quote.enteredBy ? ` · ${quote.enteredBy.name}` : ""}`;
  return quote.gstTreatment
    ? `${source} · ${GST_WORDS[quote.gstTreatment]}`
    : source;
}

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

  const attentionItems = useTradieAttention(project.tradieSchedules);
  const dispatch = useAppDispatch();

  // The trade being looked at lives in the URL, beside `activeTab`, so it
  // survives a reload and the back button, and a fresh visit starts on "All".
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const searchParamsString = searchParams.toString();
  const trades = useMemo(() => projectTrades(project), [project]);
  const tradeParam = searchParams.get("trade");
  const trade = tradeParam
    ? (trades.find((option) => sameTrade(option, tradeParam)) ?? null)
    : null;

  const selectTrade = useCallback(
    (next: string | null) => {
      const params = new URLSearchParams(searchParamsString);
      if (next) params.set("trade", next);
      else params.delete("trade");
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [pathname, router, searchParamsString],
  );

  const overviews = useMemo(
    () => trades.map((option) => tradeOverview(project, option)),
    [project, trades],
  );
  const overview = trade
    ? overviews.find((item) => item.trade === trade)
    : undefined;

  // The board shows the selected trade's bookings, or every booking.
  const tradies = useMemo(
    () => schedulesForTrade(project.tradieSchedules, trade),
    [project.tradieSchedules, trade],
  );

  const openRequestWizard = () =>
    dispatch(
      openModal({
        type: "scheduleTradie",
        payload: { project, ...(trade ? { trade } : {}) },
      }),
    );

  const toScheduleListItem = (
    tradie: TradieScheduleWithTradieAndMilestone,
    options: { includeQuote: boolean },
  ) => buildScheduleListItem(project, tradie, options);

  // Who holds each trade, for the board's "Selected" marker.
  const liveSelections = useMemo(
    () =>
      new Map(
        (project.tradeSelections ?? [])
          .filter((selection) => selection.status !== "CANCELLED")
          .map((selection) => [selection.tradeKey, selection]),
      ),
    [project.tradeSelections],
  );

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
        title="Trade requests"
        description="Ask tradies to quote for a trade's activities, compare what comes back, and see which activities have their tradie."
        action={
          <Button
            size="sm"
            className="h-8 rounded-md px-3 text-xs font-medium"
            onClick={openRequestWizard}
          >
            <Plus className="mr-1 size-3.5" aria-hidden="true" />
            Schedule tradies
          </Button>
        }
      >
        <div className="space-y-4">
          {trades.length > 0 ? (
            <div
              role="group"
              aria-label="Trade category"
              className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1"
            >
              {[null, ...trades].map((option) => {
                const selected = option === trade;
                return (
                  <button
                    key={option ?? "all"}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => selectTrade(option)}
                    className={cn(
                      "shrink-0 rounded-full border px-3 py-1 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring/50",
                      selected
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border/70 bg-card text-muted-foreground hover:bg-muted/40 hover:text-foreground",
                    )}
                  >
                    {option ?? "All trades"}
                  </button>
                );
              })}
            </div>
          ) : null}

          {overview ? (
            <TradeWorkbench
              project={project}
              overview={overview}
              onRequest={openRequestWizard}
            />
          ) : trades.length > 0 ? (
            <TradeList overviews={overviews} onSelect={selectTrade} />
          ) : (
            <p className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
              No activities on this project name a trade yet, and nobody has
              been booked. Use Schedule tradies to send a first request.
            </p>
          )}
        </div>
      </SectionCard>

      <SectionCard
        title="Tradie coordination board"
        description={
          trade
            ? `${trade} bookings, one row per tradie and activity.`
            : "Every booking, one row per tradie and activity."
        }
      >
        <DataTable
          mobileLayout="cards"
          mobileTitleColumn={1}
          mobileColumns={1}
          key={`${tradies.length}-${tradies.map((t) => t.status).join("-")}`}
          caption="Tradies booked on this project: the request email, confirmation status and quote for each tradie and activity."
          align={[
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
            "Needed for",
            "Scheduled",
            "Request",
            "Duration",
            "Status",
            "Quote",
            "Actions",
          ]}
          rowClassName={(rowIndex) => {
            // Once a trade has its tradie, everyone else's rows in it recede.
            const row = tradies[rowIndex];
            const holder = liveSelections.get(tradeKey(row.tradie.trade));
            return holder && holder.tradieId !== row.tradieId
              ? "opacity-60"
              : undefined;
          }}
          rows={tradies.map((tradie) => {
            const tone = reminderTone(tradie, now);

            const reminderDate = tradie.reminderSentAt
              ? shortDateFormat.format(new Date(tradie.reminderSentAt))
              : "not sent";
            const selection = liveSelections.get(tradeKey(tradie.tradie.trade));
            const isSelected = selection?.tradieId === tradie.tradieId;

            return [
              <span className="text-sm font-medium" key={tradie.id}>
                {tradie.tradie.trade}
              </span>,

              <span
                className="flex flex-wrap items-center gap-1.5 text-sm"
                key={`${tradie.id}-company`}
              >
                {tradie.tradie.name}
                {isSelected ? (
                  <StatusPill tone="success">
                    {selection?.status === "CANCELLATION_PENDING"
                      ? "Selected · cancellation pending"
                      : "Selected"}
                  </StatusPill>
                ) : null}
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

              tradie.requestRecipient ? (
                <RequestDeliveryStatus
                  key={`${tradie.id}-request`}
                  projectId={project.id}
                  delivery={tradie.requestRecipient}
                  tradieName={tradie.tradie.name}
                  compact
                />
              ) : (
                <span
                  className="text-xs text-muted-foreground"
                  key={`${tradie.id}-request`}
                >
                  Booked directly
                </span>
              ),

              <span className="text-xs" key={`${tradie.id}-duration`}>
                {tradie.durationDays === 1
                  ? "1 day"
                  : `${tradie.durationDays} days`}
              </span>,

              // The reminder sits under the status it is chasing. Its tone is a
              // second signal only: "follow up" is always spelled out, so
              // colour never carries the meaning alone.
              <div
                className="flex flex-col items-start gap-1"
                key={`${tradie.id}-status`}
              >
                <StatusPill tone={getStatusTone(tradie.status)}>
                  {getStatusText(tradie.status)}
                </StatusPill>
                {tradie.status !== "COMPLETED"
                && tradie.status !== "CANCELLED" ? (
                  <span
                    className={cn(
                      "text-[11px]",
                      tone === "warning"
                        ? "font-medium text-warning-ink"
                        : "text-muted-foreground",
                    )}
                  >
                    Reminder {reminderDate}
                    {tone === "warning" ? " · follow up" : ""}
                  </span>
                ) : null}
              </div>,

              <div
                className="flex flex-col items-end gap-0.5"
                key={`${tradie.id}-cost`}
              >
                <span className="font-mono text-xs font-medium tabular-nums">
                  {scheduleCost(tradie)}
                </span>
                <span className="text-[11px] text-muted-foreground">
                  {quoteSource(tradie)}
                </span>
              </div>,

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
                  {trade
                    ? `No ${trade} tradies booked on this project`
                    : "No tradies scheduled on this project"}
                </p>

                <p className="text-xs text-muted-foreground">
                  Use Schedule tradies to request quotes for a trade&apos;s
                  activities.
                </p>
              </div>
            </div>
          }
        />
      </SectionCard>
    </div>
  );
}
