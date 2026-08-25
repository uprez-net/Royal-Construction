import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { fetchTradieApprovalById } from "@/lib/data/tradie-approvals";
import { SafeTradieApproval } from "@/types/tradie";
import { TradieApprovalActionType } from "@prisma/client";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { PriceChangeApprovalForm } from "./forms/PriceChangeApprovalForm";
import { TradieRemovalApprovalForm } from "./forms/TradieRemovalApprovalForm";
import { IncidentResolutionApprovalForm } from "./forms/IncidentResolutionApprovalForm";
import { ScheduleApprovalForm } from "./forms/ScheduleApprovalForm";
import { ScheduleDeletionApprovalForm } from "./forms/ScheduleDeletionApprovalForm";

interface AdminApprovalActionModalProps {
  open: boolean;
  approvalId: string;
  approvalType: TradieApprovalActionType;
  onClose: () => void;
}

export function AdminApprovalActionModal({
  open,
  approvalId,
  approvalType,
  onClose,
}: AdminApprovalActionModalProps) {
  const { data, isLoading, isError, error, refetch, isFetching } =
    useQuery<SafeTradieApproval>({
      queryKey: ["approval", approvalId],
      queryFn: () => fetchTradieApprovalById(approvalId),
      enabled: open && !!approvalId,
    });

  const handleOpenChange = (isOpen: boolean) => {
    if (!isOpen) {
      onClose();
    }
  };

  const renderForm = () => {
    if (!data) return null;

    // The fetched record is authoritative. `approvalType` — what the caller
    // believed it was opening — is only a fallback for records that carry no
    // `actionType`.
    const actionType = data.actionType ?? approvalType;

    switch (actionType) {
      case TradieApprovalActionType.PRICE_CHANGE:
        return <PriceChangeApprovalForm approval={data} onSuccess={onClose} />;

      case TradieApprovalActionType.TRADIE_REMOVAL:
        return (
          <TradieRemovalApprovalForm approval={data} onSuccess={onClose} />
        );

      case TradieApprovalActionType.INCIDENT_RESOLUTION:
        return (
          <IncidentResolutionApprovalForm approval={data} onSuccess={onClose} />
        );

      case TradieApprovalActionType.SCHEDULE_APPROVAL:
        return <ScheduleApprovalForm approval={data} onSuccess={onClose} />;

      case TradieApprovalActionType.SCHEDULE_DELETION:
        return (
          <ScheduleDeletionApprovalForm approval={data} onSuccess={onClose} />
        );

      default:
        return (
          <div className="space-y-2">
            <DialogTitle>Unsupported approval type</DialogTitle>
            <DialogDescription>
              This request type has no review form yet. Ask an administrator to
              action it directly.
            </DialogDescription>
          </div>
        );
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[70vh] w-full max-w-2xl overflow-y-auto no-scrollbar">
        {isLoading ? (
          <div
            className="flex h-40 items-center justify-center"
            aria-busy="true"
          >
            <DialogTitle className="sr-only">Loading request</DialogTitle>
            <DialogDescription className="sr-only">
              Please wait while the approval request loads.
            </DialogDescription>
            <Loader2 className="size-6 animate-spin" aria-hidden="true" />
          </div>
        ) : isError ? (
          <div className="space-y-3 p-4">
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="size-5" aria-hidden="true" />
              Unable to load this request
            </DialogTitle>

            <DialogDescription>
              The approval request could not be retrieved. It may have already
              been actioned.
            </DialogDescription>

            {/* `error` is nullable even inside the isError branch, and a thrown
                value can carry an empty message — neither should render as
                "undefined" or as a blank line under the description. */}
            <p className="text-xs text-muted-foreground">
              {error?.message?.trim()
                ? error.message
                : "No further detail was returned."}
            </p>

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={onClose}>
                Close
              </Button>

              <Button onClick={() => refetch()} disabled={isFetching}>
                <RefreshCw
                  className={cn("mr-2 size-4", isFetching && "animate-spin")}
                  aria-hidden="true"
                />
                Try again
              </Button>
            </div>
          </div>
        ) : (
          renderForm()
        )}
      </DialogContent>
    </Dialog>
  );
}
