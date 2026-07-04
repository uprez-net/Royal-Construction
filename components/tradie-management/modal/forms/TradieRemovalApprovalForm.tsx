"use client";

import {
  AlertTriangle,
  Building2,
  Mail,
  Phone,
  Star,
  Trash2,
} from "lucide-react";

import { DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";

import { TradieApprovalActionType } from "@prisma/client";
import { SafeTradieApproval } from "@/types/tradie";
import { TradieBadge } from "@/components/tradie-management/trade-badge";
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
      payload: undefined,
    });
  };

  return (
    <>
      <DialogHeader className="pb-4">
        <DialogTitle className="flex items-center gap-2 text-destructive">
          <Trash2 className="size-5" />
          Tradie Removal Approval
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

        {/* Tradie Information */}
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

              <Badge variant="secondary" className="gap-1">
                <Star className="size-3" />
                {approval.tradie.rating ?? "No Rating"}
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
                icon={<Star className="size-4" />}
                label="Hourly Rate"
                value={
                  approval.tradie.hourlyRate
                    ? `$${approval.tradie.hourlyRate}/hr`
                    : "-"
                }
              />
            </div>

            {approval.tradie.note && (
              <div className="mt-4 rounded-lg border bg-muted/20 p-4">
                <p className="text-sm font-medium">Tradie Notes</p>

                <p className="mt-1 text-sm text-muted-foreground">
                  {approval.tradie.note}
                </p>
              </div>
            )}
          </div>
        </div>

        <Separator />

        {/* Removal Reason */}
        <div>
          <h3 className="mb-3 text-sm font-semibold text-muted-foreground">
            Removal Request Reason
          </h3>

          <div className="rounded-lg border bg-muted/20 p-4">
            <p className="text-sm leading-relaxed">{approval.reason}</p>
          </div>
        </div>

        {/* Danger Zone */}
        <div className="rounded-lg border border-red-200 bg-red-50 p-5">
          <div className="flex gap-3">
            <AlertTriangle className="size-5 shrink-0 text-red-600" />

            <div>
              <p className="font-semibold text-red-900">Permanent Action</p>

              <p className="mt-2 text-sm text-red-800">
                Approving this request will permanently remove this tradie from
                the system.
              </p>

              <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-red-800">
                <li>The tradie record will be deleted</li>
                <li>Associated approvals may become inaccessible</li>
                <li>Historical references may be affected</li>
                <li>This action cannot be undone</li>
              </ul>
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
            Reject Request
          </Button>

          <Button
            variant="destructive"
            disabled={mutation.isPending}
            onClick={() => submit("approved")}
          >
            <Trash2 className="mr-2 size-4" />
            Remove Tradie
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
