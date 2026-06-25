"use client";

import { useState } from "react";
import { TradieApprovalActionType } from "@prisma/client";
import {
  AlertTriangle,
  Building2,
  Calendar,
  Mail,
  Phone,
  ShieldAlert,
} from "lucide-react";

import { DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";

import { SafeTradieApproval } from "@/types/tradie";
import { useApprovalMutation } from "@/hooks/use-approval-mutation";
import { TradieBadge } from "@/components/tradie-management/trade-badge";

interface Props {
  approval: SafeTradieApproval;
  onSuccess: () => void;
}

export function IncidentResolutionApprovalForm({ approval, onSuccess }: Props) {
  const [resolution, setResolution] = useState("");

  const mutation = useApprovalMutation(onSuccess);

  const incidentData = (approval.updationData ?? {}) as {
    incidentType?: string;
    severity?: string;
    description?: string;
    resolution?: string;
  };

  const submit = (resolutionStatus: "approved" | "rejected") => {
    mutation.mutate({
      approvalId: approval.id,
      type: TradieApprovalActionType.INCIDENT_RESOLUTION,
      resolution: resolutionStatus,
      payload:
        resolutionStatus === "approved"
          ? {
              resolution: resolution.trim(),
            }
          : undefined,
    });
  };

  return (
    <>
      <DialogHeader className="pb-4">
        <DialogTitle className="flex items-center gap-2">
          <ShieldAlert className="size-5" />
          Incident Resolution Approval
        </DialogTitle>
      </DialogHeader>

      <div className="space-y-6">
        {/* Approval Metadata */}
        <div>
          <h3 className="mb-3 text-sm font-semibold text-muted-foreground">
            Approval Information
          </h3>

          <div className="grid gap-4 sm:grid-cols-2">
            <InfoItem
              label="Action Type"
              value={approval.actionType.replaceAll("_", " ")}
            />

            <InfoItem label="Status" value={approval.status} />

            <InfoItem label="Requested By" value={approval.requestBy} />

            <InfoItem
              label="Created"
              value={new Date(approval.createdAt).toLocaleString()}
            />
          </div>
        </div>

        <Separator />

        {/* Tradie Details */}
        <div>
          <h3 className="mb-3 text-sm font-semibold text-muted-foreground">
            Tradie Information
          </h3>

          <div className="rounded-lg border p-4">
            <div className="flex items-start justify-between">
              <div>
                <h4 className="text-lg font-semibold">
                  {approval.tradie.name}
                </h4>

                <div className="mt-2">
                  <TradieBadge trade={approval.tradie.trade} />
                </div>
              </div>

              <Badge variant="secondary">
                {approval.tradie.rating
                  ? `${approval.tradie.rating} ★`
                  : "No Rating"}
              </Badge>
            </div>

            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              <DetailRow
                icon={<Mail className="size-4" />}
                label="Email"
                value={approval.tradie.email}
              />

              <DetailRow
                icon={<Phone className="size-4" />}
                label="Phone"
                value={approval.tradie.phone}
              />

              <DetailRow
                icon={<Building2 className="size-4" />}
                label="ABN"
                value={approval.tradie.abn}
              />

              <DetailRow
                icon={<Calendar className="size-4" />}
                label="Joined"
                value={new Date(approval.tradie.createdAt).toLocaleDateString()}
              />
            </div>

            {approval.tradie.note && (
              <div className="mt-4 rounded-md border bg-muted/30 p-3">
                <p className="text-sm font-medium">Tradie Notes</p>

                <p className="mt-1 text-sm text-muted-foreground">
                  {approval.tradie.note}
                </p>
              </div>
            )}
          </div>
        </div>

        <Separator />

        {/* Incident Details */}
        <div>
          <h3 className="mb-3 text-sm font-semibold text-muted-foreground">
            Incident Details
          </h3>

          <div className="rounded-lg border p-4 space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <InfoItem
                label="Incident Type"
                value={incidentData.incidentType ?? "Not Provided"}
              />

              <InfoItem
                label="Severity"
                value={incidentData.severity ?? "Not Provided"}
              />
            </div>

            <div>
              <p className="text-xs text-muted-foreground mb-1">Description</p>

              <div className="rounded-md bg-muted/30 p-3">
                <p className="text-sm">
                  {incidentData.description ?? approval.reason}
                </p>
              </div>
            </div>
          </div>
        </div>

        <Separator />

        {/* Approval Reason */}
        <div>
          <h3 className="mb-3 text-sm font-semibold text-muted-foreground">
            Approval Request Reason
          </h3>

          <div className="rounded-lg border bg-muted/20 p-4">
            <p className="text-sm">{approval.reason}</p>
          </div>
        </div>

        {/* Resolution */}
        <div>
          <h3 className="mb-3 text-sm font-semibold text-muted-foreground">
            Resolution
          </h3>

          <Textarea
            rows={5}
            value={resolution}
            onChange={(e) => setResolution(e.target.value)}
            placeholder="Describe how this incident has been resolved..."
          />
        </div>

        {/* Warning */}
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
          <div className="flex gap-3">
            <AlertTriangle className="size-5 text-amber-600 shrink-0" />

            <div>
              <p className="font-medium text-amber-900">Approval Impact</p>

              <p className="mt-1 text-sm text-amber-800">
                Approving this request will mark the incident as resolved and
                permanently store the supplied resolution against the incident
                record.
              </p>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-2 border-t pt-4">
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
            Approve Resolution
          </Button>
        </div>
      </div>
    </>
  );
}

function InfoItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>

      <p className="font-medium">{value}</p>
    </div>
  );
}

function DetailRow({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <div className="mt-0.5 text-muted-foreground">{icon}</div>

      <div>
        <p className="text-xs text-muted-foreground">{label}</p>

        <p className="font-medium">{value}</p>
      </div>
    </div>
  );
}
