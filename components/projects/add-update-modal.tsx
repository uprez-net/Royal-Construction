"use client";

import {
  SubmitEvent,
  useEffect,
  useId,
  useRef,
  useState,
  useTransition,
} from "react";
import { AlertCircle, Loader2, Send } from "lucide-react";
import { toast } from "sonner";
import { upload } from "@vercel/blob/client";

import { UploadDropzone } from "@/components/common/upload-dropzone";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useAppDispatch, useAppSelector } from "@/lib/store/hooks";
import {
  addProjectUpdate,
  clearProjectUploads,
  completeProjectUpload,
  failProjectUpload,
  registerProjectUpload,
  updateProjectUploadProgress,
} from "@/lib/store/slices/projectsSlice";
import { QueuedUploadFile, useUploadQueue } from "@/hooks/use-upload-queue";
import { ClientPayload } from "@/utils/validators";
import { buildBlobPath } from "@/utils/formatters";
import { completeProjectUpload as confirmProjectUpload } from "@/lib/files/complete-project-upload";
import { useUploadHints } from "@/components/common/upload-hints";

const maxFiles = 5;

function RequiredMark() {
  return (
    <span className="ml-0.5 text-destructive-ink" aria-hidden="true">
      *
    </span>
  );
}

export function AddUpdateModal({
  projectId,
  milestoneId: initialMilestoneId,
  milestones,
  open,
  onOpenChange,
  onSuccess,
}: {
  projectId: string;
  milestoneId?: string;
  milestones: { id: string; name: string }[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}) {
  const dispatch = useAppDispatch();
  const hintsFor = useUploadHints();
  // The milestone is read from the selection at upload time, not render time.
  const uploadHints = () =>
    hintsFor({
      rootTrail: true,
      trail: ["Project", "Site update"],
      tags: [
        "Site update",
        "Site photo",
        milestones.find((milestone) => milestone.id === milestoneId)?.name,
      ],
    });
  const mutation = useAppSelector(
    (state) => state.projects.mutations.addUpdate,
  );
  const {
    files: queuedFiles,
    completedCount: completedUploadCount,
    addFiles,
    removeFile,
    resetQueue,
    markUploading,
    updateProgress,
    markUploaded,
    markFailed,
  } = useUploadQueue({ maxFiles });
  const [milestoneId, setMilestoneId] = useState<string | undefined>(
    initialMilestoneId,
  );
  const [notes, setNotes] = useState("");
  const [uploading, setUploading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isTransitioning, startTransition] = useTransition();
  const uploadControllersRef = useRef<Record<string, AbortController>>({});
  const transferredUrlsRef = useRef<Record<string, string>>({});
  const fieldPrefix = useId();
  const milestoneFieldId = `${fieldPrefix}-milestone`;
  const notesFieldId = `${fieldPrefix}-notes`;
  const errorId = `${fieldPrefix}-error`;

  const isSubmitting =
    mutation.status === "pending" || uploading || isTransitioning;

  const resetForm = () => {
    Object.values(uploadControllersRef.current).forEach((controller) =>
      controller.abort(),
    );
    uploadControllersRef.current = {};
    transferredUrlsRef.current = {};
    resetQueue();
    setMilestoneId(initialMilestoneId);
    setNotes("");
    setUploading(false);
    setErrorMessage(null);
    dispatch(clearProjectUploads(projectId));
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      resetForm();
    }

    onOpenChange(nextOpen);
  };

  const handleMilestoneChange = (value: string) => {
    const nextMilestoneId = value === "__none__" ? undefined : value;
    if (isSubmitting || nextMilestoneId === milestoneId) return;

    // A transferred file belongs to its original milestone, even if posting
    // failed. Retain the selected photos with fresh upload IDs and no URLs.
    transferredUrlsRef.current = {};
    resetQueue();
    addFiles(queuedFiles.map((queuedFile) => queuedFile.file));
    dispatch(clearProjectUploads(projectId));
    setMilestoneId(nextMilestoneId);
  };

  useEffect(() => {
    return () => {
      Object.values(uploadControllersRef.current).forEach((controller) =>
        controller.abort(),
      );
    };
  }, []);

  const uploadQueuedFile = async (queuedFile: QueuedUploadFile) => {
    const controller = new AbortController();
    uploadControllersRef.current[queuedFile.id] = controller;

    dispatch(
      registerProjectUpload({
        projectId,
        fileId: queuedFile.id,
        fileName: queuedFile.file.name,
        fileSize: queuedFile.file.size,
      }),
    );

    markUploading(queuedFile.id);

    try {
      const uploadedUrl =
        transferredUrlsRef.current[queuedFile.id] ?? queuedFile.url;
      const blob = uploadedUrl
        ? { url: uploadedUrl }
        : await upload(
            buildBlobPath({
              fileId: queuedFile.id,
              fileName: queuedFile.file.name,
              projectId,
              milestoneId: milestoneId ?? undefined,
            }),
            queuedFile.file,
            {
              access: "public",
              handleUploadUrl: "/api/upload",
              clientPayload: JSON.stringify({
                projectId,
                milestoneId: milestoneId ?? null,
                fileId: queuedFile.id,
                fileName: queuedFile.file.name,
                fileSize: queuedFile.file.size,
                isOfferFile: false,
                uploadType: "project-file",
                ...uploadHints(),
              } satisfies ClientPayload),
              abortSignal: controller.signal,
              onUploadProgress: ({ percentage }) => {
                dispatch(
                  updateProjectUploadProgress({
                    projectId,
                    fileId: queuedFile.id,
                    progress: percentage,
                  }),
                );

                updateProgress(queuedFile.id, percentage);
              },
            },
          );

      transferredUrlsRef.current[queuedFile.id] = blob.url;
      await confirmProjectUpload(
        {
          projectId,
          milestoneId: milestoneId ?? null,
          fileId: queuedFile.id,
          fileName: queuedFile.file.name,
          fileUrl: blob.url,
          ...uploadHints(),
        },
        controller.signal,
      );

      dispatch(
        completeProjectUpload({
          projectId,
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

  async function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();

    const trimmedNotes = notes.trim();

    if (!trimmedNotes) {
      const message = "Update notes are required";
      setErrorMessage(message);
      toast.error(message);
      return;
    }

    setErrorMessage(null);
    setUploading(true);
    let success = false;
    try {
      const photoUrls =
        queuedFiles.length > 0
          ? await Promise.all(
              queuedFiles.map((queuedFile) => uploadQueuedFile(queuedFile)),
            )
          : [];

      await dispatch(
        addProjectUpdate({
          projectId,
          notes: trimmedNotes,
          milestoneId: milestoneId ?? null,
          photoUrls,
        }),
      ).unwrap();

      toast.success("Site update posted");
      success = true;
      onSuccess();
    } catch (error) {
      Object.values(uploadControllersRef.current).forEach((controller) =>
        controller.abort(),
      );
      uploadControllersRef.current = {};

      if (error instanceof DOMException && error.name === "AbortError") {
        return;
      }

      const message =
        error instanceof Error ? error.message : "Unable to post update";
      setErrorMessage(message);
      toast.error(message);

      queuedFiles.forEach((file) => {
        if (file.status !== "uploaded") {
          markFailed(file.id, message);
          dispatch(
            failProjectUpload({
              projectId,
              fileId: file.id,
              error: message,
            }),
          );
        }
      });
    } finally {
      setUploading(false);
      if (success) {
        resetForm();
        onOpenChange(false);
      }
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto rounded-[14px] border-border bg-card p-0 shadow-lg sm:max-w-150">
        <DialogHeader className="border-b border-border px-6 pb-4 pt-5">
          <DialogTitle className="text-lg font-semibold text-foreground">
            Add site update
          </DialogTitle>
          <DialogDescription className="mt-0.5 text-sm text-muted-foreground">
            Photos upload directly from the browser and publish with the update.
            Fields marked * are required.
          </DialogDescription>
        </DialogHeader>

        <form
          className="space-y-4 px-6 pb-6 pt-5"
          noValidate
          onSubmit={(data) => {
            if (isSubmitting) {
              data.preventDefault();
              return;
            }
            startTransition(async () => await handleSubmit(data));
          }}
        >
          {errorMessage ? (
            <div
              id={errorId}
              role="alert"
              className="flex items-start gap-2 rounded-[12px] border border-destructive/40 bg-destructive-light px-3.5 py-3 text-sm text-destructive-ink"
            >
              <AlertCircle
                className="mt-0.5 size-4 shrink-0"
                aria-hidden="true"
              />
              <p>{errorMessage}</p>
            </div>
          ) : null}

          <div className="space-y-1.5">
            <Label
              htmlFor={milestoneFieldId}
              className="text-xs font-medium text-foreground"
            >
              Milestone
            </Label>
            <Select
              disabled={isSubmitting || initialMilestoneId !== undefined}
              value={milestoneId ?? "__none__"}
              onValueChange={handleMilestoneChange}
            >
              <SelectTrigger
                id={milestoneFieldId}
                className="h-9 w-full rounded-[7px] bg-background px-3 py-2 text-sm"
              >
                <SelectValue placeholder="No milestone" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">No milestone</SelectItem>
                {milestones.map((milestone) => (
                  <SelectItem key={milestone.id} value={milestone.id}>
                    {milestone.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label
              htmlFor={notesFieldId}
              className="text-xs font-medium text-foreground"
            >
              Description
              <RequiredMark />
            </Label>
            <Textarea
              id={notesFieldId}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="Slab poured, waiting on the plumber to sign off"
              rows={4}
              required
              aria-invalid={Boolean(errorMessage) && !notes.trim()}
              aria-describedby={errorMessage ? errorId : undefined}
              className="min-h-24 resize-y rounded-[7px] bg-background px-3 py-2 text-sm"
            />
          </div>

          <div className="space-y-1.5">
            <UploadDropzone
              label="Attach photos"
              summary={
                queuedFiles.length > 0
                  ? `${queuedFiles.length} photo${queuedFiles.length === 1 ? "" : "s"} selected (${completedUploadCount} uploaded)`
                  : `Select photos to upload (max ${maxFiles})`
              }
              helperText="Images upload directly from the browser and stay visible below while they sync."
              files={queuedFiles}
              accept="image/*"
              maxFiles={maxFiles}
              disabled={isSubmitting}
              isLoading={isSubmitting}
              onFilesSelected={addFiles}
              removeFile={removeFile}
            />
          </div>

          <div className="mt-4 flex justify-end gap-2 border-t border-border pt-4">
            <Button
              type="button"
              variant="outline"
              disabled={isSubmitting}
              onClick={() => handleOpenChange(false)}
              className="h-9 rounded-[7px] px-3.5 text-sm font-medium"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={isSubmitting || !notes.trim()}
              aria-busy={isSubmitting}
              className="h-9 rounded-[7px] bg-primary px-3.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              {isSubmitting ? (
                <Loader2
                  className="mr-1.5 size-4 animate-spin motion-reduce:animate-none"
                  aria-hidden="true"
                />
              ) : (
                <Send className="mr-1.5 size-4" aria-hidden="true" />
              )}
              {isSubmitting ? "Posting update…" : "Post update"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
