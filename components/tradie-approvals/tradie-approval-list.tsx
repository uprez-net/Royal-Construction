import { useAppDispatch, useAppSelector } from "@/lib/store/hooks";
import {
  SafeTradieApproval,
  ScheduleApprovalJsonPayload,
  ScheduleDeletionJsonPayload,
  TradeCancellationJsonPayload,
} from "@/types/tradie";
import { dateFormat } from "@/utils/formatters";
import {
  approvalDayLabel,
  approvalTypeLabel,
  needsReviewWindow,
  selectApproval,
  selectApprovals,
} from "@/lib/store/slices/tradieApprovalSlice";
import { Check, Loader2, MoreVertical, UserCheck, X } from "lucide-react";
import { openModal } from "@/lib/store/slices/uiSlice";
import { TradieApprovalStatus } from "@prisma/client";
import { DataTable } from "@/components/common/data-table";
import { StatusPill } from "@/components/common/status-pill";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

const statusPill: Record<
  TradieApprovalStatus,
  { tone: "warning" | "success" | "danger"; label: string }
> = {
  PENDING: { tone: "warning", label: "Pending" },
  APPROVED: { tone: "success", label: "Approved" },
  REJECTED: { tone: "danger", label: "Rejected" },
};

const createApprovalTitle = (approval: SafeTradieApproval) => {
  switch (approval.actionType) {
    case "PRICE_CHANGE":
      return `Price Change Request for ${approval.tradie.name}`;
    case "INCIDENT_RESOLUTION":
      return `Incident Reported for ${approval.tradie.name}`;
    case "TRADIE_REMOVAL":
      return `Deletion Request for ${approval.tradie.name}`;
    case "SCHEDULE_APPROVAL":
      return `Schedule Approval for ${approval.tradie.name}`;
    case "SCHEDULE_DELETION":
      return `Schedule Removal for ${approval.tradie.name}`;
    case "TRADE_CANCELLATION": {
      const data = approval.updationData as TradeCancellationJsonPayload;
      return `Release ${approval.tradie.name} from ${data?.trade ?? approval.tradie.trade}`;
    }
  }
};

const createApprovalDescription = (approval: SafeTradieApproval) => {
  switch (approval.actionType) {
    case "PRICE_CHANGE":
      return `The tradie ${approval.tradie.name} has requested a price change. ${approval.reason}`;
    case "INCIDENT_RESOLUTION":
      return `An incident has been reported for ${approval.tradie.name}. ${approval.reason}`;
    case "TRADIE_REMOVAL":
      return `A deletion request has been submitted for ${approval.tradie.name}. ${approval.reason}`;
    case "SCHEDULE_APPROVAL":
      return `A schedule approval request has been submitted for ${approval.tradie.name}. ${approval.reason}`;
    case "SCHEDULE_DELETION": {
      return `Removal of ${approval.tradie.name}'s booking on ${approval.dueKind === "booking" ? approvalDayLabel(approval.decisionDue) : "an unrecorded date"} has been requested. ${approval.reason}`;
    }
    case "TRADE_CANCELLATION": {
      const data = approval.updationData as TradeCancellationJsonPayload;
      const count = data?.openBookings;
      const bookings =
        typeof count !== "number"
          ? "open bookings"
          : `${count} open ${count === 1 ? "booking" : "bookings"}`;
      return `Approving cancels ${approval.tradie.name}'s ${bookings} on ${data?.projectName ?? "the project"}. ${approval.reason}`;
    }
  }
};

const calculateSeverity = (approval: SafeTradieApproval) => {
  switch (approval.actionType) {
    case "PRICE_CHANGE":
      return "MEDIUM";
    case "INCIDENT_RESOLUTION":
      return "HIGH";
    case "TRADIE_REMOVAL":
      return "MEDIUM";
    case "SCHEDULE_APPROVAL":
      return "HIGH";
    // Approving this deletes a booking a tradie has already been told about.
    case "SCHEDULE_DELETION":
      return "HIGH";
    // Approving this cancels every booking the tradie holds on the project.
    case "TRADE_CANCELLATION":
      return "HIGH";
  }
};

const severityLabel = (severity: ReturnType<typeof calculateSeverity>) =>
  severity === "HIGH" ? "High" : severity === "MEDIUM" ? "Medium" : "Low";

/** Only the schedule-shaped requests carry a project; the cell stays empty for the rest. */
const approvalProjectName = (approval: SafeTradieApproval) => {
  switch (approval.actionType) {
    case "SCHEDULE_APPROVAL":
    case "SCHEDULE_DELETION":
    case "TRADE_CANCELLATION":
      return (
        approval.updationData as
          | ScheduleApprovalJsonPayload
          | ScheduleDeletionJsonPayload
          | TradeCancellationJsonPayload
      )?.projectName;
    default:
      return undefined;
  }
};

const ALIGN = [
  "start",
  "start",
  "start",
  "start",
  "start",
  "start",
  "start",
  "start",
  "end",
] as const;

/** The row's menu. Approve and Reject are inline; the menu keeps View request. */
function ApprovalRowMenu({
  title,
  onView,
}: {
  title: string;
  onView: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="size-11 md:size-8"
          aria-label={`Actions for ${title}`}
        >
          <MoreVertical className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuItem onClick={onView} className="min-h-11 md:min-h-0">
          View request
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const headerCheckbox = "grid size-11 shrink-0 place-items-center sm:size-6";

export function TradieApprovalList({
  processingIds,
  onApprove,
}: {
  processingIds: ReadonlySet<string>;
  onApprove: (rows: SafeTradieApproval[]) => Promise<void>;
}) {
  const dispatch = useAppDispatch();
  const { approvals, selectedApprovalIds, loading, error, query } =
    useAppSelector((state) => state.tradieApproval);
  const decided = query.view === "decided";

  // Select-all covers the pending rows on this page; decided rows cannot be
  // selected, so they are left out of the count and the box.
  const pendingOnPage = approvals.filter(
    (approval) => approval.status === TradieApprovalStatus.PENDING,
  );
  const selectedOnPage = pendingOnPage.filter((approval) =>
    selectedApprovalIds.includes(approval.id),
  ).length;
  const allOnPageSelected =
    pendingOnPage.length > 0 && selectedOnPage === pendingOnPage.length;

  const handleSelectApproval = (approvalId: string) => {
    dispatch(selectApproval(approvalId));
  };

  const handleReject = (approvalId: string) => {
    const approval = approvals.find((a) => a.id === approvalId);
    if (!approval) return;
    dispatch(
      openModal({
        type: "rejectTradieApprovals",
        payload: {
          approvals: [approval],
        },
      }),
    );
  };

  const handleClick = (approvalId: string) => {
    const approval = approvals.find((a) => a.id === approvalId);
    if (!approval) return;
    dispatch(
      openModal({
        type: "adminApproval",
        payload: {
          approvalId: approval.id,
          approvalType: approval.actionType,
        },
      }),
    );
  };

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-16 text-muted-foreground">
        <p className="text-sm">{error}</p>
      </div>
    );
  }

  return (
    // The table sits in the list's one TableCard, so it is flush. Phones keep
    // their padding around the cards, as the trade types table does.
    <div className="p-4 sm:p-5 md:p-0">
      <DataTable
        flush
        loading={loading}
        loadingLabel="Loading approvals"
        mobileLayout="cards"
        mobileTitleColumn={2}
        mobileWideColumns={[4]}
        mobileActionsPlacement="footer"
        align={[...ALIGN]}
        caption={
          decided
            ? "Decided tradie approval requests, most recent first."
            : "Tradie approval requests waiting for a decision, oldest due first."
        }
        headers={[
          // The header box has no text, so the phone card does not read it
          // as a field.
          <label key="select-all" className={headerCheckbox}>
            <input
              type="checkbox"
              aria-label="Select all pending on this page"
              checked={allOnPageSelected}
              disabled={pendingOnPage.length === 0}
              ref={(input) => {
                if (input)
                  input.indeterminate =
                    selectedOnPage > 0 && !allOnPageSelected;
              }}
              onChange={() =>
                dispatch(
                  selectApprovals({
                    ids: pendingOnPage.map((approval) => approval.id),
                    selected: !allOnPageSelected,
                  }),
                )
              }
              className="size-5"
            />
          </label>,
          "Type",
          "Tradie and trade",
          "Project",
          "Request",
          "Due",
          "Submitted",
          "Status",
          <span key="actions" className="sr-only">
            Actions
          </span>,
        ]}
        rows={approvals.map((approval) => {
          const title = createApprovalTitle(approval);
          const severity = calculateSeverity(approval);
          const pending = approval.status === TradieApprovalStatus.PENDING;
          const processing = processingIds.has(approval.id);
          const selected = selectedApprovalIds.includes(approval.id);
          const status = statusPill[approval.status];

          return [
            // Stops the row's click from opening the request: the box and the
            // menu are controls of their own.
            <label
              key="select"
              className={headerCheckbox}
              onClick={(event) => event.stopPropagation()}
            >
              <input
                type="checkbox"
                aria-label={`Select ${title}`}
                checked={selected}
                disabled={processing || !pending}
                onChange={() => handleSelectApproval(approval.id)}
                className="size-5"
              />
            </label>,

            <div key="type">
              <div className="font-medium">
                {approvalTypeLabel[approval.actionType]}
              </div>
              <div className="text-xs text-muted-foreground">
                {severityLabel(severity)} priority
              </div>
            </div>,

            <div key="tradie" className="min-w-0">
              <div className="font-medium [overflow-wrap:anywhere]">
                {approval.tradie.name}
              </div>
              {approval.tradie.trade ? (
                <div className="text-xs text-muted-foreground">
                  {approval.tradie.trade}
                </div>
              ) : null}
            </div>,

            <span key="project" className="[overflow-wrap:anywhere]">
              {approvalProjectName(approval) ?? "—"}
            </span>,

            <div key="request" className="min-w-0 max-w-xl">
              <div className="font-medium">{title}</div>
              <p className="mt-0.5 text-xs text-muted-foreground [overflow-wrap:anywhere]">
                {createApprovalDescription(approval)}
              </p>
            </div>,

            // A decided request has no due date any more; it shows a dash.
            <div key="due" className="flex flex-wrap items-center gap-1.5">
              {pending ? (
                <>
                  <span className="tabular-nums">
                    {approval.dueKind === "booking" ? "Booking" : "Submitted"}{" "}
                    {approvalDayLabel(approval.decisionDue)}
                  </span>
                  {approval.overdue ? (
                    <StatusPill tone="danger">Overdue</StatusPill>
                  ) : null}
                </>
              ) : (
                "—"
              )}
            </div>,

            <div key="submitted">
              <div className="tabular-nums">
                {dateFormat.format(approval.createdAt)}
              </div>
              <div className="text-xs text-muted-foreground">
                {approval.requestBy}
              </div>
            </div>,

            <StatusPill key="status" tone={status.tone}>
              {status.label}
            </StatusPill>,

            // Stops the row's click from opening the request: the buttons and
            // the menu are controls of their own.
            <div
              key="actions"
              className="flex items-center justify-end gap-1.5"
              onClick={(event) => event.stopPropagation()}
            >
              {pending && (
                <>
                  <Button
                    size="sm"
                    className="min-h-11 md:min-h-0"
                    disabled={processing}
                    onClick={() => void onApprove([approval])}
                  >
                    {processing ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Check className="h-4 w-4" />
                    )}
                    {needsReviewWindow(approval) ? "Review" : "Approve"}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="min-h-11 md:min-h-0"
                    disabled={processing}
                    onClick={() => handleReject(approval.id)}
                  >
                    <X className="h-4 w-4" />
                    Reject
                  </Button>
                </>
              )}
              <ApprovalRowMenu
                title={title}
                onView={() => handleClick(approval.id)}
              />
            </div>,
          ];
        })}
        rowLabel={(index) => `Open ${createApprovalTitle(approvals[index])}`}
        rowClassName={(index) => {
          const approval = approvals[index];
          return cn(
            selectedApprovalIds.includes(approval.id) && "bg-royal-gold/10",
            processingIds.has(approval.id) && "opacity-50",
          );
        }}
        onRowClick={(index) => handleClick(approvals[index].id)}
        emptyState={
          <div className="flex h-60 flex-col items-center justify-center gap-3">
            <div className="flex size-12 items-center justify-center">
              <UserCheck className="size-5 text-muted-foreground" />
            </div>

            <div className="space-y-1">
              <p className="text-sm font-semibold text-foreground">
                {decided ? "Nothing decided yet" : "Nothing waiting"}
              </p>

              <p className="text-xs text-muted-foreground">
                {decided
                  ? "Approved and rejected requests appear here."
                  : "New requests from the team appear here."}
              </p>
            </div>
          </div>
        }
      />
    </div>
  );
}
