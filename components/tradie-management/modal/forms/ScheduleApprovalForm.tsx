import { useApprovalMutation } from "@/hooks/use-approval-mutation";
import {
  SafeTradieApproval,
  ScheduleApprovalJsonPayload,
} from "@/types/tradie";
import { TradieApprovalActionType } from "@prisma/client";
import { DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  CalendarClock,
  CalendarPlus,
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
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  currency,
  dataTimeFormat,
  dateFormat,
  formatStatus,
} from "@/utils/formatters";
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

export function ScheduleApprovalForm({ approval, onSuccess }: Props) {
  const approvalData = approval.updationData as ScheduleApprovalJsonPayload;

  const mutation = useApprovalMutation(onSuccess);

  const quotedCost = Number(approvalData.cost);
  const scheduledDate = new Date(approvalData.scheduledDate);
  const isScheduledDateValid = !Number.isNaN(scheduledDate.getTime());

  const submit = (resolution: "approved" | "rejected") => {
    mutation.mutate({
      approvalId: approval.id,
      type: TradieApprovalActionType.SCHEDULE_APPROVAL,
      resolution,
      payload: undefined,
    });
  };

  return (
    <>
      <DialogHeader className="pb-4">
        <DialogTitle className="flex items-center gap-2">
          <CalendarClock className="size-5 text-primary" aria-hidden="true" />
          Review schedule request
        </DialogTitle>
      </DialogHeader>

      <div className="space-y-6">
        {/* Request Summary */}
        <div className="rounded-xl border border-border/70 bg-muted/20 p-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h3 className="font-semibold">Request summary</h3>

            {/* Derived from the record — this used to be a hardcoded
                "Pending Approval" badge regardless of actual status. */}
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
            <p className="mb-1 text-xs text-muted-foreground">Reason</p>
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

        {/* Schedule */}
        <div>
          <h3 className="mb-3 font-semibold">Schedule details</h3>

          <div className="grid gap-3 md:grid-cols-2">
            <InfoRow
              icon={Briefcase}
              label="Project"
              value={approvalData.projectName}
            />

            <InfoRow
              icon={CalendarDays}
              label="Milestone"
              value={approvalData.milestoneName}
            />

            <InfoRow
              icon={CalendarClock}
              label="Start date"
              value={
                isScheduledDateValid
                  ? dateFormat.format(scheduledDate)
                  : "Not set"
              }
              mono={isScheduledDateValid}
            />

            <InfoRow
              icon={Clock3}
              label="Duration"
              value={`${approvalData.durationDays} day${
                approvalData.durationDays === 1 ? "" : "s"
              }`}
            />

            <InfoRow
              icon={DollarSign}
              label="Quoted cost"
              value={
                Number.isFinite(quotedCost)
                  ? currency.format(quotedCost)
                  : "Not quoted"
              }
              mono={Number.isFinite(quotedCost)}
            />
          </div>
        </div>

        {/* Actions */}
        {approval.status === "PENDING" && (
          <div className="flex justify-end gap-2 border-t border-border/70 pt-5">
            <Button
              variant="outline"
              disabled={mutation.isPending}
              onClick={() => submit("rejected")}
            >
              Reject request
            </Button>

            <Button
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
                  <CalendarPlus className="mr-2 size-4" aria-hidden="true" />
                  Approve schedule
                </>
              )}
            </Button>
          </div>
        )}
      </div>
    </>
  );
}
