"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowLeft, Download, Lock } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { StatusPill } from "@/components/common/status-pill";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { setChecklistItemStateAction } from "@/lib/data/checklist-actions";
import {
  CHECKLIST_STATUS_LABELS,
  closureBlockers,
} from "@/lib/domain/projects/checklist-rules";
import type {
  ChecklistDetail,
  ChecklistItemView,
} from "@/lib/domain/projects/checklists";
import { cn } from "@/lib/utils";
import type { ChecklistItemState } from "@prisma/client";

import {
  DISPLAY_TONE,
  checklistKeys,
  formatDateTime,
  useChecklistDetail,
  useRefreshChecklists,
} from "./checklist-client";
import { ChecklistDetailsForm } from "./checklist-details-form";
import { IssueRegister } from "./checklist-issue-register";
import { NoteDialog, ReopenChecklistDialog } from "./checklist-note-dialog";
import { SaveIndicator, useSaveTracker } from "./checklist-save-state";
import { ChecklistSectionCard } from "./checklist-section-card";
import { SignOffPanel } from "./checklist-sign-off-panel";
import {
  CloseChecklistDialog,
  DownloadChecklistDialog,
} from "./checklist-signoff-dialogs";
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

  const { save, track } = useSaveTracker();

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
          {checklist.sections.map((section) => (
            <ChecklistSectionCard
              key={section.section}
              section={section}
              issuesById={issuesById}
              isOpen={openSections.has(section.section)}
              onToggle={() =>
                setOpenSections((current) => {
                  const next = new Set(current);
                  if (next.has(section.section)) next.delete(section.section);
                  else next.add(section.section);
                  return next;
                })
              }
              readOnly={readOnly}
              projectId={projectId}
              checklistId={checklist.id}
              onState={(item, state) => setState.mutate({ item, state })}
              onNotApplicable={setNaFor}
              onRaiseIssue={setRaisingFor}
              track={track}
            />
          ))}
        </div>
      )}

      <ChecklistDetailsForm
        key={`${checklist.id}-${checklist.status}`}
        checklist={checklist}
        projectId={projectId}
        readOnly={readOnly}
        track={track}
        onSaved={refresh}
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
