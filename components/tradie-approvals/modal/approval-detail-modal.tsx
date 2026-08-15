import { SafeTradieApproval } from "@/types/tradie";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Phone,
  Mail,
  Building2,
  DollarSign,
  Loader2,
  Check,
  X,
} from "lucide-react";
import { TradieBadge } from "@/components/tradie-management/trade-badge";
import { Button } from "@/components/ui/button";
import { useTransition } from "react";

interface ApprovalDetailModalProps {
  open: boolean;
  onApprove: () => Promise<void>;
  onReject: () => void;
  onClose: () => void;
  approval: SafeTradieApproval;
}

export function ApprovalDetailModal({
  open,
  onApprove,
  onReject,
  onClose,
  approval,
}: ApprovalDetailModalProps) {
  const [isPending, startTransition] = useTransition();
  const handleOpenChange = (isOpen: boolean) => {
    if (!isOpen) onClose();
  };

  const getStatusVariant = () => {
    switch (approval.status) {
      case "APPROVED":
        return "bg-green-100 text-green-700";
      case "REJECTED":
        return "bg-red-100 text-red-700";
      default:
        return "bg-yellow-100 text-yellow-700";
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-3xl p-0">
        <DialogHeader className="border-b px-6 py-4">
          <div className="flex items-center gap-4">
            <DialogTitle className="text-lg font-semibold">
              Approval Request
            </DialogTitle>

            <Badge className={getStatusVariant()}>{approval.status}</Badge>
          </div>
        </DialogHeader>

        <div className="space-y-6 p-6 max-h-120 overflow-y-auto no-scrollbar">
          {/* Approval Info */}
          <div>
            <h3 className="mb-3 text-sm font-semibold text-muted-foreground">
              Approval Information
            </h3>

            <div className="grid gap-4 sm:grid-cols-2">
              <InfoItem
                label="Action Type"
                value={approval.actionType.replaceAll("_", " ")}
              />

              <InfoItem label="Requested By" value={approval.requestBy} />

              <InfoItem
                label="Created"
                value={new Date(approval.createdAt).toLocaleString()}
              />

              <InfoItem
                label="Updated"
                value={new Date(approval.updatedAt).toLocaleString()}
              />
            </div>
          </div>

          <Separator />

          {/* Tradie Details */}
          <div>
            <h3 className="mb-3 text-sm font-semibold text-muted-foreground">
              Tradie Details
            </h3>

            <div className="rounded-lg border bg-muted/30 p-4">
              <div className="flex items-start justify-between">
                <div>
                  <h4 className="text-lg font-semibold">
                    {approval.tradie.name}
                  </h4>

                  <div className="mt-2">
                    <TradieBadge trade={approval.tradie.trade} />
                  </div>
                </div>
              </div>

              <div className="mt-6 grid gap-4 sm:grid-cols-2">
                <DetailRow
                  icon={<Mail className="h-4 w-4" />}
                  label="Email"
                  value={approval.tradie.email}
                />

                <DetailRow
                  icon={<Phone className="h-4 w-4" />}
                  label="Phone"
                  value={approval.tradie.phone}
                />

                <DetailRow
                  icon={<Building2 className="h-4 w-4" />}
                  label="ABN"
                  value={approval.tradie.abn}
                />

                <DetailRow
                  icon={<DollarSign className="h-4 w-4" />}
                  label="Last Quoted Price"
                  value={
                    approval.tradie.lastQuotedPrice
                      ? `$${approval.tradie.lastQuotedPrice}`
                      : "-"
                  }
                />
              </div>

              {approval.tradie.note && (
                <div className="mt-4 rounded-md border bg-background p-3">
                  <p className="text-sm font-medium">Notes</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {approval.tradie.note}
                  </p>
                </div>
              )}
            </div>
          </div>

          <Separator />

          {/* Reason */}
          <div>
            <h3 className="mb-3 text-sm font-semibold text-muted-foreground">
              Approval Reason
            </h3>

            <div className="rounded-lg border bg-muted/20 p-4">
              <p className="text-sm leading-relaxed">{approval.reason}</p>
            </div>
          </div>

          {/* JSON Changes Preview */}
          {approval.updationData && (
            <div>
              <h3 className="mb-3 text-sm font-semibold text-muted-foreground">
                Requested Changes
              </h3>

              <pre className="max-h-72 overflow-auto rounded-lg border bg-slate-950 p-4 text-xs text-slate-100">
                {JSON.stringify(approval.updationData, null, 2)}
              </pre>
            </div>
          )}

          {/* Rejection Reason */}
          {approval.rejectionReason && (
            <div>
              <h3 className="mb-3 text-sm font-semibold text-muted-foreground">
                Rejection Reason
              </h3>

              <div className="rounded-lg border bg-muted/20 p-4">
                <p className="text-sm leading-relaxed">
                  {approval.rejectionReason}
                </p>
              </div>
            </div>
          )}
        </div>

        <div className="flex bg-muted rounded-b-lg items-center justify-end gap-2 border-t px-6 py-4">
          <Button
            size="sm"
            variant="destructive"
            onClick={onReject}
            disabled={approval.status !== "PENDING"}
          >
            <X className="mr-1 h-4 w-4" />
            Reject
          </Button>
          <Button
            size="sm"
            onClick={() => startTransition(onApprove)}
            disabled={isPending || approval.status !== "PENDING"}
          >
            {isPending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Approving...
              </>
            ) : (
              <>
                <Check className="h-4 w-4" />
                Approve
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
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
