"use client";

import { Download, Loader2, ShieldCheck } from "lucide-react";
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
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  closeChecklistAction,
  verifyChecklistIssueAction,
} from "@/lib/data/checklist-actions";

import { rememberReviewerName } from "./checklist-client";
import {
  RefusalAlert,
  ReviewerFields,
  useReviewer,
} from "./checklist-reviewer-fields";

// The dialogs that capture a reviewer's signature: downloading a checklist,
// closing it, and verifying an issue. Each shows the server's refusal in place
// rather than closing, because that refusal is the operator's next step.

function DownloadChecklistDialogBody({
  open,
  onOpenChange,
  projectId,
  checklist,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  checklist: {
    readonly id: string;
    readonly title: string;
    readonly closed: boolean;
    readonly configured: boolean;
  };
}) {
  const reviewer = useReviewer();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generate = async () => {
    setError(null);
    if (!reviewer.name.trim()) return setError("Enter the reviewer's name.");
    if (!reviewer.signature) return setError("Draw or upload the signature.");
    setPending(true);
    try {
      const response = await fetch(
        `/api/projects/${encodeURIComponent(projectId)}/checklists/${encodeURIComponent(checklist.id)}/export`,
        {
          body: JSON.stringify({
            reviewerName: reviewer.name.trim(),
            signatureDataUrl: reviewer.signature,
          }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        },
      );
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as {
          error?: string;
          message?: string;
        } | null;
        throw new Error(
          body?.error
            ?? body?.message
            ?? "The checklist document could not be generated.",
        );
      }
      const disposition = response.headers.get("Content-Disposition") ?? "";
      const filename =
        /filename="([^"]+)"/.exec(disposition)?.[1] ?? "checklist.pdf";
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      rememberReviewerName(reviewer.name.trim());
      toast.success(
        checklist.closed
          ? "Final checklist downloaded."
          : "Draft checklist downloaded.",
      );
      onOpenChange(false);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The checklist document could not be generated.",
      );
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Download checklist</DialogTitle>
          <DialogDescription>{checklist.title}</DialogDescription>
        </DialogHeader>
        {!checklist.configured ? (
          <p className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
            This checklist has no inspection items yet. It downloads as a blank,
            labelled template and records nothing as inspected.
          </p>
        ) : !checklist.closed ? (
          <p className="rounded-md bg-warning-light px-3 py-2 text-sm text-warning-ink">
            This checklist is not closed, so the document is marked{" "}
            <strong>DRAFT</strong> on every page. Downloading it does not close
            it.
          </p>
        ) : (
          <p className="rounded-md bg-success-light px-3 py-2 text-sm text-success-ink">
            Closed and signed off: this downloads as the final document.
          </p>
        )}
        <ReviewerFields
          idPrefix="download"
          name={reviewer.name}
          onName={reviewer.setName}
          signature={reviewer.signature}
          onSignature={reviewer.setSignature}
          disabled={pending}
        />
        <RefusalAlert message={error} />
        <DialogFooter>
          <Button
            variant="outline"
            disabled={pending}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button disabled={pending} onClick={generate}>
            {pending ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <Download className="size-4" aria-hidden="true" />
            )}
            Generate PDF
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CloseChecklistDialogBody({
  open,
  onOpenChange,
  projectId,
  checklistId,
  title,
  version,
  onClosed,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  checklistId: string;
  title: string;
  version: number;
  onClosed: () => void;
}) {
  const reviewer = useReviewer();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    if (!reviewer.name.trim()) return setError("Enter the reviewer's name.");
    if (!reviewer.signature) return setError("Draw or upload the signature.");
    setPending(true);
    const result = await closeChecklistAction({
      checklistId,
      expectedVersion: version,
      projectId,
      reviewerName: reviewer.name.trim(),
      signatureDataUrl: reviewer.signature,
    }).catch(() => null);
    setPending(false);
    if (!result)
      return setError("The checklist could not be closed. Try again.");
    if (!result.ok) return setError(result.error);
    rememberReviewerName(reviewer.name.trim());
    toast.success(`${title} closed and signed off.`);
    onClosed();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Close and sign off</DialogTitle>
          <DialogDescription>
            Every inspection item is reviewed and every issue is verified. Sign
            to close {title}. It becomes read-only until an admin reopens it.
          </DialogDescription>
        </DialogHeader>
        <ReviewerFields
          idPrefix="close"
          name={reviewer.name}
          onName={reviewer.setName}
          signature={reviewer.signature}
          onSignature={reviewer.setSignature}
          disabled={pending}
        />
        <RefusalAlert message={error} />
        <DialogFooter>
          <Button
            variant="outline"
            disabled={pending}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button disabled={pending} onClick={submit}>
            {pending ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <ShieldCheck className="size-4" aria-hidden="true" />
            )}
            Close checklist
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function VerifyIssueDialogBody({
  open,
  onOpenChange,
  projectId,
  issue,
  onVerified,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  issue: {
    readonly id: string;
    readonly number: number;
    readonly location: string;
  };
  onVerified: () => void;
}) {
  const reviewer = useReviewer();
  const [note, setNote] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    if (!reviewer.name.trim()) return setError("Enter the reviewer's name.");
    if (!reviewer.signature) return setError("Draw or upload the signature.");
    setPending(true);
    const result = await verifyChecklistIssueAction({
      issueId: issue.id,
      note: note.trim() || null,
      projectId,
      reviewerName: reviewer.name.trim(),
      signatureDataUrl: reviewer.signature,
    }).catch(() => null);
    setPending(false);
    if (!result) return setError("The issue could not be verified. Try again.");
    if (!result.ok) return setError(result.error);
    rememberReviewerName(reviewer.name.trim());
    toast.success(`Issue #${issue.number} verified and signed off.`);
    onVerified();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Verify issue #{issue.number}</DialogTitle>
          <DialogDescription>
            {issue.location}. Confirm you have inspected the rectification and
            it is satisfactory.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="verify-note">Verification note (optional)</Label>
          <Textarea
            id="verify-note"
            value={note}
            maxLength={2000}
            rows={2}
            disabled={pending}
            onChange={(event) => setNote(event.target.value)}
          />
        </div>
        <ReviewerFields
          idPrefix="verify"
          name={reviewer.name}
          onName={reviewer.setName}
          signature={reviewer.signature}
          onSignature={reviewer.setSignature}
          disabled={pending}
        />
        <RefusalAlert message={error} />
        <DialogFooter>
          <Button
            variant="outline"
            disabled={pending}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button disabled={pending} onClick={submit}>
            {pending ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <ShieldCheck className="size-4" aria-hidden="true" />
            )}
            Verify and sign off
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function DownloadChecklistDialog(
  props: Parameters<typeof DownloadChecklistDialogBody>[0],
) {
  return props.open ? <DownloadChecklistDialogBody {...props} /> : null;
}

export function CloseChecklistDialog(
  props: Parameters<typeof CloseChecklistDialogBody>[0],
) {
  return props.open ? <CloseChecklistDialogBody {...props} /> : null;
}

export function VerifyIssueDialog(
  props: Parameters<typeof VerifyIssueDialogBody>[0],
) {
  return props.open ? <VerifyIssueDialogBody {...props} /> : null;
}
