"use client";

import { CheckCircle2, Loader2, Send } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAppDispatch } from "@/lib/store/hooks";
import { sendComplianceForReview } from "@/lib/store/slices/projectsSlice";

type ComplianceCompleteModalProps = {
  projectId: string;
  documentCount: number;
  /** True on a re-send, after the certifier sent something back. */
  isResend: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/**
 * The prompt that closes out the collection phase.
 *
 * Opened by the upload that completes the set, and reachable again from the
 * banner on the tab — the same modal serves the first send and every re-send
 * after a round of rejections, because from the certifier's side they are the
 * same act.
 *
 * Sending is a deliberate click rather than something that happens on the
 * upload: it puts every document beyond the admin's reach until the certifier
 * answers, which is not a thing to do to someone by surprise.
 */
export function ComplianceCompleteModal({
  projectId,
  documentCount,
  isResend,
  open,
  onOpenChange,
}: ComplianceCompleteModalProps) {
  const dispatch = useAppDispatch();
  const [isSending, setIsSending] = useState(false);

  const handleSend = async () => {
    setIsSending(true);
    try {
      await dispatch(sendComplianceForReview({ projectId })).unwrap();
      toast.success("Sent to the certifier for review.");
      onOpenChange(false);
    } catch (error) {
      toast.error(
        typeof error === "string"
          ? error
          : error instanceof Error
            ? error.message
            : "Could not send the file to the certifier.",
      );
    } finally {
      setIsSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CheckCircle2
              className="size-5 text-success-ink"
              aria-hidden="true"
            />
            Compliance and Certification complete
          </DialogTitle>
          <DialogDescription>
            {isResend
              ? `Everything the certifier sent back has been re-supplied. All ${documentCount} documents are ready to go again.`
              : `All ${documentCount} documents are collected. Sending them puts the file with the certifier for review — nothing can be changed until they answer.`}
          </DialogDescription>
        </DialogHeader>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={isSending}
            onClick={() => onOpenChange(false)}
          >
            Not yet
          </Button>
          <Button type="button" disabled={isSending} onClick={() => void handleSend()}>
            {isSending ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <Send className="size-4" aria-hidden="true" />
            )}
            {isResend ? "Re-send to Certifier" : "Send it to Certifier"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
