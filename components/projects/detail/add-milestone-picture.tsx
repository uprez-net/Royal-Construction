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
  MilestonePictureUploadData,
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
    if (!open) onClose();
  };

  const handleSubmit = async (e: SubmitEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (queuedFiles.length === 0) {
      toast.error("Please select at least one photo to upload.");
      return;
    }
    try {
      const photos =
        queuedFiles.length > 0
          ? await Promise.all(
              queuedFiles.map((queuedFile) => uploadQueuedFile(queuedFile)),
            )
          : [];

      await dispatch(
        addMilestonePhotos({
          projectId,
          milestoneId,
          fileIds: photos.map((p) => p.id),
        }),
      ).unwrap();
      toast.success("Milestone picture uploaded successfully");
      onClose();
    } catch (error) {
      toast.error("Failed to upload milestone picture. Please try again.");
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
    } finally {
      delete uploadControllersRef.current[queuedFile.id];
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add Milestone Picture</DialogTitle>
          <DialogDescription>
            Upload a picture for this milestone.
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={(data) =>
            startTransition(async () => await handleSubmit(data))
          }
        >
          <div className="space-y-1.5">
            <label className="block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Attach Photos
            </label>
            <div
              className="group cursor-pointer rounded-lg border-2 border-dashed border-border p-6 text-center transition-colors hover:border-teal-600 hover:bg-slate-50"
              onClick={() => fileInputRef.current?.click()}
            >
              <CloudUpload className="mx-auto mb-1.5 size-7 text-muted-foreground transition-colors group-hover:text-teal-600" />
              <span className="text-xs text-muted-foreground transition-colors group-hover:text-teal-600">
                {queuedFiles.length > 0
                  ? `${queuedFiles.length} photo${queuedFiles.length === 1 ? "" : "s"} selected (${completedUploadCount} uploaded)`
                  : "Click to upload photos (max 5)"}
              </span>
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
            <div className="space-y-2 rounded-xl border border-border/70 bg-muted/20 p-3">
              {queuedFiles.map((file) => (
                <div
                  key={file.id}
                  className="rounded-lg border border-border/70 bg-white p-3 shadow-sm"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-foreground">
                        {file.file.name}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {formatFileSize(file.file.size)}
                      </p>
                    </div>
                    <div className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
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

          <div className="mt-4 flex justify-end gap-2 border-t border-border pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => handleOpenChange(false)}
              className="h-9 rounded-[7px] px-3.5 text-[12.5px] font-medium transition-all hover:border-teal-600 hover:bg-slate-50 hover:text-teal-600"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={isPending || queuedFiles.length === 0}
              className="h-9 rounded-[7px] bg-[#0D9488] px-3.5 text-[12.5px] font-semibold text-white transition-all hover:-translate-y-px hover:bg-[#0F766E] hover:shadow-[0_4px_12px_rgba(13,148,136,0.3)]"
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
