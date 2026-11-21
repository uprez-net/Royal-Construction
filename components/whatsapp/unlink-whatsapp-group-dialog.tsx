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

/**
 * "Unlink this group?" — shared by the project header and Admin › WhatsApp
 * bridge. Says plainly what unlinking does and does not do, because the
 * people in the group never see it happen.
 */
export function UnlinkWhatsAppGroupDialog({
  open,
  subject,
  projectName,
  pending,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  subject: string;
  projectName?: string | null;
  pending: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Unlink “{subject}”?</AlertDialogTitle>
          <AlertDialogDescription>
            New messages in this group stop coming into{" "}
            {projectName ? `“${projectName}”` : "this project"}. The messages so
            far stay on the project, and the group itself is untouched in
            WhatsApp — nobody in it is told. You can link it again, or link it
            to a different project.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
          <AlertDialogAction disabled={pending} onClick={onConfirm}>
            {pending ? "Unlinking…" : "Unlink group"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
