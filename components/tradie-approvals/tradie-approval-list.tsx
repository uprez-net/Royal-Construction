import { useAppDispatch, useAppSelector } from "@/lib/store/hooks";
import { ApprovalCard } from "./tradie-approval-card";
import {
  ApprovalInput,
  SafeTradieApproval,
  ScheduleApprovalJsonPayload,
  ScheduleDeletionJsonPayload,
} from "@/types/tradie";
import { dateFormat } from "@/utils/formatters";
import {
  approveRequests,
  selectApproval,
} from "@/lib/store/slices/tradieApprovalSlice";
import { toast } from "sonner";
import { useState } from "react";
import { RefreshCw, UserCheck } from "lucide-react";
import { openModal } from "@/lib/store/slices/uiSlice";

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
  }
};

/** Only the schedule-shaped requests carry a project; the card footer stays
 *  empty for the rest, as it did before. */
const approvalProjectName = (approval: SafeTradieApproval) => {
  switch (approval.actionType) {
    case "SCHEDULE_APPROVAL":
    case "SCHEDULE_DELETION":
      return (
        approval.updationData as
          | ScheduleApprovalJsonPayload
          | ScheduleDeletionJsonPayload
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

export function TradieApprovalList() {
  const dispatch = useAppDispatch();
  const [processingRequestIds, setProcessingRequestIds] = useState<Set<string>>(
    new Set(),
  );
  const { approvals, activeTab, selectedApprovalIds, loading, error } =
    useAppSelector((state) => state.tradieApproval);

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

      await dispatch(approveRequests([approvalInput])).unwrap();
      toast.success("Approval request approved successfully");
    } catch (error) {
      console.error("Error creating approval input:", error);
      toast.error(
        error instanceof Error ? error.message : "An unexpected error occurred",
      );
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

  if (loading) {
    <div className="flex flex-col items-center justify-center gap-3 h-60 bg-white rounded-sm">
      <div className="flex size-12 items-center justify-center">
        <RefreshCw className="animate-spin size-5 text-muted-foreground" />
      </div>

      <div className="space-y-1">
        <p className="text-sm font-semibold text-foreground">
          Loading approvals...
        </p>

        <p className="text-xs text-muted-foreground">
          Your approvals will appear here.
        </p>
      </div>
    </div>;
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-16 text-muted-foreground">
        <p className="text-sm">{error}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4" key={`${approvals.length}-${activeTab}`}>
      {approvals.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 h-60 bg-white rounded-sm">
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
      ) : (
        approvals.map((approval) => (
          <ApprovalCard
            key={approval.id}
            type={approval.actionType}
            title={createApprovalTitle(approval)}
            description={createApprovalDescription(approval)}
            status={approval.status}
            severity={calculateSeverity(approval)}
            severityLabel={
              calculateSeverity(approval) === "HIGH"
                ? "High"
                : calculateSeverity(approval) === "MEDIUM"
                  ? "Medium"
                  : "Low"
            }
            projectName={approvalProjectName(approval)}
            requestedBy={approval.requestBy}
            createdAt={dateFormat.format(approval.createdAt)}
            selected={selectedApprovalIds.includes(approval.id)}
            disabled={processingRequestIds.has(approval.id)}
            onSelect={() => handleSelectApproval(approval.id)}
            onApprove={() => handleApprove(approval.id)}
            onReject={() => handleReject(approval.id)}
            onClick={() => handleClick(approval.id)}
          />
        ))
      )}
    </div>
  );
}
