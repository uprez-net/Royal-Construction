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
  FileText,
  LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";

interface Props {
  approval: SafeTradieApproval;
  onSuccess: () => void;
}

function InfoRow({
  icon: Icon,
  label,
  value,
}: {
  icon: LucideIcon;
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-3 rounded-lg border bg-muted/30 p-3">
      <Icon className="mt-0.5 size-4 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <p className="text-xs text-muted-foreground">{label}</p>
        <div className="font-medium wrap-break-word">{value}</div>
      </div>
    </div>
  );
}

export function ScheduleApprovalForm({ approval, onSuccess }: Props) {
  const approvalData = approval.updationData as ScheduleApprovalJsonPayload;

  const mutation = useApprovalMutation(onSuccess);

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
          <CalendarClock className="size-5 text-primary" />
          Review Schedule Request
        </DialogTitle>
      </DialogHeader>

      <div className="space-y-6">
        {/* Request Summary */}
        <div className="rounded-xl border bg-muted/20 p-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="font-semibold">Request Summary</h3>

            <Badge variant="secondary">Pending Approval</Badge>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <InfoRow
              icon={User}
              label="Requested By"
              value={approval.requestBy}
            />

            <InfoRow
              icon={Clock3}
              label="Submitted"
              value={format(new Date(approval.createdAt), "PPP p")}
            />
          </div>

          <div className="mt-3 rounded-lg border bg-background p-3">
            <p className="mb-1 text-xs text-muted-foreground">Reason</p>
            <p className="whitespace-pre-wrap text-sm">{approval.reason}</p>
          </div>
        </div>

        {/* Tradie */}
        <div>
          <h3 className="mb-3 font-semibold">Tradie Details</h3>

          <div className="grid gap-3 md:grid-cols-2">
            <InfoRow icon={User} label="Tradie" value={approval.tradie.name} />

            <InfoRow
              icon={Hammer}
              label="Trade"
              value={approval.tradie.trade}
            />

            <InfoRow
              icon={FileText}
              label="Phone"
              value={approval.tradie.phone}
            />

            <InfoRow
              icon={FileText}
              label="Email"
              value={approval.tradie.email}
            />
          </div>
        </div>

        {/* Schedule */}
        <div>
          <h3 className="mb-3 font-semibold">Schedule Details</h3>

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
              label="Start Date"
              value={format(
                new Date(approvalData.scheduledDate),
                "EEEE, dd MMM yyyy",
              )}
            />

            <InfoRow
              icon={Clock3}
              label="Duration"
              value={`${approvalData.durationDays} day${
                approvalData.durationDays > 1 ? "s" : ""
              }`}
            />

            <InfoRow
              icon={DollarSign}
              label="Quoted Cost"
              value={`$${approvalData.cost}`}
            />
          </div>
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-2 border-t pt-5">
          <Button
            variant="outline"
            disabled={mutation.isPending}
            onClick={() => submit("rejected")}
          >
            Reject Request
          </Button>

          <Button
            disabled={mutation.isPending}
            onClick={() => submit("approved")}
          >
            <CalendarPlus className="mr-2 size-4" />
            Approve Schedule
          </Button>
        </div>
      </div>
    </>
  );
}
