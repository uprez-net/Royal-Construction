"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  ClientPayload,
  milestonePictureUploadSchema,
} from "@/utils/validators";
import {
  type SubmitEvent,
  useEffect,
  useRef,
  useState,
  useTransition,
} from "react";
import { useAppDispatch } from "@/lib/store/hooks";
import { toast } from "sonner";
import {
  addMilestonePhotos,
  clearProjectUploads,
  completeProjectUpload,
  failProjectUpload,
  registerProjectUpload,
  updateProjectUploadProgress,
} from "@/lib/store/slices/projectsSlice";
import { upload } from "@vercel/blob/client";
import { buildBlobPath } from "@/utils/formatters";
import { AlertCircle, Loader2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { UploadDropzone } from "@/components/common/upload-dropzone";
import { useUploadQueue, type QueuedUploadFile } from "@/hooks/use-upload-queue";

const maxFiles = 5;

interface AddMilestonePictureProps {
  milestoneId: string;
  projectId: string;
  isOpen: boolean;
  onClose: () => void;
}

export default function AddMilestonePictureModal({
  milestoneId,
  projectId,
  isOpen,
  onClose,
}: AddMilestonePictureProps) {
  const dispatch = useAppDispatch();
  const [isPending, startTransition] = useTransition();
  const {
    files: queuedFiles,
    completedCount: completedUploadCount,
    addFiles,
    resetQueue,
    markUploading,
    updateProgress,
    markUploaded,
    markFailed,
  } = useUploadQueue({ maxFiles });
  const [submitError, setSubmitError] = useState<string | null>(null);
  const uploadControllersRef = useRef<Record<string, AbortController>>({});

  const resetForm = () => {
    Object.values(uploadControllersRef.current).forEach((controller) =>
      controller.abort(),
    );
    uploadControllersRef.current = {};
    resetQueue();
    dispatch(clearProjectUploads(projectId));
  };

  useEffect(() => {
    return () => {
      Object.values(uploadControllersRef.current).forEach((controller) =>
        controller.abort(),
      );
    };
  }, []);

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      resetForm();
      setSubmitError(null);
      onClose();
    }
  };

  const handleSubmit = async (e: SubmitEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSubmitError(null);

    if (queuedFiles.length === 0) {
      const message = "Please select at least one photo to upload.";
      setSubmitError(message);
      toast.error(message);
      return;
    }
    try {
      const uploads = await Promise.allSettled(
        queuedFiles.map((queuedFile) => uploadQueuedFile(queuedFile)),
      );

      const photos = uploads
        .filter(
          (
            result,
          ): result is PromiseFulfilledResult<{ url: string; id: string }> =>
            result.status === "fulfilled",
        )
        .map((result) => result.value);

      if (photos.length === 0) {
        throw new Error("No photos could be uploaded.");
      }

      const validatedPayload = milestonePictureUploadSchema.safeParse({
        fileIds: photos.map((photo) => photo.id),
      });

      if (!validatedPayload.success) {
        throw new Error(
          validatedPayload.error.issues.map((issue) => issue.message).join(", "),
        );
      }

      await dispatch(
        addMilestonePhotos({
          projectId,
          milestoneId,
          fileIds: validatedPayload.data.fileIds,
        }),
      ).unwrap();
      const failedUploadCount = uploads.filter(
        (result) => result.status === "rejected",
      ).length;

      if (failedUploadCount > 0) {
        toast.warning(
          `${photos.length} photo${photos.length === 1 ? "" : "s"} uploaded, ${failedUploadCount} failed.`,
        );
      } else {
        toast.success("Milestone picture uploaded successfully");
      }

      resetForm();
      onClose();
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Failed to upload milestone picture. Please try again.";
      setSubmitError(message);
      toast.error(message);
      console.error("Error uploading milestone picture:", error);
    }
  };

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
      const blob = await upload(
        buildBlobPath(
          projectId,
          queuedFile.id,
          queuedFile.file.name,
          milestoneId,
        ),
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

      dispatch(
        completeProjectUpload({
          projectId,
          fileId: queuedFile.id,
          url: blob.url,
        }),
      );

      markUploaded(queuedFile.id, blob.url);

      return {
        url: blob.url,
        id: queuedFile.id,
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to upload photo.";

      dispatch(
        failProjectUpload({
          projectId,
          fileId: queuedFile.id,
          error: message,
        }),
      );

      markFailed(queuedFile.id, message);

      throw error instanceof Error ? error : new Error(message);
    } finally {
      delete uploadControllersRef.current[queuedFile.id];
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[88vh] overflow-y-auto rounded-[18px] border border-border/80 bg-white p-0 shadow-[0_20px_60px_rgba(15,23,42,0.18)] sm:max-w-170">
        <DialogHeader className="border-b border-border/70 px-6 py-5">
          <DialogTitle className="text-[18px] font-semibold tracking-[-0.02em] text-slate-900">
            Add Milestone Picture
          </DialogTitle>
          <DialogDescription className="text-[13px] text-slate-500">
            Upload progress photos for this milestone and keep attachments tied to the project timeline.
          </DialogDescription>
        </DialogHeader>

        <form
          className="space-y-5 px-6 pb-6 pt-5"
          onSubmit={(data) =>
            startTransition(async () => await handleSubmit(data))
          }
        >
          {submitError ? (
            <div className="flex items-start gap-2 rounded-[12px] border border-amber-200/80 bg-amber-50 px-3.5 py-3 text-[12.5px] text-amber-900">
              <AlertCircle className="mt-0.5 size-4 shrink-0 text-amber-600" />
              <p>{submitError}</p>
            </div>
          ) : null}

          <div className="space-y-1.5">
            <UploadDropzone
              label="Attach Photos"
              summary={
                queuedFiles.length > 0
                  ? `${queuedFiles.length} photo${queuedFiles.length === 1 ? "" : "s"} selected · ${completedUploadCount} uploaded`
                  : "Click to upload photos (max 5)"
              }
              helperText="Choose multiple images at once. Upload progress stays visible below."
              files={queuedFiles}
              accept="image/*"
              maxFiles={maxFiles}
              disabled={isPending}
              isLoading={isPending}
              onFilesSelected={addFiles}
            />
          </div>

          <div className="flex flex-col-reverse gap-2 border-t border-border/70 pt-4 sm:flex-row sm:justify-end">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                resetForm();
                handleOpenChange(false);
              }}
              className="h-10 rounded-[10px] px-4 text-[12.5px] font-medium transition-all hover:border-teal-600 hover:bg-slate-50 hover:text-teal-600"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={isPending || queuedFiles.length === 0}
              className="h-10 rounded-[10px] bg-[#0D9488] px-4 text-[12.5px] font-semibold text-white transition-all hover:-translate-y-px hover:bg-[#0F766E] hover:shadow-[0_6px_14px_rgba(13,148,136,0.26)]"
            >
              {isPending ? (
                <Loader2 className="mr-1.5 size-4 animate-spin" />
              ) : (
                <Upload className="mr-1.5 size-4" />
              )}
              Upload Photos
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
