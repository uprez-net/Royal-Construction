"use client";

import { Loader2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { ChecklistPhoto } from "@/lib/domain/projects/checklists";

import type { PhotoUploadState } from "./checklist-client";
import { fileHref } from "@/lib/files/file-href";

// Thumbnails for an inspection row or an issue, with any uploads in flight.
// Evidence for an issue is never offered a remove button: it is the record.

export function PhotoStrip({
  photos,
  uploads = [],
  readOnly,
  onRemove,
  onDismiss,
}: {
  photos: readonly ChecklistPhoto[];
  uploads?: readonly PhotoUploadState[];
  readOnly: boolean;
  onRemove?: (photo: ChecklistPhoto) => void;
  onDismiss?: (id: string) => void;
}) {
  return (
    <ul className="mt-2 flex list-none flex-wrap gap-2 pl-7">
      {photos.map((photo) => (
        <li key={photo.id} className="group relative w-24">
          <a
            href={fileHref(photo.url)}
            target="_blank"
            rel="noreferrer"
            className="block overflow-hidden rounded-md border border-border/70 focus-visible:outline-2 focus-visible:outline-ring"
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- Blob URLs, thumbnails only */}
            <img
              src={fileHref(photo.url)}
              alt={photo.filename}
              loading="lazy"
              className="h-20 w-24 object-cover"
            />
          </a>
          <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
            {photo.issueId ? "Evidence · " : ""}
            {photo.filename}
          </span>
          {!readOnly && onRemove && !photo.issueId ? (
            <Button
              size="icon-xs"
              variant="secondary"
              className="absolute right-1 top-1 opacity-90"
              aria-label={`Remove ${photo.filename}`}
              onClick={() => onRemove(photo)}
            >
              <X aria-hidden="true" />
            </Button>
          ) : null}
        </li>
      ))}
      {uploads.map((upload) => (
        <li
          key={upload.id}
          className="flex h-20 w-24 flex-col items-center justify-center gap-1 rounded-md border border-dashed border-border p-1 text-center text-[11px]"
        >
          {upload.error ? (
            <>
              <span className="line-clamp-2 text-destructive-ink">
                {upload.error}
              </span>
              <Button
                size="xs"
                variant="ghost"
                onClick={() => onDismiss?.(upload.id)}
              >
                Dismiss
              </Button>
            </>
          ) : (
            <>
              <Loader2
                className="size-4 animate-spin text-muted-foreground"
                aria-hidden="true"
              />
              <span className="w-full truncate">{upload.name}</span>
              <span className="font-mono tabular-nums">
                {Math.round(upload.progress)}%
              </span>
            </>
          )}
        </li>
      ))}
    </ul>
  );
}
