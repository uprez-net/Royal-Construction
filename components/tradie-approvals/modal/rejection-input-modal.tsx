"use client";

import {
  ApprovalInput,
  IncidentReportJsonPayload,
  PriceUpdateJsonPayload,
  SafeTradieApproval,
  ScheduleApprovalJsonPayload,
  ScheduleDeletionJsonPayload,
} from "@/types/tradie";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";

import { useAppDispatch } from "@/lib/store/hooks";
import { approveRequests } from "@/lib/store/slices/tradieApprovalSlice";

import {
  AlertTriangle,
  Hammer,
  Loader2,
  User,
  X,
} from "lucide-react";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { formatQuotedPrice } from "@/utils/calculations";
import { rateCurrency } from "@/utils/formatters";

interface TradieApprovalRejectionModalProps {
  open: boolean;
  approvals: SafeTradieApproval[];
  onClose: () => void;
}

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

function ApprovalDetails({ approval }: { approval: SafeTradieApproval }) {
  switch (approval.actionType) {
    case "PRICE_CHANGE": {
      const data = approval.updationData as PriceUpdateJsonPayload;
      return (
        <p>
          New price requested:
          <strong>
            {" "}
            {data?.newHourlyRate != null
              ? formatQuotedPrice(
                  data.newHourlyRate,
                  // Requests raised before the basis was captured are hourly by
                  // definition — that was the only behaviour at the time.
                  data.newPriceUnit ?? "HOURLY",
                  rateCurrency.format,
                )
              : "—"}
          </strong>
        </p>
      );
    }

    case "SCHEDULE_APPROVAL": {
      const data = approval.updationData as ScheduleApprovalJsonPayload;
      return (
        <div className="space-y-1 text-sm">
          <p>Project: {data?.projectName}</p>
          <p>Milestone: {data?.milestoneName}</p>
          <p>Duration: {data?.durationDays} days</p>
          <p>Cost: {data?.cost}</p>
        </div>
      );
    }
    case "SCHEDULE_DELETION": {
      const data = approval.updationData as ScheduleDeletionJsonPayload;
      return (
        <div className="space-y-1 text-sm">
          <p>Project: {data?.projectName}</p>
          <p>Milestone: {data?.milestoneName}</p>
          <p>Booked for: {data?.scheduledDate}</p>
          <p>Duration: {data?.durationDays} days</p>
          <p>Cost: {data?.cost}</p>
          <p className="text-muted-foreground">
            Rejecting leaves this booking in place.
          </p>
        </div>
      );
    }

    case "INCIDENT_RESOLUTION": {
      const data = approval.updationData as IncidentReportJsonPayload;
      return (
        <div className="space-y-1 text-sm">
          <p>Type: {data?.incidentType}</p>

          <p>Severity: {data?.incidentSeverity}</p>

          <p>{data?.incidentDescription}</p>
        </div>
      );
    }

    default:
      return (
        <p className="text-sm text-muted-foreground">Tradie removal request</p>
      );
  }
}

export function TradieApprovalRejectionModal({
  open,
  approvals,
  onClose,
}: TradieApprovalRejectionModalProps) {
  const dispatch = useAppDispatch();

  const [reason, setReason] = useState("");
  const [isPending, startTransition] = useTransition();

  const handleClose = () => {
    setReason("");
    onClose();
  };

  const handleReject = async () => {
    try {
      if (!reason.trim()) {
        toast.error("Please provide rejection reason");
        return;
      }

      const approvalInputs = approvals.map((approval) => ({
        approvalId: approval.id,
        resolution: "rejected",
        type: approval.actionType,
        payload: handlePayload(approval, "rejected"),
        rejectReason: reason,
      })) satisfies ApprovalInput[];

      await dispatch(approveRequests(approvalInputs)).unwrap();

      toast.success(`${approvals.length} approval request(s) rejected`);

      handleClose();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to reject approvals",
      );
    }
  };

  return (
    <Dialog open={open} onOpenChange={(value) => !value && handleClose()}>
      <DialogContent className="max-w-3xl p-0">
        <DialogHeader className="border-b px-6 py-4">
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5" />
            Reject Approval Requests
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 px-6 py-4">
          <ScrollArea className="max-h-100 pr-3">
            <div className="space-y-3">
              {approvals.map((approval) => (
                <Card key={approval.id}>
                  <CardHeader className="pb-2">
                    <CardTitle className="flex justify-between text-sm">
                      <span className="flex items-center gap-2">
                        <Hammer className="h-4 w-4" />

                        {approval.tradie.name}
                      </span>

                      <Badge variant="secondary">
                        {approval.actionType.replace("_", " ")}
                      </Badge>
                    </CardTitle>
                  </CardHeader>

                  <CardContent className="space-y-3 text-sm">
                    <div className="grid grid-cols-2 gap-2 text-muted-foreground">
                      <span className="flex gap-2">
                        <User className="h-4 w-4" />

                        {approval.tradie.trade}
                      </span>

                      <span>Requested by: {approval.requestBy}</span>
                    </div>

                    <ApprovalDetails approval={approval} />
                  </CardContent>
                </Card>
              ))}
            </div>
          </ScrollArea>

          <div className="space-y-2">
            <label className="text-sm font-medium">Rejection reason</label>

            <Textarea
              placeholder="Explain why these approvals are being rejected..."
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={4}
            />
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t bg-muted px-6 py-4">
          <Button variant="outline" onClick={handleClose}>
            Cancel
          </Button>

          <Button
            variant="destructive"
            disabled={isPending || !reason.trim()}
            onClick={() => startTransition(handleReject)}
          >
            {isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Rejecting...
              </>
            ) : (
              <>
                <X className="mr-2 h-4 w-4" />
                Reject {approvals.length}
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
