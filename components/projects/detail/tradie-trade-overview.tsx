import type { TradieRequestKind, TradieScheduleStatus } from "@prisma/client";
import {
  ArrowDownRight,
  Bell,
  CalendarCheck2,
  CalendarClock,
  CheckCircle2,
  FilePlus2,
  Inbox,
  Mail,
  Pencil,
  Phone,
  Send,
  UserPlus,
} from "lucide-react";
import { useState, type ReactNode } from "react";

import { StatusPill } from "@/components/common/status-pill";
import { TradeIcon } from "@/components/tradie-management/trade-icon";
import { Button } from "@/components/ui/button";
import { reminderTone } from "@/lib/domain/tradies/attention";
import { rescheduleOutcome } from "@/lib/domain/tradies/reschedule-rules";
import { useAppDispatch } from "@/lib/store/hooks";
import { openModal } from "@/lib/store/slices/uiSlice";
import { cn } from "@/lib/utils";
import {
  PROJECT_STAGE_LABELS,
  type ProjectDetail,
  type TradieScheduleWithTradieAndMilestone,
} from "@/types/project";
import {
  currency,
  dateFormat,
  formatStatus,
  shortDateFormat,
} from "@/utils/formatters";

import { BillingPill } from "./financials-tab/activity-detail";
import { ManualQuoteDialog } from "./manual-quote-dialog";
import { TradieEmailThreadModal } from "./tradie-email-thread-modal";
import { RequestDeliveryStatus } from "./request-delivery-status";
import {
  toScheduleDetailsItem,
  toScheduleListItem,
} from "./schedule-list-item";
import {
  CancelSelectionDialog,
  SelectQuoteDialog,
} from "./trade-selection-dialogs";
import {
  isActiveSchedule,
  type TradeActivity,
  type TradeOverview,
  type TradeTradie,
} from "./tradie-requests";

// The trade workbench on the Tradies tab: who was asked and whether the email
// reached them, who quoted, who is selected, and which of the trade's
// activities have their tradie. Once a tradie is selected, each activity also
// carries their booking and its actions — reschedule, status, remind, call.

function initials(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((word) => word[0]?.toUpperCase())
      .join("") || "?"
  );
}

function Stat({
  icon,
  label,
  value,
  note,
}: {
  icon: ReactNode;
  label: string;
  value: ReactNode;
  note: ReactNode;
}) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-border/70 bg-card px-3 py-3">
      <span
        aria-hidden="true"
        className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground"
      >
        {icon}
      </span>
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="font-heading text-xl font-semibold tracking-tight text-foreground">
          {value}
        </p>
        <p className="text-xs text-muted-foreground">{note}</p>
      </div>
    </div>
  );
}

const ICON_BUTTON =
  "size-8 rounded-lg text-muted-foreground hover:border-primary hover:bg-muted/40 hover:text-primary";

function tradieState(tradie: TradeTradie): {
  tone: "success" | "warning" | "neutral" | "primary";
  label: string;
} {
  if (tradie.selected) return { label: "Selected", tone: "success" };
  if (tradie.approved) return { label: "Approved", tone: "success" };
  if (tradie.openCount === 0) return { label: "Closed", tone: "neutral" };
  if (tradie.quotedTotal !== null || tradie.hasQuote)
    return { label: "Quote received", tone: "primary" };
  return { label: "Awaiting quote", tone: "warning" };
}

function QuoteCard({
  projectId,
  tradie,
  activityCount,
  lowest,
  selectionLive,
  onSelect,
  onOpenEmails,
}: {
  projectId: string;
  tradie: TradeTradie;
  activityCount: number;
  lowest: boolean;
  /** Someone holds the trade, so nobody else can be selected. */
  selectionLive: boolean;
  onSelect: () => void;
  /** Opens this tradie's email thread; null when the caller may not see it. */
  onOpenEmails: (() => void) | null;
}) {
  const state = tradieState(tradie);
  const requested = tradie.schedules.filter((schedule) =>
    isActiveSchedule(schedule.status),
  ).length;
  // Booked without a quote: the card is about the booking, and its price is
  // something to add rather than something still to arrive.
  const booked = tradie.delivery?.request.kind === "BOOKING";
  const reasonId = `select-blocked-${tradie.tradieId}`;
  return (
    <article
      className={cn(
        "space-y-3 rounded-lg border bg-card px-4 py-3",
        tradie.selected ? "border-success/50" : "border-border/70",
        selectionLive && !tradie.selected && "opacity-70",
      )}
    >
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,0.8fr)_auto] sm:items-center">
        <div className="flex min-w-0 items-center gap-3">
          <span
            aria-hidden="true"
            className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-xs font-semibold text-muted-foreground"
          >
            {initials(tradie.name)}
          </span>
          <div className="min-w-0">
            <h4 className="truncate text-sm font-semibold text-foreground">
              {tradie.name}
            </h4>
            <p className="truncate font-mono text-xs text-muted-foreground">
              {tradie.phone || tradie.email}
            </p>
          </div>
        </div>

        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">
            {tradie.quotedTotal === null
              ? `${booked ? "Booked" : "Requested"} · ${requested || tradie.schedules.length} of ${activityCount} activities`
              : `${booked ? "Priced" : "Quoted"} · ${tradie.quotedCount} of ${activityCount} activities`}
          </p>
          <p className="flex items-center gap-2 font-mono text-sm font-medium text-foreground">
            {tradie.quotedTotal === null ? (
              <span className="font-sans text-muted-foreground">
                {tradie.hasQuote
                  ? "Quote received"
                  : booked
                    ? "No price yet"
                    : "No quote yet"}
              </span>
            ) : (
              currency.format(tradie.quotedTotal)
            )}
            {lowest ? (
              <span className="rounded-md bg-success-light px-1.5 py-0.5 font-sans text-[11px] font-medium text-success-ink">
                Lowest
              </span>
            ) : null}
          </p>
        </div>

        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">Next booking</p>
          <p className="font-mono text-xs text-foreground">
            {tradie.nextDate
              ? dateFormat.format(tradie.nextDate)
              : "Not booked"}
          </p>
        </div>

        <div className="sm:justify-self-end">
          <StatusPill tone={state.tone}>{state.label}</StatusPill>
        </div>
      </div>

      <div className="flex flex-col gap-2 border-t border-border/60 pt-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          {tradie.delivery ? (
            <RequestDeliveryStatus
              projectId={projectId}
              delivery={tradie.delivery}
              tradieName={tradie.name}
            />
          ) : (
            <p className="text-xs text-muted-foreground">
              No request email (booked or quoted directly)
            </p>
          )}
        </div>
        <div className="flex shrink-0 flex-col items-start gap-1 sm:items-end">
          <div className="flex items-center gap-2">
            {onOpenEmails ? (
              <Button
                variant="outline"
                size="icon"
                aria-label={`Open emails with ${tradie.name}`}
                title="Emails"
                className={ICON_BUTTON}
                onClick={onOpenEmails}
              >
                <Mail className="size-3.5" aria-hidden="true" />
              </Button>
            ) : null}
            {!selectionLive && tradie.openCount > 0 ? (
              <Button
                size="sm"
                variant={tradie.selectBlockedBy ? "outline" : "default"}
                className="h-8 text-xs"
                disabled={tradie.selectBlockedBy !== null}
                aria-describedby={tradie.selectBlockedBy ? reasonId : undefined}
                onClick={onSelect}
              >
                <CheckCircle2 className="mr-1.5 size-3.5" aria-hidden="true" />
                Select quote
              </Button>
            ) : null}
          </div>
          {!selectionLive && tradie.openCount > 0 && tradie.selectBlockedBy ? (
            <p
              id={reasonId}
              className="max-w-72 text-xs text-muted-foreground sm:text-right"
            >
              {tradie.selectBlockedBy}
            </p>
          ) : null}
        </div>
      </div>
    </article>
  );
}

function scheduleStatusTone(
  status: TradieScheduleStatus,
): "success" | "warning" | "danger" | "neutral" {
  switch (status) {
    case "COMPLETED":
    case "CONFIRMED":
      return "success";
    case "DECLINED":
    case "NO_RESPONSE":
      return "danger";
    case "PENDING":
    case "PENDING_RESPONSE":
    case "PENDING_FINAL_CONFIRMATION":
    case "AWAITING_QUOTE":
    case "AWAITING_ADMIN_APPROVAL":
      return "warning";
    default:
      return "neutral";
  }
}

function scheduleStatusText(status: TradieScheduleStatus): string {
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
}

/** The selected tradie's booking on an activity: the open one, else the last. */
function selectedBooking(
  activity: TradeActivity,
  tradieId: string,
): TradieScheduleWithTradieAndMilestone | null {
  const own = activity.schedules.filter(
    (schedule) =>
      schedule.tradieId === tradieId && schedule.status !== "CANCELLED",
  );
  return (
    own.find((schedule) => isActiveSchedule(schedule.status))
    ?? own.at(-1)
    ?? null
  );
}

/** The selected tradie's booking on one activity, and what can be done to it. */
function SelectedBookingRow({
  project,
  booking,
}: {
  project: ProjectDetail;
  booking: TradieScheduleWithTradieAndMilestone;
}) {
  const dispatch = useAppDispatch();
  const { name } = booking.tradie;
  const status = booking.status;
  const closed = status === "COMPLETED" || status === "CANCELLED";
  // The reminder line reads the same rule as the attention card
  // (lib/domain/tradies/attention.ts), so "follow up" here always has an
  // alert beside it saying why.
  const tone = reminderTone(booking, new Date());
  const reminderDate = booking.reminderSentAt
    ? shortDateFormat.format(new Date(booking.reminderSentAt))
    : "not sent";
  const listItem = (includeQuote: boolean) =>
    toScheduleListItem(project, booking, { includeQuote });

  return (
    <div className="flex flex-col gap-2 rounded-md bg-muted/30 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 flex-col items-start gap-1">
        <button
          type="button"
          className="max-w-full truncate rounded-sm text-left text-xs font-medium text-foreground underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring/50"
          aria-label={`Open booking details for ${name}`}
          onClick={() =>
            dispatch(
              openModal({
                type: "tradieScheduleDetails",
                payload: { schedule: toScheduleDetailsItem(project, booking) },
              }),
            )
          }
        >
          {name} ·{" "}
          <span className="font-mono tabular-nums">
            {dateFormat.format(new Date(booking.scheduledDate))}
          </span>
        </button>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <StatusPill tone={scheduleStatusTone(status)}>
            {scheduleStatusText(status)}
          </StatusPill>
          {booking.billing ? <BillingPill state={booking.billing} /> : null}
          {/* Its tone is a second signal only: "follow up" is always spelled
              out, so colour never carries the meaning alone. */}
          {!closed ? (
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
        </div>
      </div>

      <div className="flex shrink-0 gap-1">
        {/* Declined, completed and removed bookings cannot move: the same rule
            the server applies, so the button is never one that can only fail. */}
        {rescheduleOutcome(status) ? (
          <Button
            variant="outline"
            size="icon"
            aria-label={`Reschedule ${name}`}
            title="Reschedule"
            className={ICON_BUTTON}
            onClick={() =>
              dispatch(
                openModal({
                  type: "rescheduleTradie",
                  payload: { schedule: listItem(true) },
                }),
              )
            }
          >
            <CalendarClock className="size-3.5" aria-hidden="true" />
          </Button>
        ) : null}

        <Button
          variant="outline"
          size="icon"
          aria-label={`Update the status of ${name}`}
          title="Update status"
          className={ICON_BUTTON}
          onClick={() =>
            dispatch(
              openModal({
                type: "confirmStatus",
                payload: { schedule: listItem(false) },
              }),
            )
          }
        >
          <Pencil className="size-3.5" aria-hidden="true" />
        </Button>

        {!closed ? (
          <Button
            variant="outline"
            size="icon"
            aria-label={`Send a reminder to ${name}`}
            title="Send reminder"
            className={ICON_BUTTON}
            disabled={[
              "AWAITING_ADMIN_APPROVAL",
              "DECLINED",
              "CONFIRMED",
            ].includes(status)}
            onClick={() =>
              dispatch(
                openModal({
                  type: "tradieReminder",
                  payload: { schedule: listItem(true) },
                }),
              )
            }
          >
            <Bell className="size-3.5" aria-hidden="true" />
          </Button>
        ) : null}

        <Button
          variant="outline"
          size="icon"
          aria-label={`Log a call with ${name}`}
          title="Log call"
          className={ICON_BUTTON}
          disabled={[
            "CANCELLED",
            "AWAITING_ADMIN_APPROVAL",
            "DECLINED",
            "CONFIRMED",
          ].includes(status)}
          onClick={() =>
            dispatch(
              openModal({
                type: "logCall",
                payload: { schedule: listItem(false) },
              }),
            )
          }
        >
          <Phone className="size-3.5" aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}

function activityState(activity: TradeActivity): {
  tone: "success" | "warning" | "neutral";
  label: string;
  detail: string | null;
} {
  if (activity.milestoneStatus === "DONE") {
    return { detail: null, label: "Done", tone: "success" };
  }
  if (activity.milestoneStatus === "NOT_REQUIRED") {
    return { detail: null, label: "Not required", tone: "neutral" };
  }
  const covering = activity.schedules.find((schedule) =>
    ["CONFIRMED", "PENDING_FINAL_CONFIRMATION", "COMPLETED"].includes(
      schedule.status,
    ),
  );
  if (covering) {
    return {
      detail: `${covering.tradie.name} · ${dateFormat.format(new Date(covering.scheduledDate))}`,
      label: "Booked",
      tone: "success",
    };
  }
  const open = activity.schedules.filter((schedule) =>
    isActiveSchedule(schedule.status),
  );
  if (open.length > 0) {
    const first = [...open].sort(
      (a, b) =>
        new Date(a.scheduledDate).getTime()
        - new Date(b.scheduledDate).getTime(),
    )[0];
    return {
      detail: `Approx. ${dateFormat.format(new Date(first.scheduledDate))}`,
      label: `Requested · ${open.length} ${open.length === 1 ? "tradie" : "tradies"}`,
      tone: "warning",
    };
  }
  return { detail: null, label: "Not requested", tone: "neutral" };
}

/** Who holds the trade, and the way out of it. */
function SelectionBanner({
  overview,
  onCancel,
  onAddPrice,
}: {
  overview: TradeOverview;
  onCancel: () => void;
  /** Booked directly with no price yet: record it. */
  onAddPrice: () => void;
}) {
  const selection = overview.selection;
  if (!selection) return null;
  const tradie = overview.tradies.find(
    (item) => item.tradieId === selection.tradieId,
  );
  const pending = selection.status === "CANCELLATION_PENDING";
  const unpriced =
    tradie !== undefined
    && tradie.quotedTotal === null
    && !tradie.hasQuote
    && tradie.openCount > 0
    && tradie.delivery?.request.kind === "BOOKING";
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-success/40 bg-success-light px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="text-xs font-medium uppercase tracking-wide text-success-ink">
          Selected tradie
        </p>
        <p className="text-sm font-semibold text-foreground">
          {selection.tradie.name}
          {tradie?.quotedTotal != null ? (
            <span className="ml-2 font-mono font-medium">
              {currency.format(tradie.quotedTotal)}
            </span>
          ) : null}
        </p>
        <p className="text-xs text-muted-foreground">
          Assigned to every {overview.trade} activity · selected{" "}
          {dateFormat.format(new Date(selection.selectedAt))}
          {selection.selectedBy ? ` by ${selection.selectedBy.name}` : ""}
        </p>
      </div>
      <div className="flex shrink-0 flex-wrap gap-2">
        {unpriced ? (
          <Button size="sm" className="h-8 text-xs" onClick={onAddPrice}>
            <FilePlus2 className="mr-1.5 size-3.5" aria-hidden="true" />
            Add their price
          </Button>
        ) : null}
        {pending ? (
          <StatusPill tone="warning">Cancellation waiting on admin</StatusPill>
        ) : (
          <Button
            size="sm"
            variant="outline"
            className="h-8 text-xs"
            onClick={onCancel}
          >
            Request cancellation
          </Button>
        )}
      </div>
    </div>
  );
}

export function TradeWorkbench({
  project,
  overview,
  onRequest,
}: {
  project: ProjectDetail;
  overview: TradeOverview;
  /** Opens the request wizard for this trade, on a quote request or a booking. */
  onRequest: (kind?: TradieRequestKind) => void;
}) {
  const { stats, activities, trade, selection } = overview;
  const [selecting, setSelecting] = useState<TradeTradie | null>(null);
  const [cancelling, setCancelling] = useState(false);
  /** Open, and on whom: `null` lets the office choose. */
  const [manualQuote, setManualQuote] = useState<{
    tradieId: string | null;
  } | null>(null);
  /** Whose email thread is open, if anyone's. */
  const [emailsWith, setEmailsWith] = useState<{
    tradieId: string;
    name: string;
  } | null>(null);

  // The selected tradie first; the order otherwise is the quote comparison's.
  const tradies = [...overview.tradies].sort(
    (a, b) => Number(b.selected) - Number(a.selected),
  );
  const quoted = overview.tradies.filter(
    (tradie) => tradie.quotedTotal !== null,
  );
  const lowestId =
    stats.lowest && quoted.length > 1 ? quoted[0].tradieId : null;
  const activityCount = Math.max(stats.activityCount, 1);
  const selectedTradie = overview.tradies.find((tradie) => tradie.selected);

  return (
    <div className="space-y-4">
      <div
        className="grid grid-cols-2 gap-3 lg:grid-cols-4"
        aria-label={`${trade} summary`}
      >
        <Stat
          icon={<Send className="size-4" />}
          label="Tradies asked"
          value={stats.recipients}
          note={stats.recipients === 1 ? "Request sent" : "Requests sent"}
        />
        <Stat
          icon={<Inbox className="size-4" />}
          label="Quotes received"
          value={
            <>
              {stats.replies}
              <span className="ml-1 text-sm font-normal text-muted-foreground">
                / {stats.recipients}
              </span>
            </>
          }
          note={
            stats.recipients === 0
              ? "Nobody asked yet"
              : stats.replies === stats.recipients
                ? "All responses in"
                : `${stats.recipients - stats.replies} still to reply`
          }
        />
        <Stat
          icon={<ArrowDownRight className="size-4" />}
          label="Lowest quote"
          value={
            stats.lowest ? (
              <span className="font-mono text-lg">
                {currency.format(stats.lowest.amount)}
              </span>
            ) : (
              "—"
            )
          }
          note={
            stats.lowest?.name
            ?? (stats.replies > 0 ? "Prices not shown" : "No quotes yet")
          }
        />
        <Stat
          icon={<CalendarCheck2 className="size-4" />}
          label="Activities covered"
          value={
            <>
              {stats.covered}
              <span className="ml-1 text-sm font-normal text-muted-foreground">
                / {stats.activityCount}
              </span>
            </>
          }
          note="Booked or done"
        />
      </div>

      <SelectionBanner
        overview={overview}
        onCancel={() => setCancelling(true)}
        onAddPrice={() =>
          setManualQuote({ tradieId: selection?.tradieId ?? null })
        }
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <section
          aria-labelledby="trade-quotes-heading"
          className="min-w-0 space-y-2"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3
              id="trade-quotes-heading"
              className="text-sm font-semibold text-foreground"
            >
              Compare quotations
            </h3>
            <Button
              size="sm"
              variant="outline"
              className="h-8 text-xs"
              onClick={() => setManualQuote({ tradieId: null })}
            >
              <FilePlus2 className="mr-1.5 size-3.5" aria-hidden="true" />
              Manual quote
            </Button>
          </div>
          {tradies.length === 0 ? (
            <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed px-4 py-8 text-center">
              <p className="text-sm text-muted-foreground">
                No {trade} tradies have been asked yet.
              </p>
              <div className="flex flex-wrap justify-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => onRequest("QUOTE")}
                >
                  <UserPlus className="mr-1.5 size-3.5" aria-hidden="true" />
                  Request {trade} quotes
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => onRequest("BOOKING")}
                >
                  <CalendarCheck2
                    className="mr-1.5 size-3.5"
                    aria-hidden="true"
                  />
                  Book a tradie directly
                </Button>
              </div>
            </div>
          ) : (
            tradies.map((tradie) => (
              <QuoteCard
                key={tradie.tradieId}
                projectId={project.id}
                tradie={tradie}
                activityCount={activityCount}
                lowest={tradie.tradieId === lowestId}
                selectionLive={selection !== null}
                onSelect={() => setSelecting(tradie)}
                // The thread is quotes; hidden where the money is
                // (canSeeProjectFinancials, enforced again by the route).
                onOpenEmails={
                  project.financialsHidden
                    ? null
                    : () =>
                        setEmailsWith({
                          name: tradie.name,
                          tradieId: tradie.tradieId,
                        })
                }
              />
            ))
          )}
        </section>

        <section
          aria-labelledby="trade-activities-heading"
          className="min-w-0 space-y-2"
        >
          <div className="flex items-baseline justify-between gap-2">
            <h3
              id="trade-activities-heading"
              className="text-sm font-semibold text-foreground"
            >
              Activity schedule
            </h3>
            <span className="text-xs text-muted-foreground">
              {activities.length}{" "}
              {activities.length === 1 ? "activity" : "activities"}
            </span>
          </div>
          <ul className="divide-y divide-border/70 rounded-lg border border-border/70 bg-card">
            {activities.length === 0 ? (
              <li className="px-4 py-6 text-center text-sm text-muted-foreground">
                The build sequence names no activities for {trade}.
              </li>
            ) : (
              activities.map((activity) => {
                const state = activityState(activity);
                // Booking actions only once the trade has its tradie: before
                // that an activity can hold several tradies' requests, and the
                // quote cards are where those are compared.
                const booking = selection
                  ? selectedBooking(activity, selection.tradieId)
                  : null;
                return (
                  <li
                    key={activity.milestoneId ?? "general"}
                    className="space-y-2 px-4 py-3"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-foreground">
                          {activity.name}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {activity.stage
                            ? PROJECT_STAGE_LABELS[activity.stage]
                            : "General"}
                        </p>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1">
                        <StatusPill tone={state.tone}>{state.label}</StatusPill>
                        {state.detail && !booking ? (
                          <span className="font-mono text-[11px] text-muted-foreground">
                            {state.detail}
                          </span>
                        ) : null}
                      </div>
                    </div>
                    {booking ? (
                      <SelectedBookingRow project={project} booking={booking} />
                    ) : null}
                  </li>
                );
              })
            )}
          </ul>
        </section>
      </div>

      <SelectQuoteDialog
        projectId={project.id}
        trade={trade}
        tradie={selecting}
        onOpenChange={(open) => {
          if (!open) setSelecting(null);
        }}
      />
      <CancelSelectionDialog
        projectId={project.id}
        selection={cancelling ? selection : null}
        openBookings={selectedTradie?.openCount ?? 0}
        onOpenChange={setCancelling}
      />
      <ManualQuoteDialog
        open={manualQuote !== null}
        onOpenChange={(open) => {
          if (!open) setManualQuote(null);
        }}
        initialTradieId={manualQuote?.tradieId ?? null}
        project={project}
        trade={trade}
      />
      <TradieEmailThreadModal
        projectId={project.id}
        tradie={emailsWith}
        onClose={() => setEmailsWith(null)}
      />
    </div>
  );
}

/** "All trades": one row per trade, to choose where to look. */
export function TradeList({
  overviews,
  onSelect,
}: {
  overviews: readonly TradeOverview[];
  onSelect: (trade: string) => void;
}) {
  if (overviews.length === 0) return null;
  return (
    <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
      {overviews.map(({ trade, stats, selection }) => (
        <li key={trade}>
          <button
            type="button"
            onClick={() => onSelect(trade)}
            className="flex w-full items-center gap-3 rounded-lg border border-border/70 bg-card px-3 py-3 text-left transition-colors hover:bg-muted/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring/50"
          >
            <span
              aria-hidden="true"
              className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground"
            >
              <TradeIcon trade={trade} className="size-4" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold text-foreground">
                {trade}
              </span>
              <span className="block truncate text-xs text-muted-foreground">
                {selection
                  ? `${selection.tradie.name} selected`
                  : stats.recipients === 0
                    ? "Nobody asked yet"
                    : `${stats.replies}/${stats.recipients} quoted`}
                {" · "}
                {stats.covered}/{stats.activityCount} activities covered
              </span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
