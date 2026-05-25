"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { v4 as uuid } from "uuid";
import {
  ClientPayload,
  milestonePictureUploadSchema,
} from "@/utils/validators";
import {
  type ChangeEvent,
  type SubmitEvent,
  useEffect,
  useMemo,
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
import { buildBlobPath, formatFileSize } from "@/utils/formatters";
import {
  AlertCircle,
  CheckCircle2,
  CloudUpload,
  Loader2,
  Upload,
} from "lucide-react";
import { Button } from "@/components/ui/button";

const maxFiles = 5;

type QueuedUploadFile = {
  id: string;
  file: File;
  previewUrl: string;
  progress: number;
  status: "queued" | "uploading" | "uploaded" | "failed";
  error: string | null;
  url: string | null;
};

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
  const [queuedFiles, setQueuedFiles] = useState<QueuedUploadFile[]>([]);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const queuedFilesRef = useRef<QueuedUploadFile[]>([]);
  const uploadControllersRef = useRef<Record<string, AbortController>>({});
  const completedUploadCount = useMemo(
    () => queuedFiles.filter((file) => file.status === "uploaded").length,
    [queuedFiles],
  );

  const resetForm = () => {
    Object.values(uploadControllersRef.current).forEach((controller) =>
      controller.abort(),
    );
    uploadControllersRef.current = {};
    queuedFilesRef.current.forEach((file) =>
      URL.revokeObjectURL(file.previewUrl),
    );
    queuedFilesRef.current = [];
    setQueuedFiles([]);
    dispatch(clearProjectUploads(projectId));

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  useEffect(() => {
    queuedFilesRef.current = queuedFiles;
  }, [queuedFiles]);

  useEffect(() => {
    return () => {
      queuedFilesRef.current.forEach((file) =>
        URL.revokeObjectURL(file.previewUrl),
      );
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

  const handleFileSelection = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);

    if (files.length === 0) {
      return;
    }

    setQueuedFiles((current) => {
      const nextFiles = [...current];

      files.slice(0, Math.max(maxFiles - current.length, 0)).forEach((file) => {
        nextFiles.push({
          id: uuid(),
          file,
          previewUrl: URL.createObjectURL(file),
          progress: 0,
          status: "queued",
          error: null,
          url: null,
        });
      });

      return nextFiles;
    });

    event.target.value = "";
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

    setQueuedFiles((current) =>
      current.map((file) =>
        file.id === queuedFile.id
          ? { ...file, status: "uploading", progress: 0, error: null }
          : file,
      ),
    );

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

            setQueuedFiles((current) =>
              current.map((file) =>
                file.id === queuedFile.id
                  ? {
                      ...file,
                      status: "uploading",
                      progress: percentage,
                      error: null,
                    }
                  : file,
              ),
            );
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

      setQueuedFiles((current) =>
        current.map((file) =>
          file.id === queuedFile.id
            ? {
                ...file,
                status: "uploaded",
                progress: 100,
                url: blob.url,
                error: null,
              }
            : file,
        ),
      );

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

      setQueuedFiles((current) =>
        current.map((file) =>
          file.id === queuedFile.id
            ? {
                ...file,
                status: "failed",
                error: message,
              }
            : file,
        ),
      );

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
            <label className="block text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">
              Attach Photos
            </label>
            <div
              className="group cursor-pointer rounded-[16px] border-2 border-dashed border-border/80 bg-slate-50/40 p-6 text-center transition-all hover:border-teal-600 hover:bg-teal-50/40"
              onClick={() => fileInputRef.current?.click()}
            >
              <CloudUpload className="mx-auto mb-2 size-8 text-muted-foreground transition-colors group-hover:text-teal-600" />
              <span className="text-sm font-medium text-slate-600 transition-colors group-hover:text-teal-700">
                {queuedFiles.length > 0
                  ? `${queuedFiles.length} photo${queuedFiles.length === 1 ? "" : "s"} selected · ${completedUploadCount} uploaded`
                  : "Click to upload photos (max 5)"}
              </span>
              <p className="mt-1.5 text-xs text-slate-500">
                Choose multiple images at once. Upload progress stays visible below.
              </p>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={handleFileSelection}
            />
          </div>

          {queuedFiles.length > 0 && (
            <div className="space-y-2 rounded-[14px] border border-border/70 bg-slate-50/60 p-3.5">
              {queuedFiles.map((file) => (
                <div
                  key={file.id}
                  className="rounded-[12px] border border-border/70 bg-white p-3 shadow-sm"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-slate-900">
                        {file.file.name}
                      </p>
                      <p className="text-xs text-slate-500">
                        {formatFileSize(file.file.size)}
                      </p>
                    </div>
                    <div className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em] text-slate-600">
                      {file.status === "uploaded" ? (
                        <CheckCircle2 className="size-3.5 text-emerald-600" />
                      ) : null}
                      {file.status === "failed" ? (
                        <AlertCircle className="size-3.5 text-destructive" />
                      ) : null}
                      {file.status}
                    </div>
                  </div>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-teal-600 transition-all"
                      style={{ width: `${file.progress}%` }}
                    />
                  </div>
                  {file.error ? (
                    <p className="mt-1 text-xs text-destructive">
                      {file.error}
                    </p>
                  ) : null}
                </div>
              ))}
            </div>
          )}

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
