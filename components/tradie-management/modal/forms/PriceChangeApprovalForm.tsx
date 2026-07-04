"use client";

import {
  ArrowRight,
  Building2,
  DollarSign,
  Mail,
  Phone,
  TrendingUp,
} from "lucide-react";

import { DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";

import { TradieApprovalActionType } from "@prisma/client";
import { SafeTradieApproval } from "@/types/tradie";
import { TradieBadge } from "@/components/tradie-management/trade-badge";
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

  const difference = data.newHourlyRate - data.currentHourlyRate;

  const percentageChange =
    data.currentHourlyRate > 0
      ? ((difference / data.currentHourlyRate) * 100).toFixed(1)
      : "0";

  const isIncrease = difference > 0;

  return (
    <>
      <DialogHeader className="pb-4">
        <DialogTitle className="flex items-center gap-2">
          <DollarSign className="size-5" />
          Price Change Approval
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
                icon={<DollarSign className="size-4" />}
                label="Current Stored Rate"
                value={
                  approval.tradie.hourlyRate
                    ? `$${approval.tradie.hourlyRate}/hr`
                    : "-"
                }
              />
            </div>
          </div>
        </div>

        <Separator />

        {/* Price Comparison */}
        <div>
          <h3 className="mb-3 text-sm font-semibold text-muted-foreground">
            Requested Rate Change
          </h3>

          <div className="rounded-lg border p-6">
            <div className="grid grid-cols-3 items-center gap-4">
              <div className="text-center">
                <p className="text-xs text-muted-foreground">Current Rate</p>

                <p className="mt-2 text-2xl font-bold">
                  ${data.currentHourlyRate}
                </p>

                <p className="text-sm text-muted-foreground">per hour</p>
              </div>

              <div className="flex justify-center">
                <ArrowRight className="size-6 text-muted-foreground" />
              </div>

              <div className="text-center">
                <p className="text-xs text-muted-foreground">Requested Rate</p>

                <p className="mt-2 text-2xl font-bold">${data.newHourlyRate}</p>

                <p className="text-sm text-muted-foreground">per hour</p>
              </div>
            </div>

            <div className="mt-6 flex justify-center">
              <Badge variant="outline" className="gap-2 px-3 py-1">
                <TrendingUp className="size-3" />
                {isIncrease ? "+" : ""}${difference.toFixed(2)}
                {" / hr "}({isIncrease ? "+" : ""}
                {percentageChange}%)
              </Badge>
            </div>
          </div>
        </div>

        {/* Reason */}
        {data.reason && (
          <>
            <Separator />

            <div>
              <h3 className="mb-3 text-sm font-semibold text-muted-foreground">
                Requested Reason
              </h3>

              <div className="rounded-lg border bg-muted/20 p-4">
                <p className="text-sm leading-relaxed">{data.reason}</p>
              </div>
            </div>
          </>
        )}

        <Separator />

        {/* Approval Request Reason */}
        <div>
          <h3 className="mb-3 text-sm font-semibold text-muted-foreground">
            Approval Request Notes
          </h3>

          <div className="rounded-lg border bg-muted/20 p-4">
            <p className="text-sm">{approval.reason}</p>
          </div>
        </div>

        {/* Impact */}
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
          <div className="flex gap-3">
            <DollarSign className="size-5 text-blue-600 shrink-0" />

            <div>
              <p className="font-medium text-blue-900">Approval Impact</p>

              <p className="mt-1 text-sm text-blue-800">
                Approving this request will update the tradie&amp;s hourly rate from
                ${data.currentHourlyRate} to ${data.newHourlyRate}. Future
                estimates, quotations and project calculations will use the
                updated rate.
              </p>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-2 border-t pt-4">
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
            Approve Price Change
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
