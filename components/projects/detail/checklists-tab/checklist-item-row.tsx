"use client";

import { Ban, Camera, CircleAlert, Flag, Loader2 } from "lucide-react";
import { useMemo, useRef } from "react";
import { toast } from "sonner";

import { StatusPill } from "@/components/common/status-pill";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  attachChecklistPhotosAction,
  removeChecklistPhotoAction,
} from "@/lib/data/checklist-actions";
import { isBlockingIssue } from "@/lib/domain/projects/checklist-rules";
import type {
  ChecklistIssueView,
  ChecklistItemView,
  ChecklistPhoto,
} from "@/lib/domain/projects/checklists";
import { cn } from "@/lib/utils";
import type { ChecklistItemState } from "@prisma/client";

import {
  PHOTO_ACCEPT,
  useChecklistPhotoUpload,
  useRefreshChecklists,
} from "./checklist-client";
import { PhotoStrip } from "./checklist-photo-strip";
import type { TrackSave } from "./checklist-save-state";

// One inspection row: its tick or N/A, its photos, and its issue flags.

export function ChecklistItemRow({
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
  track: TrackSave;
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
