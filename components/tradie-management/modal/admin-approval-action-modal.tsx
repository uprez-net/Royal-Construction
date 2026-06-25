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
import { Loader2 } from "lucide-react";
import { PriceChangeApprovalForm } from "./forms/PriceChangeApprovalForm";
import { TradieRemovalApprovalForm } from "./forms/TradieRemovalApprovalForm";
import { IncidentResolutionApprovalForm } from "./forms/IncidentResolutionApprovalForm";

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
  const { data, isLoading, isError, error } = useQuery<SafeTradieApproval>({
    queryKey: ["approval", approvalId],
    queryFn: () => fetchTradieApprovalById(approvalId),
    enabled: open && !!approvalId,
  });

  console.log("approvalType", approvalType);

  const handleOpenChange = (isOpen: boolean) => {
    if (!isOpen) {
      onClose();
    }
  };

  const renderForm = () => {
    if (!data) return null;

    switch (data.actionType) {
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

      default:
        return null;
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[70vh] w-full max-w-2xl overflow-y-auto no-scrollbar">
        {isLoading ? (
          <div className="flex h-40 items-center justify-center">
            <DialogTitle className="sr-only">Loading Form...</DialogTitle>
            <DialogDescription className="sr-only">
              Please wait while the form is loading.
            </DialogDescription>
            <Loader2 className="size-6 animate-spin" />
          </div>
        ) : isError ? (
          <div className="space-y-2 p-4">
            <DialogTitle>Unable to load approval</DialogTitle>
            <DialogDescription>{error.message}</DialogDescription>
          </div>
        ) : (
          renderForm()
        )}
      </DialogContent>
    </Dialog>
  );
}
