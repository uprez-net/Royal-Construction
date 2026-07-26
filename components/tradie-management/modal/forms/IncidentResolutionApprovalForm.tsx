"use client";

import { useState } from "react";
import { TradieApprovalActionType } from "@prisma/client";
import {
  AlertTriangle,
  Building2,
  Calendar,
  Loader2,
  Mail,
  Phone,
  ShieldAlert,
} from "lucide-react";

import { DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";

import { SafeTradieApproval } from "@/types/tradie";
import { useApprovalMutation } from "@/hooks/use-approval-mutation";
import { TradieBadge } from "@/components/tradie-management/trade-badge";
import { RatingStars } from "@/components/common/rating-stars";
import { dataTimeFormat, dateFormat, formatStatus } from "@/utils/formatters";
import { cn } from "@/lib/utils";

interface Props {
  approval: SafeTradieApproval;
  onSuccess: () => void;
}

export function IncidentResolutionApprovalForm({ approval, onSuccess }: Props) {
  const [resolution, setResolution] = useState("");
  // A pristine field is not an error. `aria-invalid` only fires once the
  // operator has left the field or tried to submit, otherwise a screen reader
  // announces "invalid" before anything has been typed.
  const [resolutionTouched, setResolutionTouched] = useState(false);

  const mutation = useApprovalMutation(onSuccess);

  const incidentData = (approval.updationData ?? {}) as {
    incidentType?: string;
    severity?: string;
    description?: string;
    resolution?: string;
  };

  const submit = (resolutionStatus: "approved" | "rejected") => {
    if (resolutionStatus === "approved") {
      setResolutionTouched(true);

      if (!resolution.trim()) return;
    }

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
          <ShieldAlert className="size-5" aria-hidden="true" />
          Incident resolution approval
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

        {/* Tradie Details */}
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
                icon={<Calendar className="size-4" />}
                label="Joined"
                value={dateFormat.format(new Date(approval.tradie.createdAt))}
                mono
              />
            </div>

            {approval.tradie.note && (
              <div className="mt-4 rounded-md border border-border/70 bg-muted/30 p-3">
                <p className="text-sm font-medium">Tradie notes</p>

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
            Incident details
          </h3>

          <div className="rounded-lg border border-border/70 p-4 space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <InfoItem
                label="Incident type"
                value={
                  incidentData.incidentType
                    ? formatStatus(incidentData.incidentType)
                    : "Not provided"
                }
              />

              <InfoItem
                label="Severity"
                value={
                  incidentData.severity
                    ? formatStatus(incidentData.severity)
                    : "Not provided"
                }
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
            Approval request reason
          </h3>

          <div className="rounded-lg border border-border/70 bg-muted/20 p-4">
            <p className="text-sm">{approval.reason}</p>
          </div>
        </div>

        {/* Resolution */}
        <div>
          <Label
            htmlFor="incident-resolution"
            className="mb-3 text-sm font-semibold text-muted-foreground"
          >
            Resolution
            <span className="text-destructive">
              *<span className="sr-only"> required</span>
            </span>
          </Label>

          <Textarea
            id="incident-resolution"
            rows={5}
            required
            value={resolution}
            aria-invalid={resolutionTouched && !resolution.trim()}
            aria-describedby="incident-resolution-hint"
            onChange={(e) => setResolution(e.target.value)}
            onBlur={() => setResolutionTouched(true)}
            placeholder="Describe how this incident has been resolved…"
          />

          <p
            id="incident-resolution-hint"
            className="mt-1 text-xs text-muted-foreground"
          >
            Required before this resolution can be approved.
          </p>
        </div>

        {/* Warning */}
        <div className="rounded-lg bg-warning-light p-4">
          <div className="flex gap-3">
            <AlertTriangle
              className="size-5 shrink-0 text-warning-ink"
              aria-hidden="true"
            />

            <div>
              <p className="font-medium text-warning-ink">Approval impact</p>

              <p className="mt-1 text-sm text-foreground/80">
                Approving this request marks the incident as resolved and
                permanently stores the supplied resolution against the incident
                record.
              </p>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-2 border-t border-border/70 pt-4">
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
            {mutation.isPending ? (
              <>
                <Loader2
                  className="mr-2 size-4 animate-spin"
                  aria-hidden="true"
                />
                Submitting…
              </>
            ) : (
              "Approve resolution"
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
