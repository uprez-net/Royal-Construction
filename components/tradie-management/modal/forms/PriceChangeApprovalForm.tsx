"use client";

import { DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { TradieApprovalActionType } from "@prisma/client";
import { SafeTradieApproval } from "@/types/tradie";
import { useApprovalMutation } from "@/hooks/use-approval-mutation";


interface Props {
  approval: SafeTradieApproval;
  onSuccess: () => void;
}

export function PriceChangeApprovalForm({ approval, onSuccess }: Props) {
  const mutation = useApprovalMutation(onSuccess);

  const data = approval.updationData as {
    currentHourlyRate: number;
    newHourlyRate: number;
    reason?: string;
  };

  const submit = (resolution: "approved" | "rejected") => {
    mutation.mutate({
      approvalId: approval.id,
      type: TradieApprovalActionType.PRICE_CHANGE,
      resolution,
      payload: {
        newHourlyRate: data.newHourlyRate,
      },
    });
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>Approve Price Change</DialogTitle>
      </DialogHeader>

      <div className="space-y-4">
        <div>
          <p>Tradie</p>
          <p className="font-medium">{approval.tradie.name}</p>
        </div>

        <Separator />

        <div className="grid grid-cols-2 gap-4">
          <div>
            <p>Current Rate</p>
            <p className="font-medium">${data.currentHourlyRate}</p>
          </div>

          <div>
            <p>Requested Rate</p>
            <p className="font-medium">${data.newHourlyRate}</p>
          </div>
        </div>

        {data.reason && (
          <div>
            <p>Reason</p>
            <p>{data.reason}</p>
          </div>
        )}

        <div className="flex justify-end gap-2">
          <Button
            variant="outline"
            onClick={() => submit("rejected")}
            disabled={mutation.isPending}
          >
            Reject
          </Button>

          <Button
            onClick={() => submit("approved")}
            disabled={mutation.isPending}
          >
            Approve
          </Button>
        </div>
      </div>
    </>
  );
}
