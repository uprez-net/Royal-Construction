"use client";

import { ComplianceExternalApplicationKind } from "@prisma/client";

import { ExternalApplicationBlock } from "@/components/projects/detail/compliance-tab/external-application-block";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EXTERNAL_APPLICATION_COPY } from "@/constants/complianceDocuments";
import type { ComplianceExternalApplicationRecord } from "@/types/compliance";

type ApplicationModalProps = {
  projectId: string;
  kind: ComplianceExternalApplicationKind;
  application: ComplianceExternalApplicationRecord | null;
  /** The portal link, where it depends on the project's council. */
  portalUrl?: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/**
 * The application block, in a dialog, for the checklist.
 *
 * The development application list has room to render these blocks inline; a
 * checklist row does not. A row is one line with a control on the right, and
 * the block is a small state machine with a form in it — putting one inside
 * every checklist line asking for a levy receipt or a road opening permit would
 * turn a twenty-row list into a page nobody could scan.
 *
 * So the row gets a button and the block gets a dialog, and it is the same
 * block: the steps, the clock and the persistence are identical whether the
 * document is being chased off a certifier's checklist or off a DA, and two
 * copies of that state machine would be two things to keep in step.
 *
 * The file itself is uploaded on the row underneath, not here. The dialog
 * deliberately passes no document rows — closing a dialog to find the row you
 * were looking at is worse than the row simply being where it always was.
 */
export function ApplicationModal({
  projectId,
  kind,
  application,
  portalUrl,
  open,
  onOpenChange,
}: ApplicationModalProps) {
  const copy = EXTERNAL_APPLICATION_COPY[kind];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{copy.label}</DialogTitle>
          <DialogDescription>
            Record where this is up to. The date is what lets us tell you when{" "}
            {copy.portal} has taken longer than {copy.turnaround}; upload the
            document itself on the row behind this.
          </DialogDescription>
        </DialogHeader>

        <div className="py-2">
          <ExternalApplicationBlock
            projectId={projectId}
            kind={kind}
            application={application}
            portalUrl={portalUrl}
            documentRows={null}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
