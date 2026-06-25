"use client";

import { DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { AlertTriangle } from "lucide-react";

import { TradieApprovalActionType } from "@prisma/client";
import { SafeTradieApproval } from "@/types/tradie";
import { useApprovalMutation } from "@/hooks/use-approval-mutation";


interface Props {
  approval: SafeTradieApproval;
  onSuccess: () => void;
}

export function TradieRemovalApprovalForm({ approval, onSuccess }: Props) {
  const mutation = useApprovalMutation(onSuccess);

  const submit = (resolution: "approved" | "rejected") => {
    mutation.mutate({
        approvalId: approval.id,
        type: TradieApprovalActionType.TRADIE_REMOVAL,
        resolution,
        payload: undefined
    });
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>Remove Tradie</DialogTitle>
      </DialogHeader>

      <div className="space-y-4">
        <div className="rounded-lg border p-4">
          <div className="flex gap-3">
            <AlertTriangle className="size-5 text-destructive" />

            <div>
              <p className="font-medium">{approval.tradie.name}</p>

              <p className="text-muted-foreground text-sm">
                Approving this request will permanently delete this tradie.
              </p>
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => submit("rejected")} disabled={mutation.isPending}>
            Reject
          </Button>

          <Button variant="destructive" onClick={() => submit("approved")} disabled={mutation.isPending}>
            Remove Tradie
          </Button>
        </div>
      </div>
    </>
  );
}
