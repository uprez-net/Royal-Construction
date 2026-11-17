import { useAppDispatch, useAppSelector } from "@/lib/store/hooks";
import {
  ApprovalInput,
  SafeTradieApproval,
  ScheduleApprovalJsonPayload,
  ScheduleDeletionJsonPayload,
  TradeCancellationJsonPayload,
} from "@/types/tradie";
import { dateFormat } from "@/utils/formatters";
import {
  approvalErrorMessage,
  approvalOutcomeMessage,
  approveRequests,
  selectApproval,
} from "@/lib/store/slices/tradieApprovalSlice";
import { toast } from "sonner";
import { useState } from "react";
import { Check, Loader2, MoreVertical, UserCheck, X } from "lucide-react";
import { openModal } from "@/lib/store/slices/uiSlice";
import { TradieApprovalStatus, TradieApprovalActionType } from "@prisma/client";
import { DataTable } from "@/components/common/data-table";
import { StatusPill } from "@/components/common/status-pill";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

const approvalTypeLabel: Record<TradieApprovalActionType, string> = {
  PRICE_CHANGE: "Price Change",
  INCIDENT_RESOLUTION: "Incident",
  TRADIE_REMOVAL: "Deletion",
  SCHEDULE_APPROVAL: "Scheduling",
  SCHEDULE_DELETION: "Schedule Removal",
  TRADE_CANCELLATION: "Trade Cancellation",
};

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
      const data = approval.updationData as ScheduleDeletionJsonPayload;
      return `Removal of ${approval.tradie.name}'s booking on ${data?.scheduledDate ?? "an unrecorded date"} has been requested. ${approval.reason}`;
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

const handlePayload = (approval: SafeTradieApproval, resolution: string) => {
  switch (approval.actionType) {
    case "PRICE_CHANGE":
      return {
        newHourlyRate: (approval.updationData as { newHourlyRate: number })
          .newHourlyRate,
      };
    case "INCIDENT_RESOLUTION":
      return {
        resolution,
      };
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
  "end",
] as const;

/**
 * The row's actions. The card's Approve, Reject and View buttons are the same
 * three items here, calling the same handlers. The spinner that the card showed
 * on its Approve button now shows on the trigger while the row is processing.
 */
function ApprovalRowMenu({
  title,
  pending,
  processing,
  onView,
  onApprove,
  onReject,
}: {
  title: string;
  pending: boolean;
  processing: boolean;
  onView: () => void;
  onApprove: () => void;
  onReject: () => void;
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
          {processing ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <MoreVertical className="h-4 w-4" />
          )}
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuItem onClick={onView} className="min-h-11 md:min-h-0">
          View request
        </DropdownMenuItem>

        {pending && (
          <>
            <DropdownMenuItem
              onClick={onApprove}
              disabled={processing}
              className="min-h-11 md:min-h-0"
            >
              <Check />
              Approve
            </DropdownMenuItem>

            <DropdownMenuSeparator />

            <DropdownMenuItem
              variant="destructive"
              onClick={onReject}
              className="min-h-11 md:min-h-0"
            >
              <X />
              Reject
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function TradieApprovalList() {
  const dispatch = useAppDispatch();
  const [processingRequestIds, setProcessingRequestIds] = useState<Set<string>>(
    new Set(),
  );
  const { approvals, selectedApprovalIds, loading, error } = useAppSelector(
    (state) => state.tradieApproval,
  );

  const handleSelectApproval = (approvalId: string) => {
    dispatch(selectApproval(approvalId));
  };

  const handleApprove = async (approvalId: string) => {
    setProcessingRequestIds((prev) => new Set(prev).add(approvalId));
    try {
      const approval = approvals.find((a) => a.id === approvalId);
      if (!approval) {
        throw new Error(
          "This approval request is no longer available. Refresh and try again.",
        );
      }
      const approvalInput = {
        approvalId: approval.id,
        resolution: "approved",
        type: approval.actionType,
        payload: handlePayload(approval, "approved"),
      } satisfies ApprovalInput;

      const result = await dispatch(approveRequests([approvalInput])).unwrap();
      const message = approvalOutcomeMessage(result, "approved");
      if (message.success) toast.success(message.success);
      if (message.failure) toast.error(message.failure);
    } catch (error) {
      console.error("Approval failed:", error);
      toast.error(approvalErrorMessage(error));
    } finally {
      setProcessingRequestIds((prev) => {
        const newSet = new Set(prev);
        newSet.delete(approvalId);
        return newSet;
      });
    }
  };

  const handleReject = (approvalId: string) => {
    try {
      const approval = approvals.find((a) => a.id === approvalId);
      if (!approval) {
        throw new Error(
          "This approval request is no longer available. Refresh and try again.",
        );
      }
      dispatch(
        openModal({
          type: "rejectTradieApprovals",
          payload: {
            approvals: [approval],
          },
        }),
      );
    } catch (error) {
      console.error("Error creating approval input:", error);
      toast.error(
        error instanceof Error ? error.message : "An unexpected error occurred",
      );
    }
  };

  const handleClick = (approvalId: string) => {
    const approval = approvals.find((a) => a.id === approvalId);
    if (!approval) {
      toast.error(
        "This approval request is no longer available. Refresh and try again.",
      );
      return;
    }
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
        mobileActionsPlacement="header"
        align={[...ALIGN]}
        caption="Tradie approval requests, newest first."
        headers={[
          "",
          "Type",
          "Tradie and trade",
          "Project",
          "Request",
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
          const processing = processingRequestIds.has(approval.id);
          const selected = selectedApprovalIds.includes(approval.id);
          const status = statusPill[approval.status];

          return [
            // Stops the row's click from opening the request: the box and the
            // menu are controls of their own.
            <label
              key="select"
              className="grid size-11 shrink-0 place-items-center sm:size-6"
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

            // Stops the row's click from opening the request: the menu and its
            // portalled items bubble through the row in React.
            <div
              key="actions"
              className="flex justify-end"
              onClick={(event) => event.stopPropagation()}
            >
              <ApprovalRowMenu
                title={title}
                pending={pending}
                processing={processing}
                onView={() => handleClick(approval.id)}
                onApprove={() => handleApprove(approval.id)}
                onReject={() => handleReject(approval.id)}
              />
            </div>,
          ];
        })}
        rowLabel={(index) => `Open ${createApprovalTitle(approvals[index])}`}
        rowClassName={(index) => {
          const approval = approvals[index];
          return cn(
            selectedApprovalIds.includes(approval.id) && "bg-royal-gold/10",
            processingRequestIds.has(approval.id) && "opacity-50",
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
                No approvals found
              </p>

              <p className="text-xs text-muted-foreground">
                Your approvals will appear here.
              </p>
            </div>
          </div>
        }
      />
    </div>
  );
}
