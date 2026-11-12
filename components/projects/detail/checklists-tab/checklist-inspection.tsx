"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowLeft,
  Ban,
  Camera,
  CheckCircle2,
  ChevronDown,
  CircleAlert,
  Download,
  Flag,
  Loader2,
  Lock,
  ShieldCheck,
  Unlock,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { StatusPill } from "@/components/common/status-pill";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  removeChecklistPhotoAction,
  setChecklistItemStateAction,
  attachChecklistPhotosAction,
  updateChecklistDetailsAction,
} from "@/lib/data/checklist-actions";
import {
  CHECKLIST_STATUS_LABELS,
  closureBlockers,
  isBlockingIssue,
} from "@/lib/domain/projects/checklist-rules";
import type {
  ChecklistDetail,
  ChecklistIssueView,
  ChecklistItemView,
  ChecklistPhoto,
} from "@/lib/domain/projects/checklists";
import { cn } from "@/lib/utils";
import type { ChecklistItemState } from "@prisma/client";

import {
  DISPLAY_TONE,
  PHOTO_ACCEPT,
  checklistKeys,
  formatDateTime,
  useChecklistDetail,
  useChecklistPhotoUpload,
  useRefreshChecklists,
} from "./checklist-client";
import {
  CloseChecklistDialog,
  DownloadChecklistDialog,
  NoteDialog,
  ReopenChecklistDialog,
} from "./checklist-dialogs";
import { IssueRegister } from "./checklist-issue-register";
import { PhotoStrip } from "./checklist-photo-strip";
import { RaiseIssueDialog } from "./raise-issue-dialog";

// One checklist's inspection screen (issue #420): the project header, the
// progress line, every room with its rows, then Additional Comments, the issue
// register and the reviewer sign-off — the order of the client's document.
//
// Ticks save as they are made and the screen says when they have; nothing
// waits for a Save button somebody might forget at the end of a long walk
// through the house.

export function ChecklistInspection({
  projectId,
  number,
  isAdmin,
  onBack,
}: {
  projectId: string;
  number: number;
  isAdmin: boolean;
  onBack: () => void;
}) {
  const query = useChecklistDetail(projectId, number);

  return (
    <section className="grid gap-4">
      <div>
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft className="size-4" aria-hidden="true" />
          All checklists
        </Button>
      </div>
      {query.isPending ? (
        <div
          className="grid gap-3"
          aria-busy="true"
          aria-label="Loading checklist"
        >
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      ) : query.isError ? (
        <Alert variant="destructive">
          <AlertTriangle className="size-4" aria-hidden="true" />
          <AlertTitle>The checklist could not be loaded</AlertTitle>
          <AlertDescription>
            {query.error.message}
            <Button
              size="sm"
              variant="outline"
              className="mt-2"
              onClick={() => query.refetch()}
            >
              Try again
            </Button>
          </AlertDescription>
        </Alert>
      ) : (
        <Inspection
          checklist={query.data}
          isAdmin={isAdmin}
          projectId={projectId}
        />
      )}
    </section>
  );
}

type SaveState = { pending: number; savedAt: Date | null; failed: boolean };

function Inspection({
  checklist,
  isAdmin,
  projectId,
}: {
  checklist: ChecklistDetail;
  isAdmin: boolean;
  projectId: string;
}) {
  const queryClient = useQueryClient();
  const refresh = useRefreshChecklists(projectId);
  const readOnly = checklist.status === "CLOSED";
  const detailKey = checklistKeys.detail(projectId, checklist.number);

  const [save, setSave] = useState<SaveState>({
    failed: false,
    pending: 0,
    savedAt: null,
  });
  const track = async <T,>(work: () => Promise<T>): Promise<T> => {
    setSave((current) => ({
      ...current,
      failed: false,
      pending: current.pending + 1,
    }));
    try {
      const result = await work();
      setSave((current) => ({
        ...current,
        pending: current.pending - 1,
        savedAt: new Date(),
      }));
      return result;
    } catch (error) {
      setSave((current) => ({
        ...current,
        failed: true,
        pending: current.pending - 1,
      }));
      throw error;
    }
  };

  const [raisingFor, setRaisingFor] = useState<ChecklistItemView | null>(null);
  const [naFor, setNaFor] = useState<ChecklistItemView | null>(null);
  const [downloadOpen, setDownloadOpen] = useState(false);
  const [closeOpen, setCloseOpen] = useState(false);
  const [reopenOpen, setReopenOpen] = useState(false);
  const [openSections, setOpenSections] = useState<Set<string>>(
    () => new Set(checklist.sections.map((section) => section.section)),
  );

  const issuesById = useMemo(
    () => new Map(checklist.issues.map((issue) => [issue.id, issue])),
    [checklist.issues],
  );

  const setState = useMutation({
    mutationFn: async (input: {
      item: ChecklistItemView;
      state: ChecklistItemState;
      naReason?: string | null;
    }) =>
      track(async () => {
        const result = await setChecklistItemStateAction({
          checklistId: checklist.id,
          itemId: input.item.id,
          naReason: input.naReason ?? null,
          projectId,
          state: input.state,
        });
        if (!result.ok) throw new Error(result.error);
        return result;
      }),
    // The tick shows at once; a refusal puts it back.
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: detailKey });
      const previous = queryClient.getQueryData<ChecklistDetail>(detailKey);
      if (previous) {
        queryClient.setQueryData<ChecklistDetail>(detailKey, {
          ...previous,
          sections: previous.sections.map((section) => ({
            ...section,
            items: section.items.map((item) =>
              item.id === input.item.id
                ? {
                    ...item,
                    naReason: input.naReason ?? null,
                    state: input.state,
                  }
                : item,
            ),
          })),
        });
      }
      return { previous };
    },
    onError: (error, _input, context) => {
      if (context?.previous) {
        queryClient.setQueryData(detailKey, context.previous);
      }
      toast.error(error.message);
    },
    onSettled: () => refresh(),
  });

  const blockers = closureBlockers({
    issues: checklist.issues,
    items: checklist.sections.flatMap((section) => section.items),
    status: checklist.status,
  });
  const configured = checklist.progress.total > 0;

  return (
    <div className="grid gap-4">
      {/* Header: project, checklist, status, progress, download. */}
      <Card className="rounded-xl border-border/70 p-4 shadow-sm">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div className="min-w-0">
            <p className="font-mono text-xs text-muted-foreground">
              Checklist {checklist.number} · {checklist.stageLabel} stage
            </p>
            <h2 className="mt-0.5 text-lg font-semibold text-foreground">
              {checklist.title}
            </h2>
            <dl className="mt-2 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
              <dt className="text-muted-foreground">Project</dt>
              <dd className="font-medium text-foreground">
                {checklist.project.name}
              </dd>
              <dt className="text-muted-foreground">Project address</dt>
              <dd className="text-foreground">{checklist.project.address}</dd>
              <dt className="text-muted-foreground">House type</dt>
              <dd className="text-foreground">{checklist.project.houseType}</dd>
            </dl>
          </div>
          <div className="flex flex-wrap items-center gap-2 md:justify-end">
            <StatusPill tone={DISPLAY_TONE[checklist.displayStatus]}>
              {CHECKLIST_STATUS_LABELS[checklist.displayStatus]}
            </StatusPill>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setDownloadOpen(true)}
            >
              <Download className="size-4" aria-hidden="true" />
              Download
            </Button>
          </div>
        </div>

        {configured ? (
          <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-border/70 pt-3 text-sm">
            <span className="flex items-center gap-2">
              <span className="font-mono tabular-nums">
                Reviewed {checklist.progress.reviewed}/
                {checklist.progress.total}
              </span>
              <span
                className="h-1.5 w-28 overflow-hidden rounded-full bg-muted"
                aria-hidden="true"
              >
                <span
                  className={cn(
                    "block h-full rounded-full",
                    readOnly ? "bg-success-ink" : "bg-warning-ink",
                  )}
                  style={{
                    width: `${Math.round((checklist.progress.reviewed / checklist.progress.total) * 100)}%`,
                  }}
                />
              </span>
            </span>
            <span
              className={cn(
                "font-mono tabular-nums",
                checklist.progress.openIssues > 0
                  ? "font-semibold text-destructive-ink"
                  : "text-muted-foreground",
              )}
            >
              Open issues {checklist.progress.openIssues}
            </span>
            {checklist.progress.awaitingVerification > 0 ? (
              <span className="font-semibold text-warning-ink">
                {checklist.progress.awaitingVerification} awaiting verification
              </span>
            ) : null}
            <SaveIndicator save={save} readOnly={readOnly} />
          </div>
        ) : null}
      </Card>

      {readOnly ? (
        <Alert>
          <Lock className="size-4" aria-hidden="true" />
          <AlertTitle>Closed and signed off</AlertTitle>
          <AlertDescription>
            {checklist.closure
              ? `Signed off by ${checklist.closure.reviewerName} on ${formatDateTime(checklist.closure.signedAt)}.`
              : "This checklist is closed."}{" "}
            It is read-only.{" "}
            {isAdmin ? "An admin can reopen it to make changes." : null}
          </AlertDescription>
        </Alert>
      ) : null}

      {!configured ? (
        <Card className="rounded-xl border-dashed p-8 text-center">
          <p className="text-sm font-medium text-foreground">
            No inspection items configured
          </p>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
            The {checklist.stageLabel} stage checklist has no inspection items
            yet; they will be added in a later release. You can still download
            it as a blank, labelled template.
          </p>
        </Card>
      ) : (
        <div className="grid gap-3">
          <div className="flex justify-end gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                setOpenSections(
                  new Set(checklist.sections.map((section) => section.section)),
                )
              }
            >
              Expand all
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setOpenSections(new Set())}
            >
              Collapse all
            </Button>
          </div>
          {checklist.sections.map((section) => {
            const isOpen = openSections.has(section.section);
            const reviewed = section.items.filter(
              (item) => item.state !== "UNCHECKED",
            ).length;
            const flagged = section.items.filter((item) =>
              item.issueIds.some((id) => {
                const issue = issuesById.get(id);
                return issue ? isBlockingIssue(issue.status) : false;
              }),
            ).length;
            const bodyId = `checklist-section-${section.items[0]?.id}`;
            return (
              <Card
                key={section.section}
                className="overflow-hidden rounded-xl border-border/70 p-0 shadow-sm"
              >
                <button
                  type="button"
                  className="flex min-h-12 w-full items-center gap-3 px-4 py-2 text-left hover:bg-muted/50 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring"
                  aria-expanded={isOpen}
                  aria-controls={bodyId}
                  onClick={() =>
                    setOpenSections((current) => {
                      const next = new Set(current);
                      if (next.has(section.section))
                        next.delete(section.section);
                      else next.add(section.section);
                      return next;
                    })
                  }
                >
                  <span className="flex-1 font-semibold text-foreground">
                    {section.section}
                  </span>
                  {flagged > 0 ? (
                    <span className="flex items-center gap-1 text-xs font-semibold text-destructive-ink">
                      <Flag className="size-3.5" aria-hidden="true" />
                      {flagged} flagged
                    </span>
                  ) : null}
                  <span
                    className={cn(
                      "font-mono text-xs tabular-nums",
                      reviewed === section.items.length
                        ? "text-success-ink"
                        : "text-muted-foreground",
                    )}
                  >
                    {reviewed}/{section.items.length}
                  </span>
                  <ChevronDown
                    className={cn(
                      "size-4 text-muted-foreground transition-transform motion-reduce:transition-none",
                      isOpen && "rotate-180",
                    )}
                    aria-hidden="true"
                  />
                </button>
                {isOpen ? (
                  <ul
                    id={bodyId}
                    className="list-none divide-y divide-border/70 border-t border-border/70"
                  >
                    {section.items.map((item) => (
                      <ChecklistItemRow
                        key={item.id}
                        item={item}
                        issues={item.issueIds
                          .map((id) => issuesById.get(id))
                          .filter(
                            (issue): issue is ChecklistIssueView => !!issue,
                          )}
                        readOnly={readOnly}
                        projectId={projectId}
                        checklistId={checklist.id}
                        onState={(state) => setState.mutate({ item, state })}
                        onNotApplicable={() => setNaFor(item)}
                        onRaiseIssue={() => setRaisingFor(item)}
                        track={track}
                      />
                    ))}
                  </ul>
                ) : null}
              </Card>
            );
          })}
        </div>
      )}

      <ChecklistDetailsForm
        key={`${checklist.id}-${checklist.status}`}
        checklist={checklist}
        projectId={projectId}
        readOnly={readOnly}
        track={track}
      />

      {configured ? (
        <IssueRegister
          checklist={checklist}
          projectId={projectId}
          readOnly={readOnly}
        />
      ) : null}

      {configured ? (
        <SignOffPanel
          checklist={checklist}
          blockers={blockers}
          isAdmin={isAdmin}
          onClose={() => setCloseOpen(true)}
          onReopen={() => setReopenOpen(true)}
        />
      ) : null}

      {raisingFor ? (
        <RaiseIssueDialog
          open
          onOpenChange={(open) => {
            if (!open) setRaisingFor(null);
          }}
          projectId={projectId}
          checklist={checklist}
          item={raisingFor}
          onRaised={() => refresh()}
        />
      ) : null}

      <NoteDialog
        open={naFor !== null}
        onOpenChange={(open) => {
          if (!open) setNaFor(null);
        }}
        title="Not applicable to this house"
        description={naFor ? `${naFor.section} – ${naFor.label}` : ""}
        label="Reason"
        confirmLabel="Mark not applicable"
        required
        onSubmit={async (reason) => {
          if (!naFor) return null;
          try {
            await setState.mutateAsync({
              item: naFor,
              naReason: reason,
              state: "NOT_APPLICABLE",
            });
            return null;
          } catch (error) {
            return error instanceof Error
              ? error.message
              : "That did not save.";
          }
        }}
      />

      <DownloadChecklistDialog
        open={downloadOpen}
        onOpenChange={setDownloadOpen}
        projectId={projectId}
        checklist={{
          closed: readOnly,
          configured,
          id: checklist.id,
          title: checklist.title,
        }}
      />
      <CloseChecklistDialog
        open={closeOpen}
        onOpenChange={setCloseOpen}
        projectId={projectId}
        checklistId={checklist.id}
        title={checklist.title}
        version={checklist.version}
        onClosed={() => refresh()}
      />
      <ReopenChecklistDialog
        open={reopenOpen}
        onOpenChange={setReopenOpen}
        projectId={projectId}
        checklistId={checklist.id}
        title={checklist.title}
        onReopened={() => refresh()}
      />
    </div>
  );
}

function SaveIndicator({
  save,
  readOnly,
}: {
  save: SaveState;
  readOnly: boolean;
}) {
  if (readOnly) return null;
  return (
    <span
      className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground"
      role="status"
      aria-live="polite"
    >
      {save.pending > 0 ? (
        <>
          <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
          Saving…
        </>
      ) : save.failed ? (
        <span className="font-semibold text-destructive-ink">
          A change did not save
        </span>
      ) : save.savedAt ? (
        <>
          <CheckCircle2
            className="size-3.5 text-success-ink"
            aria-hidden="true"
          />
          All changes saved
        </>
      ) : (
        "Changes save automatically"
      )}
    </span>
  );
}

// ---------------------------------------------------------------------------

function ChecklistItemRow({
  item,
  issues,
  readOnly,
  projectId,
  checklistId,
  onState,
  onNotApplicable,
  onRaiseIssue,
  track,
}: {
  item: ChecklistItemView;
  issues: readonly ChecklistIssueView[];
  readOnly: boolean;
  projectId: string;
  checklistId: string;
  onState: (state: ChecklistItemState) => void;
  onNotApplicable: () => void;
  onRaiseIssue: () => void;
  track: <T>(work: () => Promise<T>) => Promise<T>;
}) {
  const refresh = useRefreshChecklists(projectId);
  const fileRef = useRef<HTMLInputElement>(null);
  const trail = useMemo(
    () => ["Checklists", item.section, item.label],
    [item.label, item.section],
  );
  const photos = useChecklistPhotoUpload(projectId, trail);
  const blocking = issues.filter((issue) => isBlockingIssue(issue.status));
  const checkboxId = `checklist-item-${item.id}`;
  const notApplicable = item.state === "NOT_APPLICABLE";

  const addPhotos = async (files: File[]) => {
    if (files.length === 0) return;
    const fileIds = await photos.uploadPhotos(files);
    if (fileIds.length === 0) return;
    try {
      await track(async () => {
        const result = await attachChecklistPhotosAction({
          checklistId,
          fileIds,
          itemId: item.id,
          projectId,
        });
        if (!result.ok) throw new Error(result.error);
      });
      toast.success(
        `${fileIds.length} photo${fileIds.length === 1 ? "" : "s"} added to ${item.label}.`,
      );
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "The photos were not attached.",
      );
    } finally {
      refresh();
    }
  };

  const removePhoto = async (photo: ChecklistPhoto) => {
    try {
      await track(async () => {
        const result = await removeChecklistPhotoAction({
          attachmentId: photo.id,
          checklistId,
          projectId,
        });
        if (!result.ok) throw new Error(result.error);
      });
      toast.success("Photo removed.");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "The photo was not removed.",
      );
    } finally {
      refresh();
    }
  };

  return (
    <li
      className={cn(
        "px-4 py-3",
        blocking.length > 0
          && "border-l-4 border-l-destructive bg-destructive-light/30",
      )}
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          {notApplicable ? (
            <span className="mt-0.5 inline-flex size-4 shrink-0 items-center justify-center text-muted-foreground">
              <Ban className="size-4" aria-hidden="true" />
            </span>
          ) : (
            <Checkbox
              id={checkboxId}
              className="mt-0.5"
              checked={item.state === "CHECKED"}
              disabled={readOnly}
              onCheckedChange={(checked) =>
                onState(checked === true ? "CHECKED" : "UNCHECKED")
              }
            />
          )}
          <div className="min-w-0">
            <Label
              htmlFor={notApplicable ? undefined : checkboxId}
              className={cn(
                "text-sm leading-snug font-normal text-foreground",
                notApplicable && "text-muted-foreground line-through",
              )}
            >
              {item.label}
            </Label>
            {notApplicable ? (
              <p className="mt-0.5 text-xs text-muted-foreground">
                Not applicable: {item.naReason}
                {!readOnly ? (
                  <Button
                    variant="link"
                    size="xs"
                    className="ml-1 h-auto px-0"
                    onClick={() => onState("UNCHECKED")}
                  >
                    Undo
                  </Button>
                ) : null}
              </p>
            ) : null}
            {issues.length > 0 ? (
              <div className="mt-1 flex flex-wrap gap-1.5">
                {issues.map((issue) => (
                  <a
                    key={issue.id}
                    href={`#checklist-issue-${issue.id}`}
                    className="focus-visible:outline-2 focus-visible:outline-ring"
                  >
                    <StatusPill
                      tone={
                        issue.status === "VERIFIED"
                          ? "success"
                          : issue.status === "RESOLVED"
                            ? "warning"
                            : "danger"
                      }
                    >
                      <Flag className="mr-1 inline size-3" aria-hidden="true" />
                      Issue #{issue.number} ·{" "}
                      {issue.status === "VERIFIED"
                        ? "Verified"
                        : issue.status === "RESOLVED"
                          ? "Awaiting verification"
                          : issue.status === "IN_PROGRESS"
                            ? "In progress"
                            : "Open"}
                    </StatusPill>
                  </a>
                ))}
              </div>
            ) : null}
          </div>
        </div>

        {!readOnly ? (
          <div className="flex shrink-0 flex-wrap gap-1 pl-7 sm:pl-0">
            <Button
              size="sm"
              variant="outline"
              disabled={photos.isUploading}
              onClick={() => fileRef.current?.click()}
            >
              {photos.isUploading ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <Camera className="size-4" aria-hidden="true" />
              )}
              Add images
              <span className="sr-only"> for {item.label}</span>
            </Button>
            <Button size="sm" variant="outline" onClick={onRaiseIssue}>
              <CircleAlert
                className="size-4 text-destructive-ink"
                aria-hidden="true"
              />
              Raise issue
              <span className="sr-only"> on {item.label}</span>
            </Button>
            {!notApplicable && blocking.length === 0 ? (
              <Button size="sm" variant="ghost" onClick={onNotApplicable}>
                N/A
                <span className="sr-only"> – {item.label} does not apply</span>
              </Button>
            ) : null}
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
          </div>
        ) : null}
      </div>

      {item.photos.length > 0 || photos.uploads.length > 0 ? (
        <PhotoStrip
          photos={item.photos}
          uploads={photos.uploads}
          readOnly={readOnly}
          onRemove={removePhoto}
          onDismiss={photos.dismiss}
        />
      ) : null}
    </li>
  );
}

// ---------------------------------------------------------------------------

/** Checked and completed by, and Additional Comments: saved as typed. */
function ChecklistDetailsForm({
  checklist,
  projectId,
  readOnly,
  track,
}: {
  checklist: ChecklistDetail;
  projectId: string;
  readOnly: boolean;
  track: <T>(work: () => Promise<T>) => Promise<T>;
}) {
  const [comments, setComments] = useState(checklist.comments ?? "");
  const [checkedBy, setCheckedBy] = useState(checklist.checkedBy ?? "");
  const saved = useRef({
    checkedBy: checklist.checkedBy ?? "",
    comments: checklist.comments ?? "",
  });

  useEffect(() => {
    if (readOnly) return;
    if (
      comments === saved.current.comments
      && checkedBy === saved.current.checkedBy
    ) {
      return;
    }
    const timer = setTimeout(() => {
      void track(async () => {
        const result = await updateChecklistDetailsAction({
          checkedBy,
          checklistId: checklist.id,
          comments,
          projectId,
        });
        if (!result.ok) throw new Error(result.error);
        saved.current = { checkedBy, comments };
      }).catch((error: unknown) =>
        toast.error(
          error instanceof Error ? error.message : "The comments did not save.",
        ),
      );
    }, 800);
    return () => clearTimeout(timer);
  }, [checkedBy, checklist.id, comments, projectId, readOnly, track]);

  return (
    <Card className="grid gap-4 rounded-xl border-border/70 p-4 shadow-sm">
      <div className="space-y-1.5">
        <Label htmlFor="checklist-checked-by">Checked and completed by</Label>
        <Input
          id="checklist-checked-by"
          value={checkedBy}
          maxLength={120}
          disabled={readOnly}
          onChange={(event) => setCheckedBy(event.target.value)}
          className="max-w-md"
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="checklist-comments">Additional comments</Label>
        <Textarea
          id="checklist-comments"
          value={comments}
          rows={4}
          maxLength={5000}
          disabled={readOnly}
          onChange={(event) => setComments(event.target.value)}
        />
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------

function SignOffPanel({
  checklist,
  blockers,
  isAdmin,
  onClose,
  onReopen,
}: {
  checklist: ChecklistDetail;
  blockers: ReturnType<
    typeof closureBlockers<ChecklistItemView, ChecklistIssueView>
  >;
  isAdmin: boolean;
  onClose: () => void;
  onReopen: () => void;
}) {
  if (checklist.status === "CLOSED") {
    return (
      <Card className="grid gap-3 rounded-xl border-border/70 p-4 shadow-sm">
        <h3 className="flex items-center gap-2 text-base font-semibold text-foreground">
          <ShieldCheck className="size-4 text-success-ink" aria-hidden="true" />
          Reviewer sign-off
        </h3>
        {checklist.closure ? (
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <p className="text-xs text-muted-foreground">
                Name of the reviewer
              </p>
              <p className="font-medium text-foreground">
                {checklist.closure.reviewerName}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Signature</p>
              {/* eslint-disable-next-line @next/next/no-img-element -- a data URL */}
              <img
                src={checklist.closure.signatureDataUrl}
                alt={`Signature of ${checklist.closure.reviewerName}`}
                className="mt-1 h-16 rounded border border-border/70 bg-white object-contain"
              />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Date</p>
              <p className="font-medium text-foreground">
                {formatDateTime(checklist.closure.signedAt)}
              </p>
            </div>
          </div>
        ) : null}
        {isAdmin ? (
          <div>
            <Button variant="outline" size="sm" onClick={onReopen}>
              <Unlock className="size-4" aria-hidden="true" />
              Reopen checklist
            </Button>
          </div>
        ) : null}
      </Card>
    );
  }

  const unreviewedBySection = new Map<string, number>();
  for (const item of blockers.unreviewed) {
    unreviewedBySection.set(
      item.section,
      (unreviewedBySection.get(item.section) ?? 0) + 1,
    );
  }

  return (
    <Card className="grid gap-3 rounded-xl border-border/70 p-4 shadow-sm">
      <h3 className="flex items-center gap-2 text-base font-semibold text-foreground">
        <ShieldCheck
          className="size-4 text-muted-foreground"
          aria-hidden="true"
        />
        Reviewer sign-off
      </h3>
      {blockers.canClose ? (
        <p className="text-sm text-muted-foreground">
          Every item is reviewed and every issue is verified. Sign to close the
          checklist.
        </p>
      ) : (
        <div className="grid gap-2 text-sm">
          <p className="font-medium text-foreground">
            The checklist can be closed once:
          </p>
          <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
            {blockers.unreviewed.length > 0 ? (
              <li>
                {blockers.unreviewed.length} inspection item
                {blockers.unreviewed.length === 1 ? " is" : "s are"} reviewed (
                {[...unreviewedBySection.entries()]
                  .map(([section, count]) => `${section} ${count}`)
                  .join(", ")}
                )
              </li>
            ) : null}
            {blockers.unresolved.length > 0 ? (
              <li>
                Open or in-progress issues are resolved:{" "}
                {blockers.unresolved.map((issue, index) => (
                  <span key={issue.id}>
                    {index > 0 ? ", " : ""}
                    <a
                      className="text-primary underline-offset-2 hover:underline"
                      href={`#checklist-issue-${issue.id}`}
                    >
                      #{issue.number}
                    </a>
                  </span>
                ))}
              </li>
            ) : null}
            {blockers.awaitingVerification.length > 0 ? (
              <li>
                Resolved issues are verified by the reviewer:{" "}
                {blockers.awaitingVerification.map((issue, index) => (
                  <span key={issue.id}>
                    {index > 0 ? ", " : ""}
                    <a
                      className="text-primary underline-offset-2 hover:underline"
                      href={`#checklist-issue-${issue.id}`}
                    >
                      #{issue.number}
                    </a>
                  </span>
                ))}
              </li>
            ) : null}
          </ul>
        </div>
      )}
      <div>
        <Button disabled={!blockers.canClose} onClick={onClose}>
          <ShieldCheck className="size-4" aria-hidden="true" />
          Close checklist
        </Button>
      </div>
    </Card>
  );
}
