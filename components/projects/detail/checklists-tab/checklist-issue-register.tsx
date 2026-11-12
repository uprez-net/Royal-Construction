"use client";

import {
  AlertTriangle,
  Camera,
  ChevronDown,
  ClipboardList,
  History,
  Loader2,
  Mail,
  MessageSquare,
  RotateCcw,
  ShieldCheck,
} from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { StatusPill } from "@/components/common/status-pill";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
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
  PHOTO_ACCEPT,
  formatDateTime,
  useChecklistPhotoUpload,
  useRefreshChecklists,
} from "./checklist-client";
import {
  IssueEmailDialog,
  NoteDialog,
  VerifyIssueDialog,
} from "./checklist-dialogs";
import { PhotoStrip } from "./checklist-photo-strip";

// The checklist's issue register (issue #420): every defect raised on it, its
// status, who it is with, whether they were told, and its history. Every move
// a reviewer can make on an issue is here, and only the moves the server will
// accept for its current status are offered.

const STATUS_TONE: Record<
  ChecklistIssueStatus,
  "danger" | "warning" | "success" | "primary"
> = {
  IN_PROGRESS: "warning",
  OPEN: "danger",
  RESOLVED: "primary",
  VERIFIED: "success",
};

type Filter = "blocking" | "all";

export function IssueRegister({
  checklist,
  projectId,
  readOnly,
}: {
  checklist: ChecklistDetail;
  projectId: string;
  readOnly: boolean;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const shown = useMemo(
    () =>
      filter === "all"
        ? checklist.issues
        : checklist.issues.filter((issue) => issue.status !== "VERIFIED"),
    [checklist.issues, filter],
  );

  return (
    <Card className="grid gap-3 rounded-xl border-border/70 p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-base font-semibold text-foreground">
          <ClipboardList
            className="size-4 text-muted-foreground"
            aria-hidden="true"
          />
          Issue register
          <span className="font-mono text-xs font-normal tabular-nums text-muted-foreground">
            {checklist.issues.length}
          </span>
        </h3>
        {checklist.issues.length > 0 ? (
          <div className="flex gap-1" role="group" aria-label="Filter issues">
            <Button
              size="sm"
              variant={filter === "all" ? "secondary" : "ghost"}
              aria-pressed={filter === "all"}
              onClick={() => setFilter("all")}
            >
              All
            </Button>
            <Button
              size="sm"
              variant={filter === "blocking" ? "secondary" : "ghost"}
              aria-pressed={filter === "blocking"}
              onClick={() => setFilter("blocking")}
            >
              Not yet verified
            </Button>
          </div>
        ) : null}
      </div>
      {checklist.issues.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No issues raised. Use Raise issue on any inspection row to record a
          defect and notify the tradie.
        </p>
      ) : shown.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Every issue has been verified and signed off.
        </p>
      ) : (
        <ul className="grid list-none gap-3">
          {shown.map((issue) => (
            <IssueCard
              key={issue.id}
              issue={issue}
              checklist={checklist}
              projectId={projectId}
              readOnly={readOnly}
            />
          ))}
        </ul>
      )}
    </Card>
  );
}

type Prompt =
  | {
      kind: "status";
      to: ChecklistIssueStatus;
      title: string;
      required: boolean;
    }
  | { kind: "comment" };

function IssueCard({
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
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  const [verifyOpen, setVerifyOpen] = useState(false);
  const [emailOpen, setEmailOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
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
        <div className="mt-3 flex flex-wrap gap-1.5">
          {issue.status === "OPEN" ? (
            <>
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() =>
                  run(
                    () => move("IN_PROGRESS"),
                    `Issue #${issue.number} in progress.`,
                  )
                }
              >
                Mark in progress
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() =>
                  setPrompt({
                    kind: "status",
                    required: false,
                    title: "Mark resolved",
                    to: "RESOLVED",
                  })
                }
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
                onClick={() =>
                  setPrompt({
                    kind: "status",
                    required: false,
                    title: "Mark resolved",
                    to: "RESOLVED",
                  })
                }
              >
                Mark resolved
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() =>
                  run(
                    () => move("OPEN"),
                    `Issue #${issue.number} back to open.`,
                  )
                }
              >
                Back to open
              </Button>
            </>
          ) : null}
          {issue.status === "RESOLVED" ? (
            <>
              <Button
                size="sm"
                disabled={busy}
                onClick={() => setVerifyOpen(true)}
              >
                <ShieldCheck className="size-4" aria-hidden="true" />
                Verify and sign off
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() =>
                  setPrompt({
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
                setPrompt({
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
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => setEmailOpen(true)}
            >
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
              disabled={busy || photos.isUploading}
              onClick={() => fileRef.current?.click()}
            >
              {photos.isUploading ? (
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
            onClick={() => setPrompt({ kind: "comment" })}
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
              void addEvidence(files);
            }}
          />
        </div>
      ) : null}

      <div className="mt-2">
        <Button
          size="sm"
          variant="ghost"
          className="px-1 text-muted-foreground"
          aria-expanded={historyOpen}
          onClick={() => setHistoryOpen((open) => !open)}
        >
          <History className="size-4" aria-hidden="true" />
          History ({issue.events.length})
          <ChevronDown
            className={cn(
              "size-4 transition-transform",
              historyOpen && "rotate-180",
            )}
            aria-hidden="true"
          />
        </Button>
        {historyOpen ? (
          <ol className="mt-1 list-none space-y-1.5 border-l-2 border-border pl-3 text-xs">
            {issue.events.map((event) => (
              <li key={event.id}>
                <span className="font-mono text-muted-foreground">
                  {formatDateTime(event.createdAt)}
                </span>{" "}
                <span className="font-medium text-foreground">
                  {event.actorName ?? "System"}
                </span>{" "}
                <span className="text-muted-foreground">
                  {describeEvent(event)}
                </span>
                {event.note ? (
                  <span className="block whitespace-pre-wrap text-foreground">
                    {event.note}
                  </span>
                ) : null}
              </li>
            ))}
          </ol>
        ) : null}
      </div>

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

function NotificationState({ issue }: { issue: ChecklistIssueView }) {
  if (issue.notificationStatus === "SENT") {
    return (
      <p className="text-sm text-success-ink">
        Emailed {issue.notifiedTo}
        {issue.notifiedAt ? `, ${formatDateTime(issue.notifiedAt)}` : ""}
      </p>
    );
  }
  if (issue.notificationStatus === "FAILED") {
    return (
      <p className="flex items-start gap-1 text-sm text-destructive-ink">
        <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <span>{issue.notificationError ?? "The last email was not sent."}</span>
      </p>
    );
  }
  return (
    <p className="text-sm text-muted-foreground">
      {issue.assignedTradie ? "Not emailed yet" : "Unassigned – nobody emailed"}
    </p>
  );
}

function describeEvent(event: ChecklistIssueView["events"][number]): string {
  switch (event.kind) {
    case "CREATED":
      return "raised the issue";
    case "STATUS_CHANGED":
      return event.fromStatus && event.toStatus
        ? `moved it from ${ISSUE_STATUS_LABELS[event.fromStatus].toLowerCase()} to ${ISSUE_STATUS_LABELS[event.toStatus].toLowerCase()}`
        : "changed its status";
    case "ASSIGNED":
      return "changed the assigned tradie";
    case "COMMENT":
      return "commented";
    case "EMAIL_SENT":
      return "sent the email";
    case "EMAIL_FAILED":
      return "tried to send the email; it failed";
    case "EVIDENCE_ADDED":
      return "added photos";
  }
}
