"use client";

import { Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import {
  ContactPicker,
  type ContactOption,
} from "@/components/modals/compliance/contact-picker";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CERTIFIER_TRADE_LABEL } from "@/constants/complianceDocuments";
import { useAppDispatch, useAppSelector } from "@/lib/store/hooks";
import {
  complianceScope,
  selectComplianceMutation,
  startCertifierEngagement,
} from "@/lib/store/slices/projectsSlice";

type StartCertifierEngagementModalProps = {
  projectId: string;
  defaultAddress: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/**
 * Opens the engagement.
 *
 * The certifier is picked from the tradie directory rather than typed in. Every
 * message on this job goes to that address and every reply is correlated back
 * through it, so a typo is not a typo — it is a thread that silently never
 * answers, discovered weeks later when a document that was supposed to arrive
 * has not. The directory already holds the address, checked, and the same
 * picker engages the surveyor and the architect.
 *
 * The site address stays a free-text field, prefilled from the project. It is
 * the human half of every subject line and the fallback the inbound
 * correlation runs on when a certifier's office retypes the subject, so it has
 * to be exactly what they will call the job — which is not always what the
 * project record calls it.
 */
export function StartCertifierEngagementModal({
  projectId,
  defaultAddress,
  open,
  onOpenChange,
}: StartCertifierEngagementModalProps) {
  const dispatch = useAppDispatch();
  // Only this engagement's own scope: the modal opens before anything else on
  // the compliance file exists, but the store is shared with a tab that may
  // still be finishing a write on another project's behalf.
  const mutation = useAppSelector(
    selectComplianceMutation(complianceScope.engagement),
  );
  const isPending = mutation.status === "pending";

  const [certifier, setCertifier] = useState<ContactOption | null>(null);
  const [subjectAddress, setSubjectAddress] = useState(defaultAddress ?? "");

  const handleSubmit = async (event: React.SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!certifier) return;

    try {
      await dispatch(
        startCertifierEngagement({
          projectId,
          subjectAddress: subjectAddress.trim(),
          certifierEmail: certifier.email.trim().toLowerCase(),
          certifierName: certifier.name || undefined,
          certifierPhone: certifier.phone ?? undefined,
        }),
      ).unwrap();
      toast.success("Certifier engagement started.");
      onOpenChange(false);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Could not start the engagement.",
      );
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Connect with Certifier</DialogTitle>
            <DialogDescription>
              Every message on this job goes to this address, and every reply is
              matched back by a reference in the subject line.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="certifier-contact">Certifier</Label>
              <ContactPicker
                id="certifier-contact"
                trade={CERTIFIER_TRADE_LABEL}
                label="Certifier"
                value={certifier}
                onChange={setCertifier}
                disabled={isPending}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="subject-address">Site address</Label>
              <Input
                id="subject-address"
                required
                value={subjectAddress}
                onChange={(event) => setSubjectAddress(event.target.value)}
                disabled={isPending}
              />
              <p className="text-xs text-muted-foreground">
                Appears in the subject line so the certifier can tell this job
                from the others on their desk.
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={isPending || !certifier || !subjectAddress.trim()}
            >
              {isPending ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : null}
              Start engagement
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
