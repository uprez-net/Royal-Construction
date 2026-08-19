"use client";

import {
  ArrowRight,
  Building2,
  DollarSign,
  Loader2,
  Mail,
  Minus,
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
import { formatQuotedPrice } from "@/utils/calculations";

interface Props {
  approval: SafeTradieApproval;
  onSuccess: () => void;
}

// A rate reaches this form either as a JSON number in the approval payload or as
// a serialised Decimal string on the tradie record. Anything absent or
// unparseable is `null` — the one value that cannot be mistaken for a real rate.
function parseRate(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

// Every rate render site goes through this, so a missing figure reads as a
// placeholder instead of "$0.00" or "$NaN".
const RATE_PLACEHOLDER = "Not recorded";
const formatRate = (
  value: number | null,
  unit: "HOURLY" | "FIXED",
) =>
  value === null
    ? RATE_PLACEHOLDER
    : formatQuotedPrice(value, unit, rateCurrency.format);

export function PriceChangeApprovalForm({ approval, onSuccess }: Props) {
  const mutation = useApprovalMutation(onSuccess);

  const data = (approval.updationData ?? {}) as {
    currentHourlyRate?: number;
    newHourlyRate?: number;
    reason?: string;
  };

  // The stored payload only guarantees `newHourlyRate`; the "current" rate has
  // to fall back to the tradie record, or the comparison renders NaN / "$undefined".
  // An absent rate stays `null` rather than being coerced: `Number(null)` is 0,
  // which would present a missing rate as a real $0.00/hr, and `Number(undefined)`
  // is NaN, which would poison the difference and the impact sentence.
  const currentRate = parseRate(data.currentHourlyRate ?? approval.tradie.lastQuotedPrice);
  const newRate = parseRate(data.newHourlyRate);
  const hasRates = currentRate !== null && newRate !== null;

  // The tradie record's own rate, shown alongside the request. Distinct from
  // `currentRate`, which falls back to this when the request payload omitted a
  // "current" figure — here we want what is actually on the record, so a
  // reviewer can see when the two disagree.
  const storedRate = parseRate(approval.tradie.lastQuotedPrice);

  const submit = (resolution: "approved" | "rejected") => {
    mutation.mutate({
      approvalId: approval.id,
      type: TradieApprovalActionType.PRICE_CHANGE,
      resolution,
      // No fabricated zero: with no requested rate there is nothing to write,
      // and the approve action is disabled in that state anyway.
      payload: newRate === null ? undefined : { newHourlyRate: newRate },
    });
  };

  const difference =
    currentRate !== null && newRate !== null ? newRate - currentRate : 0;

  // Zero-denominator guard: a tradie with no stored rate would otherwise give
  // Infinity here.
  const percentageChange =
    hasRates && currentRate > 0
      ? ((difference / currentRate) * 100).toFixed(1)
      : null;

  const isIncrease = difference > 0;
  const isDecrease = difference < 0;
  // A zero difference is neither a rise nor a fall — it gets its own neutral
  // affordance instead of borrowing the "decrease" arrow.
  const ChangeIcon = isIncrease
    ? TrendingUp
    : isDecrease
      ? TrendingDown
      : Minus;

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
                  storedRate !== null
                    ? formatQuotedPrice(storedRate, approval.tradie.lastQuotedPriceUnit, rateCurrency.format)
                    : "Not set"
                }
                // Mono is reserved for actual figures; the "Not set" placeholder
                // renders as prose so a missing rate does not read like data.
                mono={storedRate !== null}
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

                {/* Mono is for real figures only; the placeholder renders as
                    prose so a missing rate never reads like data. */}
                <p
                  className={cn(
                    "mt-2 text-2xl font-semibold",
                    currentRate !== null
                      ? "font-mono tabular-nums"
                      : "text-muted-foreground",
                  )}
                >
                  {formatRate(currentRate, approval.tradie.lastQuotedPriceUnit)}
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

                <p
                  className={cn(
                    "mt-2 text-2xl font-semibold",
                    newRate !== null
                      ? "font-mono tabular-nums"
                      : "text-muted-foreground",
                  )}
                >
                  {formatRate(newRate, approval.tradie.lastQuotedPriceUnit)}
                </p>

                <p className="text-sm text-muted-foreground">per hour</p>
              </div>
            </div>

            <div className="mt-6 flex justify-center">
              <Badge variant="outline" className="gap-2 px-3 py-1">
                <ChangeIcon className="size-3" aria-hidden="true" />

                {!hasRates ? (
                  <span>Change unavailable</span>
                ) : difference === 0 ? (
                  <span>No change to the quoted price</span>
                ) : (
                  <span className="font-mono tabular-nums">
                    {isIncrease ? "+" : ""}
                    {formatQuotedPrice(difference, approval.tradie.lastQuotedPriceUnit, rateCurrency.format)}
                    {percentageChange
                      ? ` (${isIncrease ? "+" : ""}${percentageChange}%)`
                      : ""}
                  </span>
                )}
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
                Approving this request updates the tradie&apos;s hourly rate
                from{" "}
                <span
                  className={cn(
                    currentRate !== null && "font-mono tabular-nums",
                  )}
                >
                  {formatRate(currentRate, approval.tradie.lastQuotedPriceUnit)}
                </span>{" "}
                to{" "}
                <span
                  className={cn(newRate !== null && "font-mono tabular-nums")}
                >
                  {formatRate(newRate, approval.tradie.lastQuotedPriceUnit)}
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
            disabled={mutation.isPending || newRate === null || newRate <= 0}
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
