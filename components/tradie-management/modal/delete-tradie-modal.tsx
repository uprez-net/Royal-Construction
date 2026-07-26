import { AlertOctagon, Send, Trash2 } from "lucide-react";

import { TradieRow } from "@/types/tradie";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

import { useState, useTransition } from "react";
import { useAppDispatch } from "@/lib/store/hooks";
import { toast } from "sonner";
import { deleteTradieThunk } from "@/lib/store/slices/tradieManagementSlice";

interface DeleteTradieModalProps {
  open: boolean;
  tradie: TradieRow;
  onClose: () => void;
}

export default function DeleteTradieModal({
  open,
  tradie,
  onClose,
}: DeleteTradieModalProps) {
  const dispatch = useAppDispatch();
  const [isPending, startTransition] = useTransition();
  const [reason, setReason] = useState("");

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      onClose();
      setReason("");
    }
  };

  const handleSubmit = () => {
    if (!reason.trim()) {
      toast.error("Please provide a reason for deletion.");
      return;
    }

    startTransition(async () => {
      try {
        await dispatch(
          deleteTradieThunk({
            tradieId: tradie.id,
            reason,
          }),
        ).unwrap();

        toast.success("Deletion request submitted successfully.");

        setReason("");
        onClose();
      } catch (error) {
        toast.error("Error deleting tradie. Please try again.");

        console.error("Error deleting tradie:", error);
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-115">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive">
            <Trash2 className="h-5 w-5" aria-hidden="true" />
            Delete {tradie.name}
          </DialogTitle>

          <DialogDescription>
            {tradie.trade} &middot; requesting permanent removal from the active
            tradie list.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-lg border border-destructive/20 bg-destructive-light p-4">
            <div className="flex gap-3">
              <AlertOctagon
                className="mt-0.5 h-5 w-5 shrink-0 text-destructive-ink"
                aria-hidden="true"
              />

              <div>
                <h4 className="mb-1 text-sm font-semibold text-destructive-ink">
                  This action requires approval
                </h4>

                <p className="text-xs leading-relaxed text-foreground/80">
                  You are requesting to permanently delete {tradie.name}&apos;s
                  profile from the active list. This request is submitted for
                  review and confirmation before any action is taken.
                </p>
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="delete-tradie-reason">
              Reason for deletion
              <span className="text-destructive">
                *<span className="sr-only"> required</span>
              </span>
            </Label>

            <Textarea
              id="delete-tradie-reason"
              rows={4}
              maxLength={500}
              required
              placeholder="Explain why this tradie should be removed…"
              value={reason}
              aria-describedby="delete-tradie-reason-count"
              onChange={(e) => setReason(e.target.value)}
            />

            <p
              id="delete-tradie-reason-count"
              className="text-xs text-muted-foreground"
            >
              {reason.length}/500 characters
            </p>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={onClose} disabled={isPending}>
              Cancel
            </Button>

            <Button
              variant="destructive"
              onClick={handleSubmit}
              disabled={isPending || !reason.trim()}
            >
              <Send className="mr-2 h-4 w-4" aria-hidden="true" />

              {isPending ? "Submitting…" : "Submit for approval"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
