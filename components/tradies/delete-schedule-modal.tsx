"use client";

import { AlertOctagon, CalendarX, Loader2, Send } from "lucide-react";

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
import { toast } from "sonner";
import { fetchJson } from "@/utils/fetch";
import { dateFormat } from "@/utils/formatters";

const MAX_REASON_LENGTH = 500;

export interface DeleteScheduleTarget {
  id: string;
  tradieName: string;
  tradeType: string;
  projectName: string;
  /** Date the tradie is booked for, as an ISO string. */
  scheduledDate: string;
}

interface DeleteScheduleModalProps {
  open: boolean;
  schedule: DeleteScheduleTarget;
  onClose: () => void;
  onSuccess?: () => void;
}

/**
 * Collects the reason a booked tradie schedule should be removed and submits
 * it for admin approval.
 *
 * Deleting outright is deliberately not an option here: the tradie has already
 * been contacted about this date, so the request goes to an admin and the
 * booking stays in place until they approve it.
 */
export function DeleteScheduleModal({
  open,
  schedule,
  onClose,
  onSuccess,
}: DeleteScheduleModalProps) {
  const [reason, setReason] = useState("");
  const [isPending, startTransition] = useTransition();

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      setReason("");
      onClose();
    }
  };

  const handleSubmit = async () => {
    const trimmedReason = reason.trim();

    if (!trimmedReason) {
      toast.error("Please provide a reason for the removal.");
      return;
    }

    try {
      const response = await fetchJson<{
        success: boolean;
        message: string;
        approvalId?: string;
      }>(
        `/api/tradie-schedules/${schedule.id}`,
        {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reason: trimmedReason }),
        },
        "Failed to submit the removal request",
      );

      // The envelope is `success` for any 200 — whether the request was
      // actually raised is the inner flag, and reading the outer one reported
      // success for refusals such as an already-pending request.
      if (!response.data.success) {
        throw new Error(
          response.data.message || "Failed to submit the removal request",
        );
      }

      toast.success("Removal request submitted for admin approval.");
      setReason("");
      onSuccess?.();
      onClose();
    } catch (error) {
      console.error("Error requesting schedule deletion:", error);
      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to submit the removal request. Please try again.",
      );
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-115">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive">
            <CalendarX className="h-5 w-5" aria-hidden="true" />
            Remove {schedule.tradieName}&apos;s booking
          </DialogTitle>

          <DialogDescription>
            {schedule.tradeType} &middot; {schedule.projectName} &middot;{" "}
            {dateFormat.format(new Date(schedule.scheduledDate))}
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
                  The booking stays on the project until an admin reviews this
                  request. Nothing is removed and no one is stood down yet.
                </p>
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="delete-schedule-reason">
              Reason for removal
              <span className="text-destructive">
                *<span className="sr-only"> required</span>
              </span>
            </Label>

            <Textarea
              id="delete-schedule-reason"
              rows={4}
              maxLength={MAX_REASON_LENGTH}
              required
              placeholder="Explain why this booking should be removed…"
              value={reason}
              aria-describedby="delete-schedule-reason-count"
              onChange={(e) => setReason(e.target.value)}
            />

            <p
              id="delete-schedule-reason-count"
              className="text-xs text-muted-foreground"
            >
              {reason.length}/{MAX_REASON_LENGTH} characters
            </p>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button
              variant="outline"
              onClick={() => handleOpenChange(false)}
              disabled={isPending}
            >
              Cancel
            </Button>

            <Button
              variant="destructive"
              onClick={() => startTransition(handleSubmit)}
              disabled={isPending || !reason.trim()}
            >
              {isPending ? (
                <>
                  <Loader2
                    className="mr-2 h-4 w-4 animate-spin motion-reduce:animate-none"
                    aria-hidden="true"
                  />
                  Submitting…
                </>
              ) : (
                <>
                  <Send className="mr-2 h-4 w-4" aria-hidden="true" />
                  Submit for approval
                </>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
