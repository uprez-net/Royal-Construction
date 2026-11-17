import { useState } from "react";
import { useApprovalMutation } from "@/hooks/use-approval-mutation";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  SafeTradieApproval,
  TradeCancellationJsonPayload,
} from "@/types/tradie";
import { TradieApprovalActionType } from "@prisma/client";
import { DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertOctagon,
  Briefcase,
  CalendarX,
  Clock3,
  Hammer,
  Loader2,
  Mail,
  Phone,
  User,
  UserMinus,
  LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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

/**
 * Release the tradie selected for a whole trade on a project. Approving
 * cancels every open booking they hold there; rejecting keeps them selected.
 */
export function TradeCancellationApprovalForm({ approval, onSuccess }: Props) {
  const data = approval.updationData as TradeCancellationJsonPayload;
  const mutation = useApprovalMutation(onSuccess);
  const [rejectReason, setRejectReason] = useState("");

  const submit = (resolution: "approved" | "rejected") => {
    mutation.mutate({
      approvalId: approval.id,
      type: TradieApprovalActionType.TRADE_CANCELLATION,
      resolution,
      payload: undefined,
      rejectReason: resolution === "rejected" ? rejectReason.trim() : undefined,
    });
  };

  const bookings = data?.openBookings ?? 0;

  return (
    <>
      <DialogHeader className="pb-4 pr-10">
        <DialogTitle className="flex items-center gap-2">
          <UserMinus className="size-5 text-destructive" aria-hidden="true" />
          Review trade cancellation
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
                Approving releases {approval.tradie.name} from{" "}
                {data?.trade ?? "this trade"}
              </h4>
              <p className="text-xs leading-relaxed text-foreground/80">
                Their {bookings} open {bookings === 1 ? "booking" : "bookings"}{" "}
                on the project {bookings === 1 ? "is" : "are"} cancelled, and
                any approval still pending on them is withdrawn. The tradie is
                not emailed. Rejecting keeps them selected and changes nothing.
              </p>
            </div>
          </div>
        </div>

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
              Reason for cancelling
            </p>
            <p className="whitespace-pre-wrap text-sm">{approval.reason}</p>
          </div>
        </div>

        <div>
          <h3 className="mb-3 font-semibold">Selection</h3>
          <div className="grid gap-3 md:grid-cols-2">
            <InfoRow
              icon={Briefcase}
              label="Project"
              value={data?.projectName || "Unknown project"}
            />
            <InfoRow
              icon={Hammer}
              label="Trade"
              value={data?.trade || approval.tradie.trade}
            />
            <InfoRow icon={User} label="Tradie" value={approval.tradie.name} />
            <InfoRow
              icon={Phone}
              label="Phone"
              value={approval.tradie.phone}
              mono
            />
            <InfoRow icon={Mail} label="Email" value={approval.tradie.email} />
            <InfoRow
              icon={CalendarX}
              label="Open bookings when asked"
              value={bookings}
              mono
            />
          </div>
        </div>

        {approval.status === "PENDING" && (
          <div className="space-y-1.5 border-t border-border/70 pt-5">
            <Label htmlFor="trade-cancellation-reject-reason">
              Reason for keeping the tradie
              <span className="text-destructive">
                *<span className="sr-only"> required</span>
              </span>
            </Label>
            <Textarea
              id="trade-cancellation-reject-reason"
              rows={2}
              maxLength={1000}
              required
              aria-required="true"
              aria-describedby="trade-cancellation-reject-reason-hint"
              value={rejectReason}
              onChange={(event) => setRejectReason(event.target.value)}
            />
            <p
              id="trade-cancellation-reject-reason-hint"
              className="text-xs text-muted-foreground"
            >
              Required to keep the tradie. The requester sees this reason.
            </p>
          </div>
        )}

        {approval.status === "PENDING" && (
          <div className="grid gap-2 sm:flex sm:justify-end">
            <Button
              variant="outline"
              disabled={mutation.isPending || !rejectReason.trim()}
              onClick={() => submit("rejected")}
            >
              Keep tradie
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
                  <UserMinus className="mr-2 size-4" aria-hidden="true" />
                  Approve cancellation
                </>
              )}
            </Button>
          </div>
        )}
      </div>
    </>
  );
}
