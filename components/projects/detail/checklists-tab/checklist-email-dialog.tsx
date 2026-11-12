"use client";

import { Loader2, Mail } from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";
import { sendChecklistIssueEmailAction } from "@/lib/data/checklist-actions";

import { newRequestKey } from "./checklist-client";
import { RefusalAlert } from "./checklist-reviewer-fields";

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

export function IssueEmailDialog(
  props: Parameters<typeof IssueEmailDialogBody>[0],
) {
  return props.open ? <IssueEmailDialogBody {...props} /> : null;
}
