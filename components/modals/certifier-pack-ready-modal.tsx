"use client";

import { CheckCircle2, RefreshCw, Send } from "lucide-react";

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
import { openModal } from "@/lib/store/slices/uiSlice";

type CertifierPackReadyModalProps = {
  projectId: string;
  /** How many documents the required pack has in total. */
  documentCount: number;
  /** How many of them the certifier has not been sent the current copy of. */
  updatedCount: number;
  /** True once the pack has gone at least once, so this send is a follow-up. */
  isResend: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/**
 * The prompt that opens when the required pack becomes whole.
 *
 * It sends nothing itself. The one button hands straight to the discovery
 * modal — the same thing the "Find and send documents" button on the tab
 * opens — because that is where the send already lives, with its per-document
 * progress and its own retry. Duplicating the send here would mean two paths
 * to the certifier that have to be kept saying the same thing.
 *
 * It reads differently on a follow-up, and the difference is not decoration:
 * the first send opens the engagement, while the second is a correction to a
 * pack the certifier is already working from — they are reading a superseded
 * document until it goes, which is the fact worth putting in front of someone.
 */
export function CertifierPackReadyModal({
  projectId,
  documentCount,
  updatedCount,
  isResend,
  open,
  onOpenChange,
}: CertifierPackReadyModalProps) {
  const dispatch = useAppDispatch();

  // Opening a modal replaces whatever is open, so this closes itself on the
  // way through rather than racing its own dismissal.
  const handleSend = () =>
    dispatch(
      openModal({
        type: "certifierDiscovery",
        payload: { projectId },
      }),
    );

  const plural = updatedCount === 1 ? "" : "s";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {isResend ? (
              <RefreshCw className="size-5 text-primary" aria-hidden="true" />
            ) : (
              <CheckCircle2
                className="size-5 text-success-ink"
                aria-hidden="true"
              />
            )}
            {isResend
              ? "Updated documents ready to send"
              : "Required documents collected"}
          </DialogTitle>
          <DialogDescription>
            {isResend
              ? `${updatedCount} of the required documents ${
                  updatedCount === 1 ? "has" : "have"
                } been replaced since the pack went to the certifier. They are working from the old cop${
                  updatedCount === 1 ? "y" : "ies"
                } until the updated one${plural} ${
                  updatedCount === 1 ? "is" : "are"
                } sent.`
              : `All ${documentCount} required documents are on the job. Sending them opens the engagement — the certifier gets the pack and comes back with their fee proposal, CDC application form and checklist.`}
          </DialogDescription>
        </DialogHeader>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            Not yet
          </Button>
          <Button type="button" onClick={handleSend}>
            <Send className="size-4" aria-hidden="true" />
            {isResend ? "Send updated documents" : "Find and send documents"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
