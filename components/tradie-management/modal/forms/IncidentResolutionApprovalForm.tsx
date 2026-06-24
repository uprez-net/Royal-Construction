"use client";

import { useState } from "react";
import { DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { TradieApprovalActionType } from "@prisma/client";
import { SafeTradieApproval } from "@/types/tradie";
import { useApprovalMutation } from "@/hooks/use-approval-mutation";

interface Props {
  approval: SafeTradieApproval;
  onSuccess: () => void;
}

export function IncidentResolutionApprovalForm({ approval, onSuccess }: Props) {
  const [resolution, setResolution] = useState("");

  const mutation = useApprovalMutation(onSuccess);

  const submit = (resolutionStatus: "approved" | "rejected") => {
    mutation.mutate({
      approvalId: approval.id,
      type: TradieApprovalActionType.INCIDENT_RESOLUTION,
      resolution: resolutionStatus,
      payload:
        resolutionStatus === "approved"
          ? { resolution: resolution.trim() }
          : undefined,
    });
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>Incident Resolution Approval</DialogTitle>
      </DialogHeader>

      <div className="space-y-4">
        <Textarea
          rows={5}
          value={resolution}
          onChange={(e) => setResolution(e.target.value)}
          placeholder="Resolution details..."
        />

        <div className="flex justify-end gap-2">
          <Button
            variant="outline"
            disabled={mutation.isPending}
            onClick={() => submit("rejected")}
          >
            Reject
          </Button>

          <Button
            disabled={mutation.isPending || !resolution.trim()}
            onClick={() => submit("approved")}
          >
            Approve
          </Button>
        </div>
      </div>
    </>
  );
}
