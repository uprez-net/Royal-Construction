"use client";

import { useMemo, useRef, useState } from "react";
import { upload } from "@vercel/blob/client";
import { Files, Loader2, Upload } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DataTable } from "@/components/common/data-table";
import { UploadDropzone } from "@/components/common/upload-dropzone";
import {
  useUploadQueue,
  type QueuedUploadFile,
} from "@/hooks/use-upload-queue";
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
  formatFileSize,
  formatFileType,
} from "@/utils/formatters";
import { filePreviewModal } from "@/utils/file-preview";
import type { ClientPayload } from "@/utils/validators/files";

const MAX_FILES = 5;

type LeadFile = Lead["uploadedFiles"][number];

/**
 * `Lead.uploadedFiles` carries only id, name, size and url (see `mapLead` in
 * types/lead.ts), so the stored MIME type is not available here. The extension
 * is the only type signal the client has.
 */
function fileTypeFromName(name: string): string {
  const extension = name.includes(".") ? name.split(".").pop() : null;
  return extension ? formatFileType(extension) : "—";
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
  const uploadControllersRef = useRef<Record<string, AbortController>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  const files = lead.uploadedFiles;
  const rows = useMemo(
    () =>
      files.map((file, index) => [
        <span
          key={`${file.id}-number`}
          className="font-mono text-muted-foreground tabular-nums"
        >
          {index + 1}
        </span>,

        <span
          key={`${file.id}-name`}
          className="inline-flex items-center gap-1.5 font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          {file.name}
        </span>,

        <span
          key={`${file.id}-type`}
          className="inline-flex items-center rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-foreground"
        >
          {fileTypeFromName(file.name)}
        </span>,

        <span
          key={`${file.id}-size`}
          className="font-mono text-foreground tabular-nums"
        >
          {formatFileSize(file.size)}
        </span>,
      ]),
    [files],
  );

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
            return {
              id: file.id,
              name: file.file.name,
              url: file.url,
              size: file.file.size,
            };
          }
          if (file.status === "queued" || file.status === "uploading") {
            const url = await uploadQueuedFile(file);
            return {
              id: file.id,
              name: file.file.name,
              url,
              size: file.file.size,
            };
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
        <CardHeader className="border-b border-border/70 px-4 pb-4 sm:px-6">
          <CardTitle
            as="h2"
            className="text-base font-semibold text-foreground"
          >
            Uploaded files
          </CardTitle>
          <p className="text-sm text-muted-foreground tabular-nums">
            {files.length} {files.length === 1 ? "file" : "files"}
          </p>
        </CardHeader>
        <CardContent className="p-4">
          <DataTable
            mobileLayout="cards"
            mobileTitleColumn={1}
            onRowClick={(index) => {
              // Lead files carry no stored MIME type (see fileTypeFromName
              // above), so the name is the only signal the helper has for
              // telling a photo from a document.
              const action = filePreviewModal(
                files.map((candidate) => ({
                  url: candidate.url,
                  name: candidate.name,
                })),
                index,
              );
              if (action) dispatch(openModal(action));
            }}
            rowLabel={(index) => `Open ${files[index]?.name ?? "file"}`}
            caption="Files uploaded against this lead, with type and size."
            headers={["#", "Name", "Type", "Size", ""]}
            align={["end", "start", "start", "end", "start"]}
            rows={rows}
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
                    No documents yet
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Plans, quotes and supporting paperwork uploaded against this
                    lead appear here.
                  </p>
                </div>
              </div>
            }
          />
        </CardContent>
      </Card>
    </section>
  );
}
