"use client";

import {
  Camera,
  Loader2,
  Mail,
  MessageSquare,
  RotateCcw,
  ShieldCheck,
} from "lucide-react";
import { useRef } from "react";

import { Button } from "@/components/ui/button";
import type { ChecklistIssueView } from "@/lib/domain/projects/checklists";
import type { ChecklistIssueStatus } from "@prisma/client";

import { PHOTO_ACCEPT } from "./checklist-client";

// The buttons on an issue card. Only the moves the server accepts from the
// issue's current status are offered; the server checks them again anyway.

/** What a button asks the card to prompt for before it saves. */
export type IssuePrompt =
  | {
      kind: "status";
      to: ChecklistIssueStatus;
      title: string;
      required: boolean;
    }
  | { kind: "comment" };

const RESOLVE: IssuePrompt = {
  kind: "status",
  required: false,
  title: "Mark resolved",
  to: "RESOLVED",
};

export function IssueActions({
  issue,
  busy,
  uploading,
  onMove,
  onPrompt,
  onVerify,
  onEmail,
  onFiles,
}: {
  issue: ChecklistIssueView;
  busy: boolean;
  uploading: boolean;
  /** Move without a note; `done` is the confirmation shown. */
  onMove: (to: "OPEN" | "IN_PROGRESS", done: string) => void;
  onPrompt: (prompt: IssuePrompt) => void;
  onVerify: () => void;
  onEmail: () => void;
  onFiles: (files: File[]) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);

  return (
    <div className="mt-3 flex flex-wrap gap-1.5">
      {issue.status === "OPEN" ? (
        <>
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() =>
              onMove("IN_PROGRESS", `Issue #${issue.number} in progress.`)
            }
          >
            Mark in progress
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => onPrompt(RESOLVE)}
          >
            Mark resolved
          </Button>
        </>
      ) : null}
      {issue.status === "IN_PROGRESS" ? (
        <>
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => onPrompt(RESOLVE)}
          >
            Mark resolved
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() =>
              onMove("OPEN", `Issue #${issue.number} back to open.`)
            }
          >
            Back to open
          </Button>
        </>
      ) : null}
      {issue.status === "RESOLVED" ? (
        <>
          <Button size="sm" disabled={busy} onClick={onVerify}>
            <ShieldCheck className="size-4" aria-hidden="true" />
            Verify and sign off
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() =>
              onPrompt({
                kind: "status",
                required: true,
                title: "Send back for more work",
                to: "IN_PROGRESS",
              })
            }
          >
            Not satisfactory
          </Button>
        </>
      ) : null}
      {issue.status === "VERIFIED" ? (
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() =>
            onPrompt({
              kind: "status",
              required: true,
              title: "Reopen issue",
              to: "OPEN",
            })
          }
        >
          <RotateCcw className="size-4" aria-hidden="true" />
          Reopen
        </Button>
      ) : null}
      {issue.status !== "VERIFIED" && issue.assignedTradie ? (
        <Button size="sm" variant="outline" disabled={busy} onClick={onEmail}>
          <Mail className="size-4" aria-hidden="true" />
          {issue.notificationStatus === "FAILED"
            ? "Retry email"
            : issue.notificationStatus === "SENT"
              ? "Email again"
              : "Send email"}
        </Button>
      ) : null}
      {issue.status !== "VERIFIED" ? (
        <Button
          size="sm"
          variant="ghost"
          disabled={busy || uploading}
          onClick={() => fileRef.current?.click()}
        >
          {uploading ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <Camera className="size-4" aria-hidden="true" />
          )}
          Add photos
        </Button>
      ) : null}
      <Button
        size="sm"
        variant="ghost"
        disabled={busy}
        onClick={() => onPrompt({ kind: "comment" })}
      >
        <MessageSquare className="size-4" aria-hidden="true" />
        Comment
      </Button>
      <input
        ref={fileRef}
        type="file"
        accept={PHOTO_ACCEPT}
        multiple
        className="sr-only"
        tabIndex={-1}
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          event.target.value = "";
          onFiles(files);
        }}
      />
    </div>
  );
}
