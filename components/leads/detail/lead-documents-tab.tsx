"use client";

import { useMemo, useRef, useState } from "react";
import { upload } from "@vercel/blob/client";
import { CalendarDays, Files, Loader2, Search, Upload, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { DataTable } from "@/components/common/data-table";
import { FilterSelect } from "@/components/common/filter-select";
import {
  FILE_KIND_ICON,
  TIME_WINDOW_ICON,
  TIME_WINDOW_ICON_CLASS,
} from "@/components/common/file-filter-icons";
import { UploadDropzone } from "@/components/common/upload-dropzone";
import { useUploadHints } from "@/components/common/upload-hints";
import {
  useUploadQueue,
  type QueuedUploadFile,
} from "@/hooks/use-upload-queue";
import {
  useDebouncedSearchParam,
  useSearchParamFilters,
} from "@/hooks/use-search-param-filters";
import { inferFileTags, normalizeFileTags } from "@/lib/domain/file-tags";
import {
  FILE_KIND_LABEL,
  TIME_WINDOWS,
  TIME_WINDOW_LABEL,
  countValues,
  displayFileName,
  fileKind,
  isTimeWindow,
  isWithinWindow,
  type FileKind,
} from "@/lib/files/file-filters";
import { useAppDispatch } from "@/lib/store/hooks";
import {
  completeProjectUpload,
  registerProjectUpload,
  updateProjectUploadProgress,
} from "@/lib/store/slices/projectsSlice";
import { openModal } from "@/lib/store/slices/uiSlice";
import type { Lead } from "@/lib/leads/types";
import {
  buildBlobPath,
  dataTimeFormat,
  dateFormat,
  formatFileSize,
} from "@/utils/formatters";
import { filePreviewModal } from "@/utils/file-preview";
import type { ClientPayload } from "@/utils/validators/files";

const MAX_FILES = 5;

/** The table's filters, as search parameters on the lead URL. */
const PARAMS = [
  "fileQ",
  "fileType",
  "fileUploaded",
  "fileFrom",
  "fileTo",
] as const;

type LeadFile = Lead["uploadedFiles"][number];

export function LeadDocumentsTab({
  lead,
  onFilesUploaded,
}: {
  lead: Lead;
  onFilesUploaded: (files: LeadFile[]) => void;
}) {
  const {
    files: queuedFiles,
    completedCount,
    addFiles,
    removeFile,
    resetQueue,
    markUploading,
    updateProgress,
    markUploaded,
  } = useUploadQueue({ maxFiles: MAX_FILES });
  const dispatch = useAppDispatch();
  const hintsFor = useUploadHints();
  const uploadControllersRef = useRef<Record<string, AbortController>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [now] = useState(() => new Date());

  const [filters, setFilters] = useSearchParamFilters(PARAMS);
  const [query, setQuery] = useDebouncedSearchParam(filters.fileQ, (fileQ) =>
    setFilters({ fileQ }),
  );

  // Newest first, like every other file list.
  const files = useMemo(
    () =>
      [...lead.uploadedFiles].sort((a, b) =>
        b.createdAt.localeCompare(a.createdAt),
      ),
    [lead.uploadedFiles],
  );
  const kindOf = useMemo(
    () =>
      new Map(
        files.map((file) => [file.id, fileKind(file.fileType, file.name)]),
      ),
    [files],
  );

  const options = useMemo(
    () => ({
      kinds: countValues(files.map((file) => kindOf.get(file.id)!)).map(
        ({ value, count }) => ({
          value,
          label: FILE_KIND_LABEL[value as FileKind] ?? value,
          count,
          icon: FILE_KIND_ICON[value as FileKind]?.icon,
          iconClassName: FILE_KIND_ICON[value as FileKind]?.className,
        }),
      ),
    }),
    [files, kindOf],
  );

  const uploadedWindow = isTimeWindow(filters.fileUploaded)
    ? filters.fileUploaded
    : null;
  const committedQuery = filters.fileQ.trim().toLowerCase();
  const isFiltered = [filters.fileQ, filters.fileType, uploadedWindow].some(
    Boolean,
  );

  const visibleFiles = useMemo(
    () =>
      files.filter((file) => {
        if (filters.fileType && kindOf.get(file.id) !== filters.fileType) {
          return false;
        }
        if (
          !isWithinWindow(file.createdAt, uploadedWindow, now, {
            from: filters.fileFrom,
            to: filters.fileTo,
          })
        ) {
          return false;
        }
        // Tags and the upload trail are searched but never shown: they are
        // how "plans" finds a file whose name does not say so.
        const haystack = [file.name, file.origin ?? "", ...file.tags]
          .join(" ")
          .toLowerCase();
        return committedQuery
          .split(/\s+/)
          .every((word) => haystack.includes(word));
      }),
    [committedQuery, files, filters, kindOf, now, uploadedWindow],
  );

  const clearFilters = () => {
    setQuery("");
    setFilters(
      Object.fromEntries(PARAMS.map((key) => [key, null])) as Record<
        (typeof PARAMS)[number],
        null
      >,
    );
  };

  const uploadQueuedFile = async (queuedFile: QueuedUploadFile) => {
    const controller = new AbortController();
    uploadControllersRef.current[queuedFile.id] = controller;

    dispatch(
      registerProjectUpload({
        projectId: `lead-${lead.id}`,
        fileId: queuedFile.id,
        fileName: queuedFile.file.name,
        fileSize: queuedFile.file.size,
      }),
    );

    markUploading(queuedFile.id);

    try {
      const blob = await upload(
        buildBlobPath({
          leadId: lead.id.toString(),
          fileId: queuedFile.id,
          fileName: queuedFile.file.name,
        }),
        queuedFile.file,
        {
          access: "public",
          handleUploadUrl: "/api/upload",
          clientPayload: JSON.stringify({
            leadId: lead.id.toString(),
            fileId: queuedFile.id,
            fileName: queuedFile.file.name,
            fileSize: queuedFile.file.size,
            isOfferFile: false,
            ...hintsFor(),
          } satisfies ClientPayload),
          abortSignal: controller.signal,
          onUploadProgress: ({ percentage }) => {
            dispatch(
              updateProjectUploadProgress({
                projectId: `lead-${lead.id}`,
                fileId: queuedFile.id,
                progress: percentage,
              }),
            );
            updateProgress(queuedFile.id, percentage);
          },
        },
      );

      dispatch(
        completeProjectUpload({
          projectId: `lead-${lead.id}`,
          fileId: queuedFile.id,
          url: blob.url,
        }),
      );

      markUploaded(queuedFile.id, blob.url);
      return blob.url;
    } finally {
      delete uploadControllersRef.current[queuedFile.id];
    }
  };

  /** The row the table shows until the lead is next read from the server. */
  const uploadedRow = (file: File, id: string, url: string): LeadFile => {
    const hints = hintsFor();
    return {
      id,
      name: file.name,
      url,
      size: file.size,
      fileType: file.type || null,
      createdAt: new Date().toISOString(),
      origin: hints.origin,
      tags: normalizeFileTags(hints.tags, inferFileTags(file.name, file.type)),
    };
  };

  const handleUpload = async () => {
    if (queuedFiles.length === 0) {
      toast.error("Add at least one file before uploading.");
      return;
    }

    setIsSubmitting(true);
    try {
      const uploaded = await Promise.all(
        queuedFiles.map(async (file) => {
          if (file.status === "uploaded" && file.url) {
            return uploadedRow(file.file, file.id, file.url);
          }
          if (file.status === "queued" || file.status === "uploading") {
            const url = await uploadQueuedFile(file);
            return uploadedRow(file.file, file.id, url);
          }
          throw new Error(`"${file.file.name}" failed to upload.`);
        }),
      );

      onFilesUploaded(uploaded);
      resetQueue();
      toast.success(
        `${uploaded.length} file${uploaded.length === 1 ? "" : "s"} uploaded`,
      );
    } catch (error) {
      console.error("Failed to upload files", error);
      toast.error("Failed to upload the files. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const openPreview = (index: number) => {
    const action = filePreviewModal(
      visibleFiles.map((candidate) => ({
        url: candidate.url,
        name: candidate.name,
        fileType: candidate.fileType ?? undefined,
      })),
      index,
    );
    if (action) dispatch(openModal(action));
  };

  return (
    <section className="space-y-4">
      <Card className="rounded-xl border-border/70 bg-card shadow-sm">
        <CardHeader className="border-b border-border/70 px-4 pb-4 sm:px-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="space-y-1">
              <CardTitle
                as="h2"
                className="text-base font-semibold text-foreground"
              >
                Upload supporting documents
              </CardTitle>
              <p className="text-sm text-muted-foreground">
                Files upload directly from the browser and stay visible below
                while they sync.
              </p>
            </div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="flex items-center gap-1 text-xs"
              disabled={isSubmitting}
              aria-busy={isSubmitting}
              onClick={handleUpload}
            >
              {isSubmitting ? (
                <>
                  <Loader2
                    className="h-3 w-3 animate-spin"
                    aria-hidden="true"
                  />
                  Uploading…
                </>
              ) : (
                <>
                  <Upload className="h-3 w-3" aria-hidden="true" />
                  Upload
                  {queuedFiles.length > 0
                    ? ` (${queuedFiles.length}) file${queuedFiles.length === 1 ? "" : "s"}`
                    : ""}
                </>
              )}
            </Button>
          </div>
        </CardHeader>

        <CardContent className="px-4 pt-4 sm:px-6 sm:pt-5">
          <UploadDropzone
            label=""
            summary={
              queuedFiles.length > 0
                ? `${queuedFiles.length} file${queuedFiles.length === 1 ? "" : "s"} · ${completedCount} uploaded`
                : `Drop files here or browse • Up to ${MAX_FILES} files`
            }
            files={queuedFiles}
            accept="image/*,.pdf,.doc,.docx,.xls,.xlsx"
            maxFiles={MAX_FILES}
            disabled={isSubmitting}
            isLoading={isSubmitting}
            onFilesSelected={addFiles}
            removeFile={removeFile}
            dropzoneClassName="p-6"
            listClassName="p-2 space-y-1.5"
            itemClassName="p-2"
          />
        </CardContent>
      </Card>

      <Card className="rounded-xl border-border/70 bg-card shadow-sm">
        <CardHeader className="space-y-3 border-b border-border/70 px-4 pb-4 sm:px-6">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <CardTitle
              as="h2"
              className="text-base font-semibold text-foreground"
            >
              Uploaded files
            </CardTitle>
            <p
              className="text-sm text-muted-foreground tabular-nums"
              aria-live="polite"
            >
              {isFiltered
                ? `${visibleFiles.length} of ${files.length}`
                : `${files.length} ${files.length === 1 ? "file" : "files"}`}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-56 flex-1">
              <Search
                className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search files"
                className="h-9 rounded-lg pl-9 text-sm"
                aria-label="Search files"
              />
            </div>
            <FilterSelect
              hideLabel
              label="File type"
              allLabel="All types"
              icon={Files}
              value={filters.fileType}
              onChange={(fileType) => setFilters({ fileType })}
              options={options.kinds}
              className="w-[calc(50%-0.25rem)] sm:w-36"
            />
            <FilterSelect
              hideLabel
              label="Uploaded"
              allLabel="Any date"
              icon={CalendarDays}
              value={uploadedWindow ?? ""}
              onChange={(fileUploaded) =>
                setFilters(
                  fileUploaded === "custom"
                    ? { fileUploaded }
                    : { fileUploaded, fileFrom: null, fileTo: null },
                )
              }
              options={TIME_WINDOWS.map((window) => ({
                value: window,
                label: TIME_WINDOW_LABEL[window],
                icon: TIME_WINDOW_ICON[window],
                iconClassName: TIME_WINDOW_ICON_CLASS,
              }))}
              className="w-[calc(50%-0.25rem)] sm:w-40"
            />
            {isFiltered ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-9 text-xs"
                onClick={clearFilters}
              >
                <X data-icon="inline-start" aria-hidden="true" />
                Clear
              </Button>
            ) : null}
          </div>

          {uploadedWindow === "custom" ? (
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <label className="flex items-center gap-2">
                From
                <Input
                  type="date"
                  value={filters.fileFrom}
                  max={filters.fileTo || undefined}
                  onChange={(event) =>
                    setFilters({ fileFrom: event.target.value })
                  }
                  className="h-8 w-40"
                />
              </label>
              <label className="flex items-center gap-2">
                to
                <Input
                  type="date"
                  value={filters.fileTo}
                  min={filters.fileFrom || undefined}
                  onChange={(event) =>
                    setFilters({ fileTo: event.target.value })
                  }
                  className="h-8 w-40"
                />
              </label>
            </div>
          ) : null}
        </CardHeader>
        <CardContent className="p-4">
          <DataTable
            mobileLayout="cards"
            mobileTitleColumn={0}
            onRowClick={openPreview}
            rowLabel={(index) => `Open ${visibleFiles[index]?.name ?? "file"}`}
            caption="Files uploaded against this lead, with type, upload date and size."
            headers={["Name", "Type", "Uploaded", "Size"]}
            align={["start", "start", "start", "end"]}
            rows={visibleFiles.map((file, index) => {
              const uploadedAt = new Date(file.createdAt);
              const hasDate = !Number.isNaN(uploadedAt.getTime());
              return [
                <button
                  key={`${file.id}-name`}
                  type="button"
                  className="block max-w-[min(36rem,60vw)] truncate rounded-sm text-left font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
                  title={file.name}
                  // The row opens the same preview; this is the keyboard route to it.
                  onClick={(event) => {
                    event.stopPropagation();
                    openPreview(index);
                  }}
                >
                  {displayFileName(file.name)}
                </button>,

                <span
                  key={`${file.id}-type`}
                  className="text-sm text-muted-foreground"
                >
                  {FILE_KIND_LABEL[kindOf.get(file.id) ?? "other"]}
                </span>,

                <span
                  key={`${file.id}-uploaded`}
                  className="text-sm whitespace-nowrap tabular-nums"
                  title={
                    hasDate ? dataTimeFormat.format(uploadedAt) : undefined
                  }
                >
                  {hasDate ? dateFormat.format(uploadedAt) : "—"}
                </span>,

                <span
                  key={`${file.id}-size`}
                  className="text-sm text-muted-foreground tabular-nums"
                >
                  {file.size > 0 ? formatFileSize(file.size) : "—"}
                </span>,
              ];
            })}
            emptyState={
              <div className="mx-auto flex max-w-md flex-col items-center gap-3">
                <div className="flex size-11 items-center justify-center rounded-2xl bg-muted">
                  <Files
                    className="size-5 text-muted-foreground"
                    aria-hidden="true"
                  />
                </div>
                <div className="space-y-1">
                  <p className="text-sm font-semibold text-foreground">
                    {isFiltered ? "No files match" : "No documents yet"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {isFiltered
                      ? `Clear the search and filters to see all ${files.length} files.`
                      : "Plans, quotes and supporting paperwork uploaded against this lead appear here."}
                  </p>
                </div>
                {isFiltered ? (
                  <Button size="sm" variant="outline" onClick={clearFilters}>
                    Clear filters
                  </Button>
                ) : null}
              </div>
            }
          />
        </CardContent>
      </Card>
    </section>
  );
}
