"use client";

import { Download, Loader2, Mail, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { SignaturePad } from "@/components/common/signature-pad";
import { Alert, AlertDescription } from "@/components/ui/alert";
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
import { Textarea } from "@/components/ui/textarea";
import {
  closeChecklistAction,
  reopenChecklistAction,
  sendChecklistIssueEmailAction,
  verifyChecklistIssueAction,
} from "@/lib/data/checklist-actions";

import {
  formatDate,
  newRequestKey,
  rememberReviewerName,
  rememberedReviewerName,
} from "./checklist-client";

// The checklist's dialogs that capture a decision: a signature to close the
// checklist, verify an issue or name the reviewer on a download; a reason to
// reopen; and the email to a tradie. Each one shows the server's refusal in
// place rather than closing, because that refusal is the operator's next step.

// Each dialog's body mounts when it opens, so its fields start fresh every
// time without an effect resetting them.
function useReviewer() {
  const [name, setName] = useState(() => rememberedReviewerName());
  const [signature, setSignature] = useState<string | null>(null);
  return { name, setName, setSignature, signature };
}

function ReviewerFields({
  name,
  onName,
  signature,
  onSignature,
  disabled,
  idPrefix,
}: {
  name: string;
  onName: (value: string) => void;
  signature: string | null;
  onSignature: (value: string | null) => void;
  disabled?: boolean;
  idPrefix: string;
}) {
  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-reviewer`}>Reviewer name</Label>
        <Input
          id={`${idPrefix}-reviewer`}
          value={name}
          maxLength={120}
          autoComplete="name"
          disabled={disabled}
          onChange={(event) => onName(event.target.value)}
        />
      </div>
      <SignaturePad
        value={signature}
        onChange={onSignature}
        disabled={disabled}
      />
      <p className="text-sm text-muted-foreground">
        Date:{" "}
        <span className="font-medium text-foreground">
          {formatDate(new Date())}
        </span>{" "}
        (recorded automatically)
      </p>
    </div>
  );
}

function RefusalAlert({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <Alert variant="destructive" role="alert">
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  );
}

// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------

/** A required or optional note: reopening, sending back, a comment. */
function NoteDialogBody({
  open,
  onOpenChange,
  title,
  description,
  label,
  confirmLabel,
  required,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  label: string;
  confirmLabel: string;
  required: boolean;
  /** Answers the refusal to show, or null when it worked. */
  onSubmit: (note: string) => Promise<string | null>;
}) {
  const [note, setNote] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    if (required && !note.trim()) return setError(`${label} is required.`);
    setPending(true);
    const refusal = await onSubmit(note.trim()).catch(
      () => "That did not save. Try again.",
    );
    setPending(false);
    if (refusal) return setError(refusal);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="note-dialog-text">
            {label}
            {required ? "" : " (optional)"}
          </Label>
          <Textarea
            id="note-dialog-text"
            value={note}
            maxLength={2000}
            rows={3}
            disabled={pending}
            onChange={(event) => setNote(event.target.value)}
          />
        </div>
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
            ) : null}
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ReopenChecklistDialog({
  open,
  onOpenChange,
  projectId,
  checklistId,
  title,
  onReopened,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  checklistId: string;
  title: string;
  onReopened: () => void;
}) {
  return (
    <NoteDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Reopen ${title}`}
      description="Reopening takes back the sign-off so the checklist can be edited. The reason is kept in the project history."
      label="Reason"
      confirmLabel="Reopen checklist"
      required
      onSubmit={async (reason) => {
        const result = await reopenChecklistAction({
          checklistId,
          projectId,
          reason,
        });
        if (!result.ok) return result.error;
        toast.success(`${title} reopened.`);
        onReopened();
        return null;
      }}
    />
  );
}

// ---------------------------------------------------------------------------

/** Send, resend or retry the email to an issue's tradie. */
function IssueEmailDialogBody({
  open,
  onOpenChange,
  projectId,
  issue,
  initial,
  onSent,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  issue: {
    readonly id: string;
    readonly number: number;
    readonly tradieName: string;
    readonly tradieEmail: string;
    readonly photoCount: number;
  };
  initial: { readonly subject: string; readonly body: string };
  onSent: () => void;
}) {
  const [subject, setSubject] = useState(initial.subject);
  const [body, setBody] = useState(initial.body);
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // One key per opening: a double-click or a retry after a timeout replays
  // this attempt instead of emailing the tradie twice.
  const [attemptKey, setAttemptKey] = useState(newRequestKey);

  const send = async () => {
    setError(null);
    setPending(true);
    const result = await sendChecklistIssueEmailAction({
      attemptKey,
      body,
      issueId: issue.id,
      projectId,
      subject,
    }).catch(() => null);
    setPending(false);
    onSent();
    if (!result) {
      setConfirming(false);
      return setError(
        "The email may not have been sent. Check the issue before trying again.",
      );
    }
    if (!result.ok) {
      setConfirming(false);
      // A new attempt for a deliberate retry.
      setAttemptKey(newRequestKey());
      return setError(result.error);
    }
    toast.success(
      result.replayed
        ? `That email had already gone to ${result.to}; it was not sent again.`
        : `Emailed ${issue.tradieName}.`,
    );
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Email issue #{issue.number}</DialogTitle>
          <DialogDescription>
            To {issue.tradieName} &lt;{issue.tradieEmail}&gt;
            {issue.photoCount > 0
              ? ` · ${issue.photoCount} photo${issue.photoCount === 1 ? "" : "s"} attached`
              : " · no photos attached"}
          </DialogDescription>
        </DialogHeader>
        <IssueEmailFields
          subject={subject}
          body={body}
          onSubject={setSubject}
          onBody={setBody}
          disabled={pending}
          idPrefix="issue-email"
        />
        <RefusalAlert message={error} />
        <DialogFooter>
          {confirming ? (
            <>
              <Button
                variant="outline"
                disabled={pending}
                onClick={() => setConfirming(false)}
              >
                Back
              </Button>
              <Button disabled={pending} onClick={send}>
                {pending ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Mail className="size-4" aria-hidden="true" />
                )}
                Confirm send to {issue.tradieName}
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button
                disabled={!subject.trim() || !body.trim()}
                onClick={() => setConfirming(true)}
              >
                <Mail className="size-4" aria-hidden="true" />
                Send email
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function IssueEmailFields({
  subject,
  body,
  onSubject,
  onBody,
  disabled,
  idPrefix,
}: {
  subject: string;
  body: string;
  onSubject: (value: string) => void;
  onBody: (value: string) => void;
  disabled?: boolean;
  idPrefix: string;
}) {
  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-subject`}>Subject</Label>
        <Input
          id={`${idPrefix}-subject`}
          value={subject}
          maxLength={300}
          disabled={disabled}
          onChange={(event) => onSubject(event.target.value)}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-body`}>Message</Label>
        <Textarea
          id={`${idPrefix}-body`}
          value={body}
          rows={9}
          maxLength={10_000}
          disabled={disabled}
          onChange={(event) => onBody(event.target.value)}
        />
      </div>
    </div>
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

export function NoteDialog(props: Parameters<typeof NoteDialogBody>[0]) {
  return props.open ? <NoteDialogBody {...props} /> : null;
}

export function IssueEmailDialog(
  props: Parameters<typeof IssueEmailDialogBody>[0],
) {
  return props.open ? <IssueEmailDialogBody {...props} /> : null;
}
