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
import { useAppSelector } from "@/lib/store/hooks";
import {
  externalApplication,
  type ComplianceExternalApplicationRecord,
} from "@/types/compliance";

type ApplicationModalProps = {
  projectId: string;
  kind: ComplianceExternalApplicationKind;
  /**
   * The record as it stood when the dialog opened.
   *
   * A fallback rather than the source. `ModalManager` freezes `modal.payload`
   * at open, so this goes stale the moment anything here saves — the thunk
   * refreshes the engagement in the store and the dialog carried on rendering
   * the record from before it. An admin answered "Do you already have the
   * 10.7?", saw the success toast, and was asked the same question again while
   * the row behind the dialog moved on without them.
   */
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

  // The live row, so the block re-reads its own step after every save. Falls
  // back to the snapshot for the one render before the store has this project,
  // which is the only moment the two can differ in the other direction.
  const engagement = useAppSelector((state) =>
    state.projects.activeProject?.id === projectId
      ? state.projects.activeProject.certifierEngagement
      : null,
  );
  const current = engagement
    ? externalApplication(engagement, kind)
    : application;

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
            application={current}
            portalUrl={portalUrl}
            documentRows={null}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
