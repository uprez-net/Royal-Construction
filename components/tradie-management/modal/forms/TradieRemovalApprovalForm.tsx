"use client";

import {
  Building2,
  DollarSign,
  Loader2,
  Mail,
  Phone,
  Trash2,
} from "lucide-react";
import { useId, useState } from "react";

import { DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";

import { TradieApprovalActionType } from "@prisma/client";
import { SafeTradieApproval } from "@/types/tradie";
import { TradieBadge } from "@/components/tradie-management/trade-badge";
import { useApprovalMutation } from "@/hooks/use-approval-mutation";
import { RatingStars } from "@/components/common/rating-stars";
import { rateCurrency, dataTimeFormat, formatStatus } from "@/utils/formatters";
import { cn } from "@/lib/utils";
import { formatQuotedPrice } from "@/utils/calculations";
import {
  TradieRemovalImpact,
  useTradieRemovalImpact,
} from "../tradie-removal-impact";

interface Props {
  approval: SafeTradieApproval;
  onSuccess: () => void;
}

export function TradieRemovalApprovalForm({ approval, onSuccess }: Props) {
  const mutation = useApprovalMutation(onSuccess);
  // Removal also cancels unfinished bookings; the operator has to
  // acknowledge the named tradie first.
  const confirmId = useId();
  const [confirmed, setConfirmed] = useState(false);
  const impact = useTradieRemovalImpact(
    approval.tradieId,
    approval.status === "PENDING",
  );

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
          <Trash2 className="size-5" aria-hidden="true" />
          Remove {approval.tradie.name}
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
                label="Last quoted price"
                value={
                  approval.tradie.lastQuotedPrice
                    ? formatQuotedPrice(
                        Number(approval.tradie.lastQuotedPrice),
                        approval.tradie.lastQuotedPriceUnit,
                        rateCurrency.format,
                      )
                    : "Not set"
                }
                // Mono is reserved for actual figures; the "Not set" placeholder
                // renders as prose so a missing rate does not read like data.
                mono={Boolean(approval.tradie.lastQuotedPrice)}
              />
            </div>

            {approval.tradie.note && (
              <div className="mt-4 rounded-lg border border-border/70 bg-muted/20 p-4">
                <p className="text-sm font-medium">Tradie notes</p>

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
            Removal request reason
          </h3>

          <div className="rounded-lg border border-border/70 bg-muted/20 p-4">
            <p className="text-sm leading-relaxed">{approval.reason}</p>
          </div>
        </div>

        {/* Danger Zone */}
        {approval.status === "PENDING" && (
          <TradieRemovalImpact impact={impact} />
        )}

        <div className="flex items-start gap-3">
          <Checkbox
            id={confirmId}
            checked={confirmed}
            onCheckedChange={(checked) => setConfirmed(checked === true)}
            className="mt-0.5"
          />

          <Label htmlFor={confirmId} className="text-sm leading-relaxed">
            I understand this removes {approval.tradie.name} from active use and
            cancels all unfinished bookings while preserving their history.
          </Label>
        </div>

        {/* Actions */}
        {approval.status === "PENDING" && (
          <div className="flex justify-end gap-2 border-t border-border/70 pt-4">
            <Button
              variant="outline"
              disabled={mutation.isPending}
              onClick={() => submit("rejected")}
            >
              Reject request
            </Button>

            <Button
              variant="destructive"
              disabled={
                mutation.isPending
                || !confirmed
                || !impact.isSuccess
                || impact.isFetching
              }
              onClick={() => submit("approved")}
            >
              {mutation.isPending ? (
                <>
                  <Loader2
                    className="mr-2 size-4 animate-spin"
                    aria-hidden="true"
                  />
                  Removing…
                </>
              ) : (
                <>
                  <Trash2 className="mr-2 size-4" aria-hidden="true" />
                  Remove tradie
                </>
              )}
            </Button>
          </div>
        )}
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
