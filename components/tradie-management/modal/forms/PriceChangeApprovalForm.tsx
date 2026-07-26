"use client";

import {
  ArrowRight,
  Building2,
  DollarSign,
  Loader2,
  Mail,
  Phone,
  TrendingDown,
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
import { RatingStars } from "@/components/common/rating-stars";
import { rateCurrency, dataTimeFormat, formatStatus } from "@/utils/formatters";
import { cn } from "@/lib/utils";

interface Props {
  approval: SafeTradieApproval;
  onSuccess: () => void;
}

export function PriceChangeApprovalForm({ approval, onSuccess }: Props) {
  const mutation = useApprovalMutation(onSuccess);

  const data = (approval.updationData ?? {}) as {
    currentHourlyRate?: number;
    newHourlyRate?: number;
    reason?: string;
  };

  // The stored payload only guarantees `newHourlyRate`; the "current" rate has
  // to fall back to the tradie record, or the comparison renders NaN / "$undefined".
  const currentRate = Number(
    data.currentHourlyRate ?? approval.tradie.hourlyRate ?? 0,
  );
  const newRate = Number(data.newHourlyRate ?? 0);
  const hasRates = Number.isFinite(currentRate) && Number.isFinite(newRate);

  const submit = (resolution: "approved" | "rejected") => {
    mutation.mutate({
      approvalId: approval.id,
      type: TradieApprovalActionType.PRICE_CHANGE,
      resolution,
      payload: {
        newHourlyRate: newRate,
      },
    });
  };

  const difference = hasRates ? newRate - currentRate : 0;

  // Zero-denominator guard: a tradie with no stored rate would otherwise give
  // Infinity here.
  const percentageChange =
    currentRate > 0 ? ((difference / currentRate) * 100).toFixed(1) : null;

  const isIncrease = difference > 0;

  return (
    <>
      <DialogHeader className="pb-4">
        <DialogTitle className="flex items-center gap-2">
          <DollarSign className="size-5" aria-hidden="true" />
          Price change approval
        </DialogTitle>
      </DialogHeader>

      <div className="space-y-6">
        {/* Approval Metadata */}
        <div>
          <h3 className="mb-3 text-sm font-semibold text-muted-foreground">
            Approval information
          </h3>

          <div className="grid gap-4 sm:grid-cols-2">
            <InfoItem
              label="Action type"
              value={formatStatus(approval.actionType)}
            />

            <InfoItem label="Status" value={formatStatus(approval.status)} />

            <InfoItem label="Requested by" value={approval.requestBy} />

            <InfoItem
              label="Created"
              value={dataTimeFormat.format(new Date(approval.createdAt))}
              mono
            />
          </div>
        </div>

        <Separator />

        {/* Tradie Information */}
        <div>
          <h3 className="mb-3 text-sm font-semibold text-muted-foreground">
            Tradie information
          </h3>

          <div className="rounded-lg border border-border/70 p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h4 className="text-base font-semibold">
                  {approval.tradie.name}
                </h4>

                <div className="mt-2">
                  <TradieBadge trade={approval.tradie.trade} />
                </div>
              </div>

              {approval.tradie.rating ? (
                <RatingStars rating={parseFloat(approval.tradie.rating)} />
              ) : (
                <Badge variant="secondary">No rating</Badge>
              )}
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
                mono
              />

              <DetailRow
                icon={<Building2 className="size-4" />}
                label="ABN"
                value={approval.tradie.abn}
                mono
              />

              <DetailRow
                icon={<DollarSign className="size-4" />}
                label="Current stored rate"
                value={
                  approval.tradie.hourlyRate
                    ? `${rateCurrency.format(Number(approval.tradie.hourlyRate))}/hr`
                    : "Not set"
                }
                mono
              />
            </div>
          </div>
        </div>

        <Separator />

        {/* Price Comparison */}
        <div>
          <h3 className="mb-3 text-sm font-semibold text-muted-foreground">
            Requested rate change
          </h3>

          <div className="rounded-lg border border-border/70 p-6">
            <div className="grid grid-cols-3 items-center gap-4">
              <div className="text-center">
                <p className="text-xs text-muted-foreground">Current rate</p>

                <p className="mt-2 font-mono text-2xl font-semibold tabular-nums">
                  {rateCurrency.format(currentRate)}
                </p>

                <p className="text-sm text-muted-foreground">per hour</p>
              </div>

              <div className="flex justify-center">
                <ArrowRight
                  className="size-6 text-muted-foreground"
                  aria-hidden="true"
                />
              </div>

              <div className="text-center">
                <p className="text-xs text-muted-foreground">Requested rate</p>

                <p className="mt-2 font-mono text-2xl font-semibold tabular-nums">
                  {rateCurrency.format(newRate)}
                </p>

                <p className="text-sm text-muted-foreground">per hour</p>
              </div>
            </div>

            <div className="mt-6 flex justify-center">
              <Badge variant="outline" className="gap-2 px-3 py-1">
                {isIncrease ? (
                  <TrendingUp className="size-3" aria-hidden="true" />
                ) : (
                  <TrendingDown className="size-3" aria-hidden="true" />
                )}
                <span className="font-mono tabular-nums">
                  {isIncrease ? "+" : ""}
                  {rateCurrency.format(difference)}/hr
                  {percentageChange
                    ? ` (${isIncrease ? "+" : ""}${percentageChange}%)`
                    : ""}
                </span>
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
                Requested reason
              </h3>

              <div className="rounded-lg border border-border/70 bg-muted/20 p-4">
                <p className="text-sm leading-relaxed">{data.reason}</p>
              </div>
            </div>
          </>
        )}

        <Separator />

        {/* Approval Request Reason */}
        <div>
          <h3 className="mb-3 text-sm font-semibold text-muted-foreground">
            Approval request notes
          </h3>

          <div className="rounded-lg border border-border/70 bg-muted/20 p-4">
            <p className="text-sm">{approval.reason}</p>
          </div>
        </div>

        {/* Impact */}
        <div className="rounded-lg bg-info-light p-4">
          <div className="flex gap-3">
            <DollarSign
              className="size-5 shrink-0 text-info-ink"
              aria-hidden="true"
            />

            <div>
              <p className="font-medium text-info-ink">Approval impact</p>

              <p className="mt-1 text-sm text-foreground/80">
                Approving this request updates the tradie&apos;s hourly rate from{" "}
                <span className="font-mono tabular-nums">
                  {rateCurrency.format(currentRate)}
                </span>{" "}
                to{" "}
                <span className="font-mono tabular-nums">
                  {rateCurrency.format(newRate)}
                </span>
                . Future estimates, quotations and project calculations use the
                updated rate.
              </p>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-2 border-t border-border/70 pt-4">
          <Button
            variant="outline"
            onClick={() => submit("rejected")}
            disabled={mutation.isPending}
          >
            Reject
          </Button>

          <Button
            onClick={() => submit("approved")}
            disabled={mutation.isPending || !hasRates || newRate <= 0}
          >
            {mutation.isPending ? (
              <>
                <Loader2
                  className="mr-2 size-4 animate-spin"
                  aria-hidden="true"
                />
                Submitting…
              </>
            ) : (
              "Approve price change"
            )}
          </Button>
        </div>
      </div>
    </>
  );
}

function InfoItem({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>

      <p className={cn("font-medium", mono && "font-mono tabular-nums")}>
        {value}
      </p>
    </div>
  );
}

function DetailRow({
  icon,
  label,
  value,
  mono,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-start gap-3">
      <div className="mt-0.5 text-muted-foreground" aria-hidden="true">
        {icon}
      </div>

      <div>
        <p className="text-xs text-muted-foreground">{label}</p>

        <p className={cn("font-medium", mono && "font-mono tabular-nums")}>
          {value}
        </p>
      </div>
    </div>
  );
}
