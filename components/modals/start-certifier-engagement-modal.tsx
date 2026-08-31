"use client";

import { Loader2 } from "lucide-react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
 * The certifier's email is the one field with no sensible default — everything
 * afterwards is a thread with that address, and there is nowhere else in the
 * system it can be read from today. The address is prefilled from the project
 * because it is what goes in every subject line, and getting it wrong is
 * awkward to correct once the thread is running.
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

  const [certifierName, setCertifierName] = useState("");
  const [certifierEmail, setCertifierEmail] = useState("");
  const [certifierPhone, setCertifierPhone] = useState("");
  const [subjectAddress, setSubjectAddress] = useState(defaultAddress ?? "");

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    try {
      await dispatch(
        startCertifierEngagement({
          projectId,
          subjectAddress: subjectAddress.trim(),
          certifierEmail: certifierEmail.trim().toLowerCase(),
          certifierName: certifierName.trim() || undefined,
          certifierPhone: certifierPhone.trim() || undefined,
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
              <Label htmlFor="certifier-email">Certifier email</Label>
              <Input
                id="certifier-email"
                type="email"
                required
                value={certifierEmail}
                onChange={(event) => setCertifierEmail(event.target.value)}
                placeholder="certifier@example.com.au"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="certifier-name">Certifier name</Label>
              <Input
                id="certifier-name"
                value={certifierName}
                onChange={(event) => setCertifierName(event.target.value)}
                placeholder="Optional"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="certifier-phone">Certifier phone</Label>
              <Input
                id="certifier-phone"
                value={certifierPhone}
                onChange={(event) => setCertifierPhone(event.target.value)}
                placeholder="Optional"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="subject-address">Site address</Label>
              <Input
                id="subject-address"
                required
                value={subjectAddress}
                onChange={(event) => setSubjectAddress(event.target.value)}
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
              disabled={isPending || !certifierEmail.trim() || !subjectAddress.trim()}
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
