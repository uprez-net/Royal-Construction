"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";

import { StatusPill } from "@/components/common/status-pill";
import { Label } from "@/components/ui/label";
import {
  assignChecklistIssueAction,
  attachChecklistPhotosAction,
  changeChecklistIssueStatusAction,
  commentOnChecklistIssueAction,
} from "@/lib/data/checklist-actions";
import {
  ISSUE_STATUS_LABELS,
  defaultIssueEmail,
} from "@/lib/domain/projects/checklist-rules";
import type {
  ChecklistDetail,
  ChecklistIssueView,
} from "@/lib/domain/projects/checklists";
import { cn } from "@/lib/utils";
import type { ChecklistIssueStatus } from "@prisma/client";

import {
  formatDateTime,
  useChecklistPhotoUpload,
  useRefreshChecklists,
} from "./checklist-client";
import { IssueEmailDialog } from "./checklist-email-dialog";
import { IssueActions, type IssuePrompt } from "./checklist-issue-actions";
import { IssueHistory, NotificationState } from "./checklist-issue-history";
import { NoteDialog } from "./checklist-note-dialog";
import { PhotoStrip } from "./checklist-photo-strip";
import { VerifyIssueDialog } from "./checklist-signoff-dialogs";

// One defect on the issue register: what it is, who has it, whether they were
// told, its photos, and the dialogs its actions open.

const STATUS_TONE: Record<
  ChecklistIssueStatus,
  "danger" | "warning" | "success" | "primary"
> = {
  IN_PROGRESS: "warning",
  OPEN: "danger",
  RESOLVED: "primary",
  VERIFIED: "success",
};

export function IssueCard({
  issue,
  checklist,
  projectId,
  readOnly,
}: {
  issue: ChecklistIssueView;
  checklist: ChecklistDetail;
  projectId: string;
  readOnly: boolean;
}) {
  const refresh = useRefreshChecklists(projectId);
  const [busy, setBusy] = useState(false);
  const [prompt, setPrompt] = useState<IssuePrompt | null>(null);
  const [verifyOpen, setVerifyOpen] = useState(false);
  const [emailOpen, setEmailOpen] = useState(false);
  const trail = useMemo(
    () => [
      "Checklists",
      issue.section,
      issue.itemLabel,
      `Issue #${issue.number}`,
    ],
    [issue.itemLabel, issue.number, issue.section],
  );
  const photos = useChecklistPhotoUpload(projectId, trail);
  const location = `${issue.section} – ${issue.itemLabel}`;

  const run = async (
    work: () => Promise<{ ok: boolean; error?: string }>,
    done: string,
  ) => {
    setBusy(true);
    try {
      const result = await work();
      if (!result.ok) throw new Error(result.error);
      toast.success(done);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "That did not save.",
      );
    } finally {
      setBusy(false);
      refresh();
    }
  };

  const move = (to: ChecklistIssueStatus, note?: string) =>
    changeChecklistIssueStatusAction({
      issueId: issue.id,
      note: note || null,
      projectId,
      to: to as "OPEN" | "IN_PROGRESS" | "RESOLVED",
    });

  const addEvidence = async (files: File[]) => {
    if (files.length === 0) return;
    const fileIds = await photos.uploadPhotos(files);
    if (fileIds.length === 0) return;
    await run(
      () =>
        attachChecklistPhotosAction({
          checklistId: checklist.id,
          fileIds,
          issueId: issue.id,
          itemId: issue.itemId,
          projectId,
        }),
      `${fileIds.length} photo${fileIds.length === 1 ? "" : "s"} added to issue #${issue.number}.`,
    );
  };

  const emailDraft = useMemo(() => {
    if (issue.emailSubject && issue.emailBody) {
      return { body: issue.emailBody, subject: issue.emailSubject };
    }
    return defaultIssueEmail({
      checklistTitle: checklist.title,
      description: issue.description,
      itemLabel: issue.itemLabel,
      photoCount: issue.photos.length,
      projectName: checklist.project.name,
      section: issue.section,
      siteAddress: checklist.project.address,
      tradieName: issue.assignedTradie?.name,
    });
  }, [checklist, issue]);

  const tradieOptions = checklist.tradies;

  return (
    <li
      id={`checklist-issue-${issue.id}`}
      className={cn(
        "scroll-mt-24 rounded-lg border p-3",
        issue.status === "VERIFIED"
          ? "border-border/70"
          : "border-destructive/40 bg-destructive-light/20",
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground">
            <span className="font-mono">#{issue.number}</span> · {location}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Raised {formatDateTime(issue.createdAt)}
          </p>
        </div>
        <StatusPill tone={STATUS_TONE[issue.status]}>
          {ISSUE_STATUS_LABELS[issue.status]}
        </StatusPill>
      </div>

      <p className="mt-2 whitespace-pre-wrap text-sm text-foreground">
        {issue.description}
      </p>
      {issue.comments ? (
        <p className="mt-1 whitespace-pre-wrap text-xs text-muted-foreground">
          {issue.comments}
        </p>
      ) : null}

      <div className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
        <div className="space-y-1">
          <Label
            htmlFor={`issue-tradie-${issue.id}`}
            className="text-xs text-muted-foreground"
          >
            Assigned tradie
          </Label>
          <select
            id={`issue-tradie-${issue.id}`}
            value={issue.assignedTradie?.id ?? ""}
            disabled={readOnly || busy || issue.status === "VERIFIED"}
            onChange={(event) =>
              run(
                () =>
                  assignChecklistIssueAction({
                    issueId: issue.id,
                    projectId,
                    tradieId: event.target.value || null,
                  }),
                event.target.value
                  ? `Issue #${issue.number} reassigned.`
                  : `Issue #${issue.number} unassigned.`,
              )
            }
            className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm"
          >
            <option value="">Unassigned</option>
            {issue.assignedTradie
            && !tradieOptions.some(
              (option) => option.id === issue.assignedTradie?.id,
            ) ? (
              <option value={issue.assignedTradie.id}>
                {issue.assignedTradie.name}
              </option>
            ) : null}
            <optgroup label="On this project">
              {tradieOptions
                .filter((option) => option.onProject)
                .map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.name} – {option.trades.join(", ")}
                  </option>
                ))}
            </optgroup>
            <optgroup label="Directory">
              {tradieOptions
                .filter((option) => !option.onProject)
                .map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.name} – {option.trades.join(", ")}
                  </option>
                ))}
            </optgroup>
          </select>
        </div>
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">Notification</p>
          <NotificationState issue={issue} />
        </div>
      </div>

      {issue.verification ? (
        <p className="mt-2 text-xs text-success-ink">
          Verified and signed off by {issue.verification.reviewerName},{" "}
          {formatDateTime(issue.verification.signedAt)}
          {issue.verificationNote ? ` – ${issue.verificationNote}` : ""}
        </p>
      ) : null}

      {issue.photos.length > 0 || photos.uploads.length > 0 ? (
        <div className="-ml-7">
          <PhotoStrip
            photos={issue.photos}
            uploads={photos.uploads}
            readOnly
            onDismiss={photos.dismiss}
          />
        </div>
      ) : null}

      {!readOnly ? (
        <IssueActions
          issue={issue}
          busy={busy}
          uploading={photos.isUploading}
          onMove={(to, done) => run(() => move(to), done)}
          onPrompt={setPrompt}
          onVerify={() => setVerifyOpen(true)}
          onEmail={() => setEmailOpen(true)}
          onFiles={(files) => void addEvidence(files)}
        />
      ) : null}

      <IssueHistory events={issue.events} />

      <NoteDialog
        open={prompt !== null}
        onOpenChange={(open) => {
          if (!open) setPrompt(null);
        }}
        title={
          prompt?.kind === "comment"
            ? `Comment on issue #${issue.number}`
            : (prompt?.title ?? "")
        }
        description={location}
        label={
          prompt?.kind === "comment"
            ? "Comment"
            : prompt?.to === "RESOLVED"
              ? "Rectification note"
              : "Reason"
        }
        confirmLabel={
          prompt?.kind === "comment" ? "Add comment" : (prompt?.title ?? "Save")
        }
        required={
          prompt?.kind === "comment" ? true : (prompt?.required ?? false)
        }
        onSubmit={async (note) => {
          if (!prompt) return null;
          const result =
            prompt.kind === "comment"
              ? await commentOnChecklistIssueAction({
                  issueId: issue.id,
                  note,
                  projectId,
                })
              : await move(prompt.to, note);
          refresh();
          if (!result.ok) return result.error;
          toast.success(
            prompt.kind === "comment"
              ? "Comment added."
              : `Issue #${issue.number}: ${ISSUE_STATUS_LABELS[prompt.to].toLowerCase()}.`,
          );
          return null;
        }}
      />
      <VerifyIssueDialog
        open={verifyOpen}
        onOpenChange={setVerifyOpen}
        projectId={projectId}
        issue={{ id: issue.id, location, number: issue.number }}
        onVerified={() => refresh()}
      />
      {issue.assignedTradie ? (
        <IssueEmailDialog
          open={emailOpen}
          onOpenChange={setEmailOpen}
          projectId={projectId}
          issue={{
            id: issue.id,
            number: issue.number,
            photoCount: issue.photos.length,
            tradieEmail: issue.assignedTradie.email,
            tradieName: issue.assignedTradie.name,
          }}
          initial={emailDraft}
          onSent={() => refresh()}
        />
      ) : null}
    </li>
  );
}
