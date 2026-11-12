"use client";

import { Camera, Check, Loader2, Mail, Save } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";

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
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  attachChecklistPhotosAction,
  raiseChecklistIssueAction,
} from "@/lib/data/checklist-actions";
import {
  defaultIssueEmail,
  rankTradiesForWork,
} from "@/lib/domain/projects/checklist-rules";
import type {
  ChecklistDetail,
  ChecklistItemView,
} from "@/lib/domain/projects/checklists";
import { cn } from "@/lib/utils";

import {
  PHOTO_ACCEPT,
  newRequestKey,
  useChecklistPhotoUpload,
  useRefreshChecklists,
} from "./checklist-client";
import { IssueEmailFields } from "./checklist-dialogs";

// Raise Issue (issue #420): describe the defect, attach the photos, pick the
// responsible tradie, review the email, then save — with or without sending.
//
// The tradies who did this kind of work on this job come first; the rest of
// the job's tradies next; anyone else in the directory last. When nobody on
// the job matches, the dialog says so instead of quietly suggesting someone
// unrelated, and the issue can still be saved unassigned.

const UNASSIGNED = "";

export function RaiseIssueDialog({
  open,
  onOpenChange,
  projectId,
  checklist,
  item,
  onRaised,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  checklist: ChecklistDetail;
  item: ChecklistItemView;
  onRaised: () => void;
}) {
  const refresh = useRefreshChecklists(projectId);
  const trail = useMemo(
    () => ["Checklists", item.section, item.label, "Issue"],
    [item.label, item.section],
  );
  const photos = useChecklistPhotoUpload(projectId, trail);
  const fileRef = useRef<HTMLInputElement>(null);
  // One key per opening of the dialog: a double-click or a retry after a
  // timeout returns the issue already raised.
  const [requestKey] = useState(newRequestKey);

  const [description, setDescription] = useState("");
  const [comments, setComments] = useState("");
  const [tradieId, setTradieId] = useState(UNASSIGNED);
  const [evidence, setEvidence] = useState<Set<string>>(new Set());
  // The reviewer's edits to the email; until then it follows the form.
  const [edited, setEdited] = useState<{
    subject: string;
    body: string;
  } | null>(null);
  const [confirmingSend, setConfirmingSend] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Photos already on the row that are not yet evidence for another issue.
  const rowPhotos = item.photos.filter((photo) => photo.issueId === null);

  const { onJob, directory } = useMemo(() => {
    const job = checklist.tradies.filter((tradie) => tradie.onProject);
    return {
      directory: checklist.tradies.filter((tradie) => !tradie.onProject),
      onJob: rankTradiesForWork(job, item.trades),
    };
  }, [checklist.tradies, item.trades]);
  const tradie = checklist.tradies.find((option) => option.id === tradieId);

  const draft = useMemo(
    () =>
      defaultIssueEmail({
        checklistTitle: checklist.title,
        description,
        itemLabel: item.label,
        photoCount: evidence.size,
        projectName: checklist.project.name,
        section: item.section,
        siteAddress: checklist.project.address,
        tradieName: tradie?.name,
      }),
    [
      checklist.project.address,
      checklist.project.name,
      checklist.title,
      description,
      evidence.size,
      item.label,
      item.section,
      tradie?.name,
    ],
  );
  const subject = edited?.subject ?? draft.subject;
  const body = edited?.body ?? draft.body;

  const toggleEvidence = (fileId: string) =>
    setEvidence((current) => {
      const next = new Set(current);
      if (next.has(fileId)) next.delete(fileId);
      else next.add(fileId);
      return next;
    });

  // New photos land on the row first, so cancelling the dialog keeps them as
  // inspection photos rather than orphaning them; they are then preselected.
  const addPhotos = async (files: File[]) => {
    if (files.length === 0) return;
    const fileIds = await photos.uploadPhotos(files);
    if (fileIds.length === 0) return;
    const result = await attachChecklistPhotosAction({
      checklistId: checklist.id,
      fileIds,
      itemId: item.id,
      projectId,
    }).catch(() => null);
    if (!result?.ok) {
      setError(result?.error ?? "The photos were uploaded but not attached.");
      return;
    }
    setEvidence((current) => new Set([...current, ...fileIds]));
    await refresh();
  };

  const submit = async (send: boolean) => {
    setError(null);
    if (!description.trim()) {
      setConfirmingSend(false);
      return setError("Describe what is wrong.");
    }
    setPending(true);
    const result = await raiseChecklistIssueAction({
      assignedTradieId: tradieId || null,
      checklistId: checklist.id,
      comments: comments.trim() || null,
      description: description.trim(),
      email: send ? { body, subject } : null,
      evidenceFileIds: [...evidence],
      itemId: item.id,
      projectId,
      requestKey,
    }).catch(() => null);
    setPending(false);
    setConfirmingSend(false);
    if (!result) {
      return setError(
        "The issue may not have saved. Check the issue register before trying again.",
      );
    }
    if (!result.ok) return setError(result.error);
    onRaised();
    if (result.emailError) {
      toast.warning(
        `Issue #${result.number} saved, but the email was not sent: ${result.emailError} Retry it from the issue register.`,
        { duration: 10_000 },
      );
    } else if (result.emailedTo) {
      toast.success(
        `Issue #${result.number} saved and emailed to ${result.emailedTo}.`,
      );
    } else {
      toast.success(`Issue #${result.number} saved.`);
    }
    onOpenChange(false);
  };

  const photoCount = evidence.size;
  const busy = pending || photos.isUploading;

  return (
    <Dialog open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Raise issue</DialogTitle>
          <DialogDescription>
            {item.section} › {item.label}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-5">
          <div className="space-y-1.5">
            <Label htmlFor="issue-description">Issue description</Label>
            <Textarea
              id="issue-description"
              value={description}
              rows={3}
              maxLength={4000}
              placeholder="Workmanship or finish does not meet the expected standard…"
              disabled={pending}
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="issue-comments">
              Comments (optional, internal)
            </Label>
            <Textarea
              id="issue-comments"
              value={comments}
              rows={2}
              maxLength={5000}
              disabled={pending}
              onChange={(event) => setComments(event.target.value)}
            />
          </div>

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium text-foreground">
              Evidence{" "}
              <span className="font-normal text-muted-foreground">
                · {photoCount} photo{photoCount === 1 ? "" : "s"} attached
              </span>
            </legend>
            {rowPhotos.length > 0 ? (
              <ul className="flex list-none flex-wrap gap-2">
                {rowPhotos.map((photo) => {
                  const selected = evidence.has(photo.fileId);
                  return (
                    <li key={photo.id}>
                      <button
                        type="button"
                        aria-pressed={selected}
                        aria-label={`${selected ? "Remove" : "Attach"} ${photo.filename}`}
                        disabled={pending}
                        onClick={() => toggleEvidence(photo.fileId)}
                        className={cn(
                          "relative block overflow-hidden rounded-md border-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                          selected
                            ? "border-primary"
                            : "border-transparent opacity-70",
                        )}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element -- Blob thumbnails */}
                        <img
                          src={photo.url}
                          alt=""
                          className="h-20 w-24 object-cover"
                        />
                        {selected ? (
                          <span className="absolute right-1 top-1 rounded-full bg-primary p-0.5 text-primary-foreground">
                            <Check className="size-3" aria-hidden="true" />
                          </span>
                        ) : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : null}
            {photos.uploads.length > 0 ? (
              <ul className="list-none space-y-1 text-xs">
                {photos.uploads.map((upload) => (
                  <li key={upload.id} className="flex items-center gap-2">
                    {upload.error ? (
                      <>
                        <span className="text-destructive-ink">
                          {upload.name}: {upload.error}
                        </span>
                        <Button
                          size="xs"
                          variant="ghost"
                          onClick={() => photos.dismiss(upload.id)}
                        >
                          Dismiss
                        </Button>
                      </>
                    ) : (
                      <>
                        <Loader2
                          className="size-3.5 animate-spin"
                          aria-hidden="true"
                        />
                        <span className="truncate">{upload.name}</span>
                        <span className="font-mono tabular-nums">
                          {Math.round(upload.progress)}%
                        </span>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            ) : null}
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => fileRef.current?.click()}
            >
              <Camera className="size-4" aria-hidden="true" />
              Add photos
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
                void addPhotos(files);
              }}
            />
          </fieldset>

          <div className="space-y-1.5">
            <Label htmlFor="issue-tradie">Assigned tradie</Label>
            <select
              id="issue-tradie"
              value={tradieId}
              disabled={pending}
              onChange={(event) => setTradieId(event.target.value)}
              className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-2 focus-visible:outline-ring"
            >
              <option value={UNASSIGNED}>
                Unassigned – save without emailing
              </option>
              {onJob.matching.length > 0 ? (
                <optgroup label="On this project · did this kind of work">
                  {onJob.matching.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.name} – {option.trades.join(", ")}
                    </option>
                  ))}
                </optgroup>
              ) : null}
              {onJob.others.length > 0 ? (
                <optgroup label="Other tradies on this project">
                  {onJob.others.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.name} – {option.trades.join(", ")}
                    </option>
                  ))}
                </optgroup>
              ) : null}
              {directory.length > 0 ? (
                <optgroup label="Another contractor from the directory">
                  {directory.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.name} – {option.trades.join(", ")}
                    </option>
                  ))}
                </optgroup>
              ) : null}
            </select>
            {onJob.matching.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                {onJob.others.length === 0
                  ? "No tradies are booked on this project yet. "
                  : "Nobody booked on this project matches this work. "}
                Choose another contractor, or save the issue unassigned.
              </p>
            ) : null}
          </div>

          <div className="space-y-2 rounded-lg border border-border/70 bg-muted/30 p-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="text-sm font-semibold text-foreground">
                Email preview
              </h3>
              <span className="text-xs text-muted-foreground">
                To:{" "}
                {tradie ? (
                  <span className="font-medium text-foreground">
                    {tradie.name} &lt;{tradie.email}&gt;
                  </span>
                ) : (
                  "choose a tradie to send"
                )}
                {" · "}
                {photoCount} photo{photoCount === 1 ? "" : "s"} attached
              </span>
            </div>
            <IssueEmailFields
              idPrefix="raise-issue-email"
              subject={subject}
              body={body}
              disabled={pending}
              onSubject={(value) => setEdited({ body, subject: value })}
              onBody={(value) => setEdited({ body: value, subject })}
            />
            {edited ? (
              <Button
                type="button"
                variant="link"
                size="xs"
                className="h-auto px-0"
                onClick={() => setEdited(null)}
              >
                Reset to the suggested email
              </Button>
            ) : null}
          </div>

          {error ? (
            <Alert variant="destructive" role="alert">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
        </div>

        <DialogFooter className="gap-2">
          {confirmingSend && tradie ? (
            <>
              <p className="mr-auto self-center text-sm text-foreground">
                Send this email to {tradie.name}?
              </p>
              <Button
                variant="outline"
                disabled={pending}
                onClick={() => setConfirmingSend(false)}
              >
                Back
              </Button>
              <Button disabled={busy} onClick={() => submit(true)}>
                {pending ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Mail className="size-4" aria-hidden="true" />
                )}
                Confirm and send
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="outline"
                disabled={pending}
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() => submit(false)}
              >
                {pending ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Save className="size-4" aria-hidden="true" />
                )}
                Save issue
              </Button>
              <Button
                disabled={busy || !tradie || !subject.trim() || !body.trim()}
                onClick={() => {
                  if (!description.trim()) {
                    setError("Describe what is wrong.");
                    return;
                  }
                  setConfirmingSend(true);
                }}
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
