import { useApprovalMutation } from "@/hooks/use-approval-mutation";
import {
  SafeTradieApproval,
  ScheduleDeletionJsonPayload,
} from "@/types/tradie";
import { TradieApprovalActionType } from "@prisma/client";
import { DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertOctagon,
  CalendarClock,
  CalendarX,
  Briefcase,
  User,
  DollarSign,
  Hammer,
  Clock3,
  CalendarDays,
  Loader2,
  Mail,
  Phone,
  LucideIcon,
} from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { dataTimeFormat, formatStatus } from "@/utils/formatters";
import { cn } from "@/lib/utils";

interface Props {
  approval: SafeTradieApproval;
  onSuccess: () => void;
}

function InfoRow({
  icon: Icon,
  label,
  value,
  mono,
}: {
  icon: LucideIcon;
  label: string;
  value: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-border/70 bg-muted/30 p-3">
      <Icon
        className="mt-0.5 size-4 text-muted-foreground"
        aria-hidden="true"
      />
      <div className="min-w-0 flex-1">
        <p className="text-xs text-muted-foreground">{label}</p>
        <div
          className={cn(
            "font-medium wrap-break-word",
            mono && "font-mono tabular-nums",
          )}
        >
          {value}
        </div>
      </div>
    </div>
  );
}

export function ScheduleDeletionApprovalForm({ approval, onSuccess }: Props) {
  const approvalData = approval.updationData as ScheduleDeletionJsonPayload;

  const mutation = useApprovalMutation(onSuccess);

  const [rejectReason, setRejectReason] = useState("");

  const submit = (resolution: "approved" | "rejected") => {
    mutation.mutate({
      approvalId: approval.id,
      type: TradieApprovalActionType.SCHEDULE_DELETION,
      resolution,
      payload: undefined,
      rejectReason: resolution === "rejected" ? rejectReason.trim() : undefined,
    });
  };

  return (
    <>
      <DialogHeader className="pb-4 pr-10">
        <DialogTitle className="flex items-center gap-2">
          <CalendarX className="size-5 text-destructive" aria-hidden="true" />
          Review schedule removal
        </DialogTitle>
      </DialogHeader>

      <div className="space-y-6">
        <div className="rounded-lg border border-destructive/20 bg-destructive-light p-4">
          <div className="flex gap-3">
            <AlertOctagon
              className="mt-0.5 size-5 shrink-0 text-destructive-ink"
              aria-hidden="true"
            />

            <div>
              <h4 className="mb-1 text-sm font-semibold text-destructive-ink">
                Approving deletes this booking
              </h4>

              <p className="text-xs leading-relaxed text-foreground/80">
                The schedule is removed from the project permanently and cannot
                be restored. Rejecting leaves it exactly as it is.
              </p>
            </div>
          </div>
        </div>

        {/* Request Summary */}
        <div className="rounded-xl border border-border/70 bg-muted/20 p-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h3 className="font-semibold">Request summary</h3>

            <Badge variant="secondary">{formatStatus(approval.status)}</Badge>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <InfoRow
              icon={User}
              label="Requested by"
              value={approval.requestBy}
            />

            <InfoRow
              icon={Clock3}
              label="Submitted"
              value={dataTimeFormat.format(new Date(approval.createdAt))}
              mono
            />
          </div>

          <div className="mt-3 rounded-lg border border-border/70 bg-background p-3">
            <p className="mb-1 text-xs text-muted-foreground">
              Reason for removal
            </p>
            <p className="whitespace-pre-wrap text-sm">{approval.reason}</p>
          </div>
        </div>

        {/* Tradie */}
        <div>
          <h3 className="mb-3 font-semibold">Tradie details</h3>

          <div className="grid gap-3 md:grid-cols-2">
            <InfoRow icon={User} label="Tradie" value={approval.tradie.name} />

            <InfoRow
              icon={Hammer}
              label="Trade"
              value={approval.tradie.trade}
            />

            <InfoRow
              icon={Phone}
              label="Phone"
              value={approval.tradie.phone}
              mono
            />

            <InfoRow icon={Mail} label="Email" value={approval.tradie.email} />
          </div>
        </div>

        {/* Booking being removed */}
        <div>
          <h3 className="mb-3 font-semibold">Booking to be removed</h3>

          <div className="grid gap-3 md:grid-cols-2">
            <InfoRow
              icon={Briefcase}
              label="Project"
              value={approvalData?.projectName ?? "Unknown project"}
            />

            <InfoRow
              icon={CalendarDays}
              label="Activity"
              value={approvalData?.milestoneName ?? "General Task"}
            />

            <InfoRow
              icon={CalendarClock}
              // Recorded on the request rather than re-derived: the schedule
              // row is gone once this is approved.
              label="Booked for"
              value={approvalData?.scheduledDate ?? "Not set"}
              mono={Boolean(approvalData?.scheduledDate)}
            />

            <InfoRow
              icon={Clock3}
              label="Duration"
              value={
                approvalData?.durationDays
                  ? `${approvalData.durationDays} day${
                      approvalData.durationDays === 1 ? "" : "s"
                    }`
                  : "Not set"
              }
            />

            <InfoRow
              icon={DollarSign}
              label="Committed cost"
              value={approvalData?.cost || "Not quoted"}
              mono={Boolean(approvalData?.cost)}
            />

            <InfoRow
              icon={CalendarX}
              label="Current status"
              value={
                approvalData?.currentStatus
                  ? formatStatus(approvalData.currentStatus)
                  : "Unknown"
              }
            />
          </div>
        </div>

        {/* Actions */}
        {approval.status === "PENDING" && (
          <div className="space-y-4 border-t border-border/70 pt-5">
            <div className="space-y-1.5">
              <Label htmlFor="schedule-deletion-reject-reason">
                Reason for keeping the booking
                <span className="text-destructive">
                  *<span className="sr-only"> required</span>
                </span>
              </Label>
              <Textarea
                id="schedule-deletion-reject-reason"
                rows={2}
                maxLength={1000}
                required
                aria-required="true"
                aria-describedby="schedule-deletion-reject-reason-hint"
                value={rejectReason}
                onChange={(event) => setRejectReason(event.target.value)}
              />
              <p
                id="schedule-deletion-reject-reason-hint"
                className="text-xs text-muted-foreground"
              >
                Required to keep the booking. The requester sees this reason.
              </p>
            </div>

            <div className="grid gap-2 sm:flex sm:justify-end">
              <Button
                variant="outline"
                disabled={mutation.isPending || !rejectReason.trim()}
                onClick={() => submit("rejected")}
              >
                Keep booking
              </Button>

              <Button
                variant="destructive"
                disabled={mutation.isPending}
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
                  <>
                    <CalendarX className="mr-2 size-4" aria-hidden="true" />
                    Approve removal
                  </>
                )}
              </Button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
