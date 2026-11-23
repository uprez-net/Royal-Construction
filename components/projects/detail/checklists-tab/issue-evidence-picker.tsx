"use client";

import { Camera, Check, Loader2 } from "lucide-react";
import { useRef } from "react";

import { Button } from "@/components/ui/button";
import type { ChecklistPhoto } from "@/lib/domain/projects/checklists";
import { cn } from "@/lib/utils";

import { PHOTO_ACCEPT, type PhotoUploadState } from "./checklist-client";
import { fileHref } from "@/lib/files/file-href";

// The evidence for a new issue: photos already on the row to pick from, and
// new ones to add. New photos land on the row first, so cancelling the issue
// keeps them as inspection photos rather than orphaning them.

export function IssueEvidencePicker({
  rowPhotos,
  evidence,
  onToggle,
  uploads,
  onDismiss,
  disabled,
  adding,
  onFiles,
}: {
  rowPhotos: readonly ChecklistPhoto[];
  /** File ids chosen as evidence. */
  evidence: ReadonlySet<string>;
  onToggle: (fileId: string) => void;
  uploads: readonly PhotoUploadState[];
  onDismiss: (id: string) => void;
  disabled: boolean;
  /** An upload or attach is under way: no second batch until it lands. */
  adding: boolean;
  onFiles: (files: File[]) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium text-foreground">
        Evidence{" "}
        <span className="font-normal text-muted-foreground">
          · {evidence.size} photo{evidence.size === 1 ? "" : "s"} attached
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
                  disabled={disabled}
                  onClick={() => onToggle(photo.fileId)}
                  className={cn(
                    "relative block overflow-hidden rounded-md border-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                    selected
                      ? "border-primary"
                      : "border-transparent opacity-70",
                  )}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- Blob thumbnails */}
                  <img
                    src={fileHref(photo.url)}
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
      {uploads.length > 0 ? (
        <ul className="list-none space-y-1 text-xs">
          {uploads.map((upload) => (
            <li key={upload.id} className="flex items-center gap-2">
              {upload.error ? (
                <>
                  <span className="text-destructive-ink">
                    {upload.name}: {upload.error}
                  </span>
                  <Button
                    size="xs"
                    variant="ghost"
                    onClick={() => onDismiss(upload.id)}
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
        disabled={adding}
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
          onFiles(files);
        }}
      />
    </fieldset>
  );
}
