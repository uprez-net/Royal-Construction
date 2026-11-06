"use client";

import { useMemo, useRef, useState } from "react";
import { upload } from "@vercel/blob/client";
import { Files, Loader2, Search, Upload, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { DataTable } from "@/components/common/data-table";
import { FilterSelect } from "@/components/common/filter-select";
import { UploadDropzone } from "@/components/common/upload-dropzone";
import { useUploadHints } from "@/components/common/upload-hints";
import { FileTagList } from "@/components/files/file-tag-list";
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
  formatFileSize,
} from "@/utils/formatters";
import { filePreviewModal } from "@/utils/file-preview";
import type { ClientPayload } from "@/utils/validators/files";

const MAX_FILES = 5;

/** The table's filters, as search parameters on the lead URL. */
const PARAMS = [
  "fileQ",
  "fileType",
  "fileTag",
  "fileUploaded",
  "fileFrom",
  "fileTo",
] as const;

type LeadFile = Lead["uploadedFiles"][number];

function formatUploadedAt(value: string) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "—" : dataTimeFormat.format(parsed);
}

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
        }),
      ),
      tags: countValues(files.flatMap((file) => file.tags)).map(
        ({ value, count }) => ({ value, label: value, count }),
      ),
    }),
    [files, kindOf],
  );

  const uploadedWindow = isTimeWindow(filters.fileUploaded)
    ? filters.fileUploaded
    : null;
  const committedQuery = filters.fileQ.trim().toLowerCase();
  const activeFilterCount = [
    filters.fileQ,
    filters.fileType,
    filters.fileTag,
    uploadedWindow,
  ].filter(Boolean).length;
  const isFiltered = activeFilterCount > 0;

  const visibleFiles = useMemo(
    () =>
      files.filter((file) => {
        if (filters.fileType && kindOf.get(file.id) !== filters.fileType) {
          return false;
        }
        if (filters.fileTag && !file.tags.includes(filters.fileTag)) {
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
        if (!committedQuery) return true;
        return [file.name, file.origin ?? "", ...file.tags]
          .join(" ")
          .toLowerCase()
          .includes(committedQuery);
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

  const quickTags = options.tags.slice(0, 8);

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
        <CardHeader className="space-y-4 border-b border-border/70 px-4 pb-4 sm:px-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="space-y-1">
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
                  ? `${visibleFiles.length} of ${files.length} matching`
                  : `${files.length} ${files.length === 1 ? "file" : "files"}`}
              </p>
            </div>
            <div className="relative w-full sm:w-64">
              <Search
                className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search name, tag or origin"
                className="h-9 rounded-lg pl-9 text-sm"
                aria-label="Search files"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <FilterSelect
              label="File type"
              allLabel="All types"
              value={filters.fileType}
              onChange={(fileType) => setFilters({ fileType })}
              options={options.kinds}
            />
            <FilterSelect
              label="Uploaded"
              allLabel="Any time"
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
              }))}
            />
            <FilterSelect
              label="Tag"
              allLabel="All tags"
              value={filters.fileTag}
              onChange={(fileTag) => setFilters({ fileTag })}
              options={options.tags}
            />
          </div>

          {uploadedWindow === "custom" ? (
            <div className="flex flex-wrap items-end gap-3">
              <label className="space-y-1.5 text-xs font-medium text-muted-foreground">
                <span className="block">From</span>
                <Input
                  type="date"
                  value={filters.fileFrom}
                  max={filters.fileTo || undefined}
                  onChange={(event) =>
                    setFilters({ fileFrom: event.target.value })
                  }
                  className="h-9 w-40"
                />
              </label>
              <label className="space-y-1.5 text-xs font-medium text-muted-foreground">
                <span className="block">To</span>
                <Input
                  type="date"
                  value={filters.fileTo}
                  min={filters.fileFrom || undefined}
                  onChange={(event) =>
                    setFilters({ fileTo: event.target.value })
                  }
                  className="h-9 w-40"
                />
              </label>
            </div>
          ) : null}

          {quickTags.length > 0 || isFiltered ? (
            <div className="flex flex-wrap items-center gap-2">
              {quickTags.length > 0 ? (
                <FileTagList
                  tags={quickTags.map(({ value }) => value)}
                  activeTag={filters.fileTag}
                  onSelect={(fileTag) => setFilters({ fileTag })}
                  max={quickTags.length}
                />
              ) : null}
              {isFiltered ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="ml-auto h-7 text-xs"
                  onClick={clearFilters}
                >
                  <X data-icon="inline-start" aria-hidden="true" />
                  Clear filters
                </Button>
              ) : null}
            </div>
          ) : null}
        </CardHeader>
        <CardContent className="p-4">
          <DataTable
            mobileLayout="cards"
            mobileTitleColumn={0}
            onRowClick={(index) => {
              const action = filePreviewModal(
                visibleFiles.map((candidate) => ({
                  url: candidate.url,
                  name: candidate.name,
                  fileType: candidate.fileType ?? undefined,
                })),
                index,
              );
              if (action) dispatch(openModal(action));
            }}
            rowLabel={(index) => `Open ${visibleFiles[index]?.name ?? "file"}`}
            caption="Files uploaded against this lead, with tags, type, size and upload time."
            headers={["Name", "Tags", "Type", "Size", "Uploaded"]}
            align={["start", "start", "start", "end", "start"]}
            rows={visibleFiles.map((file) => [
              <span
                key={`${file.id}-name`}
                className="block min-w-0 space-y-0.5"
              >
                <span className="block truncate font-medium text-primary underline-offset-4 hover:underline">
                  {file.name}
                </span>
                {file.origin ? (
                  <span className="block truncate text-xs text-muted-foreground">
                    {file.origin}
                  </span>
                ) : null}
              </span>,

              <FileTagList
                key={`${file.id}-tags`}
                tags={file.tags}
                activeTag={filters.fileTag}
                onSelect={(fileTag) => setFilters({ fileTag })}
                className="max-w-72"
              />,

              <span
                key={`${file.id}-type`}
                className="inline-flex items-center rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-foreground"
              >
                {FILE_KIND_LABEL[kindOf.get(file.id) ?? "other"]}
              </span>,

              <span
                key={`${file.id}-size`}
                className="font-mono text-foreground tabular-nums"
              >
                {file.size > 0 ? formatFileSize(file.size) : "—"}
              </span>,

              <span
                key={`${file.id}-uploaded`}
                className="font-mono text-sm whitespace-nowrap tabular-nums"
              >
                {formatUploadedAt(file.createdAt)}
              </span>,
            ])}
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
                    {isFiltered
                      ? "No files match these filters"
                      : "No documents yet"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {isFiltered
                      ? `Clear the filters to see all ${files.length} files.`
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
