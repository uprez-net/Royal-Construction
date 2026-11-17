"use client";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import type { SafeTradieApproval } from "@/types/tradie";
import {
  cancelsBookings,
  cancellationSummary,
} from "@/lib/store/slices/tradieApprovalSlice";

/**
 * Confirms an approval that cancels bookings before it is sent. Names each
 * cancelling request, so the office reads what it is about to cancel.
 */
export function ApproveConfirmDialog({
  requests,
  onCancel,
  onConfirm,
}: {
  requests: SafeTradieApproval[];
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const many = requests.length > 1;
  const cancelling = requests.filter(cancelsBookings);

  return (
    <AlertDialog
      open={requests.length > 0}
      onOpenChange={(open) => !open && onCancel()}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {many
              ? `Approve ${requests.length} requests?`
              : "Approve this request?"}
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2">
              {many ? (
                <p>{cancelling.length} of these cancel bookings:</p>
              ) : null}
              <ul className="list-disc space-y-1 pl-5">
                {cancelling.map((request) => (
                  <li key={request.id}>{cancellationSummary(request)}</li>
                ))}
              </ul>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Back</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>
            {many ? `Approve ${requests.length}` : "Approve"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
